import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";
import { timedTestSessions } from "./timedTestStore.js";
import { fetch25QuestionsFromDB, addFailedQuestionId, saveResults } from "./questionsService.js";

dotenv.config();

const PRIVATE_KEY = fs.readFileSync(
  new URL("../private.pem", import.meta.url),
  "utf8"
).trim();

const TEST_DURATION_MS = Number(
  process.env.TIMED_TEST_DURATION_MS || 8 * 60 * 1000
);

const TOTAL_QUESTIONS = Number(
  process.env.TIMED_TEST_TOTAL_QUESTIONS || 25
);

const MAX_ATTEMPTS = 5;

const ATTEMPT_WORDS = [
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
];

function getAttemptWord(attemptNo) {
  const word = ATTEMPT_WORDS[attemptNo - 1];

  if (!word) {
    throw new Error(`Invalid attempt number: ${attemptNo}`);
  }

  return word;
}

function getAttemptNumber(screen, prefix) {
  if (!screen?.startsWith(prefix)) {
    return NaN;
  }

  const word = screen.slice(prefix.length);
  const index = ATTEMPT_WORDS.indexOf(word);

  return index === -1 ? NaN : index + 1;
}

const TEST_INSTRUCTIONS =
  `You have ${Math.floor(TEST_DURATION_MS / 60000)} minutes to answer ` +
  `${TOTAL_QUESTIONS} questions about road rules. ` +
  "Choose one answer for every question. " +
  "Your timer starts when you tap Start Test. " +
  "When time expires, your answers will be submitted automatically.";

export async function manageTimedQuestionsFlow(req, res) {
  let aesKeyBuffer;
  let initialVectorBuffer;

  try {
    const decrypted = decryptRequest(req.body, PRIVATE_KEY);
    const { decryptedBody } = decrypted;

    aesKeyBuffer = decrypted.aesKeyBuffer;
    initialVectorBuffer = decrypted.initialVectorBuffer;

    const { action, data, flow_token, screen } = decryptedBody;

    console.log("Timed Flow request:", {
      action,
      screen,
      data: JSON.stringify(data ?? {}),
      hasFlowToken: Boolean(flow_token),
    });

    if (action === "ping") {
      res.setHeader("Content-Type", "text/plain");
      return res.send(
        encryptResponse(
          { data: { status: "active" } },
          aesKeyBuffer,
          initialVectorBuffer
        )
      );
    }

    if (action === "INIT") {
      return sendEncryptedResponse(res, {
        screen: "INSTRUCTIONS_SCREEN",
        data: { instructions: TEST_INSTRUCTIONS },
      }, aesKeyBuffer, initialVectorBuffer);
    }

    if (!flow_token) {
      throw new Error("Missing flow_token.");
    }

    const session = timedTestSessions.get(flow_token);

    if (!session) {
      throw new Error(`Timed test session not found: ${flow_token}`);
    }

    // Store userPhone in session if provided in decryptedBody
    if (decryptedBody.userPhone && !session.userPhone) {
      session.userPhone = decryptedBody.userPhone;
    }

    // Preserve attempt history for this Flow session.
    if (!Array.isArray(session.attemptResults)) {
      session.attemptResults = [];
    }

    if (!Number.isInteger(session.attemptNo)) {
      session.attemptNo = 1;
    }

    const requestedAction = data?.user_action;

    let responsePayload;

    // --------------------------------------------------
    // Start attempt 1
    // --------------------------------------------------
    if (
      requestedAction === "START_TEST" &&
      screen === "INSTRUCTIONS_SCREEN"
    ) {
      if (
        !Array.isArray(session.questions) ||
        session.questions.length !== TOTAL_QUESTIONS
      ) {
        throw new Error("The initial question set is invalid.");
      }

      resetAttempt(session, 1);

      responsePayload = buildQuestionResponse(
        session.questions[0],
        0,
        1,
        session
      );
      
      console.log(
        "Timed Flow response payload:",
        JSON.stringify(responsePayload, null, 2)
      );
    }

    // --------------------------------------------------
    // Submit an answer and move through the current attempt
    // --------------------------------------------------
    else if (
      requestedAction === "SUBMIT_AND_NEXT" &&
      screen?.startsWith("QUESTION_SCREEN_")
    ) {
      const screenAttempt = getAttemptNumber(
        screen,
        "QUESTION_SCREEN_"
      );

      if (
        screenAttempt !== session.attemptNo ||
        screenAttempt < 1 ||
        screenAttempt > MAX_ATTEMPTS
      ) {
        throw new Error(
          `Attempt mismatch. Screen=${screenAttempt}, session=${session.attemptNo}`
        );
      }

      if (
        !Array.isArray(session.questions) ||
        session.startTime == null
      ) {
        throw new Error("The active attempt is not initialized.");
      }

      const now = Date.now();
      const elapsed = now - session.startTime;
      const duration = session.durationMs || TEST_DURATION_MS;

      const question = session.questions[session.currentIndex];

      if (!question) {
        throw new Error("The current question could not be found.");
      }

      const selected = String(
        data?.answer ?? data?.user_answer ?? ""
      ).trim().toUpperCase();

      const validAnswer = ["A", "B", "C"].includes(selected);

      // TIME EXPIRED: finish immediately and do not accept a late answer.
      if (elapsed >= duration) {
        responsePayload = await finishAttempt(session, {
          timedOut: true,
        });
      }

      // TIME REMAINS, BUT NO VALID ANSWER: keep the current question.
      else if (!validAnswer) {
        responsePayload = buildQuestionResponse(
          question,
          session.currentIndex,
          session.attemptNo,
          session
        );
      }

      // VALID ANSWER SUBMITTED BEFORE THE DEADLINE.
      else {
        const existing = session.answers.find(
          (item) => item.questionId === question.id
        );

        if (!existing) {
          session.answers.push({
            questionId: question.id,
            selected,
          });

          // Check if the answer is incorrect and add to user's failed questions list
          const isCorrect =
            selected.toUpperCase() === String(question.correct_answer).toUpperCase();

          if (!isCorrect) {
            await addFailedQuestionId(
              session.userPhone,
              question.id
            );
          }
        }

        const isLastQuestion =
          session.currentIndex >= session.questions.length - 1;

        if (isLastQuestion) {
          responsePayload = await finishAttempt(session, {
            timedOut: false,
          });
        } else {
          session.currentIndex += 1;

          responsePayload = buildQuestionResponse(
            session.questions[session.currentIndex],
            session.currentIndex,
            session.attemptNo,
            session
          );
        }
      }
    }

    // --------------------------------------------------
    // Restart: fetch a new question set and start next attempt
    // --------------------------------------------------
    else if (
      requestedAction === "RESTART_TEST" &&
      screen?.startsWith("COMPLETION_SCREEN_")
    ) {
      const completedScreenAttempt = getAttemptNumber(
        screen,
        "COMPLETION_SCREEN_"
      );

      const nextAttempt = Number(data?.attempt);

      if (
        completedScreenAttempt !== session.attemptNo ||
        nextAttempt !== session.attemptNo + 1 ||
        nextAttempt > MAX_ATTEMPTS
      ) {
        throw new Error(
          `Invalid restart. Current=${session.attemptNo}, requested=${nextAttempt}`
        );
      }

      // Fetch a completely new set for the next attempt.
      const freshQuestions = await fetch25QuestionsFromDB(
        "timed_test",
        TOTAL_QUESTIONS
      );

      if (
        !Array.isArray(freshQuestions) ||
        freshQuestions.length !== TOTAL_QUESTIONS
      ) {
        throw new Error(
          `Expected ${TOTAL_QUESTIONS} new questions; received ` +
          `${freshQuestions?.length ?? 0}.`
        );
      }

      session.questions = freshQuestions;
      resetAttempt(session, nextAttempt);

      responsePayload = buildQuestionResponse(
        session.questions[0],
        0,
        nextAttempt,
        session
      );
    }

    else {
      console.warn("Unhandled Timed Flow action:", {
        action,
        screen,
        data,
      });

      throw new Error(
        `Unsupported action "${requestedAction}" on screen "${screen}".`
      );
    }

    return sendEncryptedResponse(
      res,
      responsePayload,
      aesKeyBuffer,
      initialVectorBuffer
    );
  } catch (error) {
    console.error("Timed Test Flow Endpoint Error:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    if (aesKeyBuffer && initialVectorBuffer) {
      try {
        return sendEncryptedResponse(
          res,
          {
            data: {
              error:
                "We could not process this action. Please try again.",
            },
          },
          aesKeyBuffer,
          initialVectorBuffer
        );
      } catch (responseError) {
        console.error(
          "Unable to encrypt error response:",
          responseError.message
        );
      }
    }

    return res.status(421).send("Decryption or Processing Error");
  }
}

// --------------------------------------------------
// Attempt management
// --------------------------------------------------

function resetAttempt(session, attemptNo) {
  session.attemptNo = attemptNo;
  session.currentIndex = 0;
  session.answers = [];
  session.startTime = Date.now();
  session.durationMs = TEST_DURATION_MS;
}

async function finishAttempt(session, { timedOut = false } = {}) {
  const score = calculateTestScore(
    session.questions,
    session.answers
  );

  const durationMs = Math.min(
    Date.now() - session.startTime,
    TEST_DURATION_MS
  );

  const attemptResult = {
    attemptNo: session.attemptNo,
    status: "complete",
    timedOut,
    totalQuestions: session.questions.length,
    answered: session.answers.length,
    correct: score.correct,
    percentage: score.percentage,
    durationMs,
    answers: session.answers.map((answer) => ({ ...answer })),
    finishedAt: new Date().toISOString(),
  };

  session.attemptResults.push(attemptResult);

  console.log("Timed test attempt completed:", {
    attemptNo: attemptResult.attemptNo,
    status: attemptResult.status,
    timedOut: attemptResult.timedOut,
    answered: attemptResult.answered,
    correct: attemptResult.correct,
    percentage: attemptResult.percentage,
  });

  // Save the result using the requested saveResults logic
  if (session.userPhone) {
    try {
      await saveResults({
        user: session.userPhone,
        category: "timed_test",
        status: timedOut ? "timed_out" : "completed",
        no_correct_answers: score.correct,
        no_questions_taken: session.questions.length,
        road_sign_qtn_mark: null,
        traffic_intersection_qtn_mark: null,
        theory_qtn_mark: null,
        time_taken: durationMs,
      });
    } catch (dbError) {
      console.error("Failed to save timed test performance results:", dbError.message);
    }
  }

  return {
    screen: completionScreenId(session.attemptNo),
    data: {
      result_message: timedOut
        ? `⏱️ Time's up — Test ended!`
        : `Test complete!`,

      score_summary:
        `📝 Questions answered: ${attemptResult.answered}/${attemptResult.totalQuestions}\n` +
        `✅ Correct answers: ${attemptResult.correct}/${attemptResult.totalQuestions}\n\n` +
        `⏱️ Time taken: ${formatTime(attemptResult.durationMs)}\n` +
        `🏆 Score: ${attemptResult.percentage}%`,

      next_attempt_prompt:
        session.attemptNo < MAX_ATTEMPTS
          ? `➡️ You can take another test ${MAX_ATTEMPTS - session.attemptNo} more ${MAX_ATTEMPTS - session.attemptNo === 1 ? "time" : "times"}. Tap "Take Another Test" when you're ready.`
          : `🏁 You've completed all ${MAX_ATTEMPTS} attempts.`,
    },
  };
}

function completionScreenId(attemptNo) {
  return `COMPLETION_SCREEN_${getAttemptWord(attemptNo)}`;
}

// --------------------------------------------------
// Build the correct question screen for this attempt
// --------------------------------------------------

function formatTime(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildQuestionResponse(question, index, attemptNo, session) {
  if (!question) {
    throw new Error(`Question not found at index ${index}.`);
  }

  if (!Array.isArray(question.options) || question.options.length !== 3) {
    throw new Error(
      `Question ${index + 1} must contain exactly 3 options.`
    );
  }

  const attemptWord = getAttemptWord(attemptNo);
  const durationMs = session.durationMs || TEST_DURATION_MS;
  const elapsedMs = Date.now() - session.startTime;
  const remainingMs = Math.max(0, durationMs - elapsedMs);

  return {
    screen: `QUESTION_SCREEN_${attemptWord}`,
    data: {
      question_number:
        `Question ${index + 1} of ${session.questions.length}`,

      timer_banner: `⏱️ Time remaining: ${formatTime(remainingMs)}`,

      image_url: question.image_src || "",
      has_image: Boolean(question.image_src),
      image_ratio: 1.77,
      question_text: question.question_text,

      options: question.options.map((option) => ({
        id: String(option.id),
        title: String(option.text),
      })),
    },
  };
}

// --------------------------------------------------
// Encrypted response helper
// --------------------------------------------------

function sendEncryptedResponse(
  res,
  payload,
  aesKeyBuffer,
  initialVectorBuffer
) {
  res.setHeader("Content-Type", "text/plain");

  return res.send(
    encryptResponse(payload, aesKeyBuffer, initialVectorBuffer)
  );
}

// --------------------------------------------------
// Meta WhatsApp Flow request decryption
// --------------------------------------------------

function decryptRequest(body, privatePem) {
  const {
    encrypted_aes_key,
    encrypted_flow_data,
    initial_vector,
  } = body ?? {};

  if (
    !encrypted_aes_key ||
    !encrypted_flow_data ||
    !initial_vector
  ) {
    throw new Error(
      "Meta Flow request is missing encryption fields."
    );
  }

  const formattedKey = privatePem
    .replace(/\\n/g, "\n")
    .trim();

  const privateKey = crypto.createPrivateKey(formattedKey);

  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  if (decryptedAesKey.length !== 16) {
    throw new Error(
      `Unexpected AES key length: ${decryptedAesKey.length} bytes.`
    );
  }

  const flowDataBuffer = Buffer.from(
    encrypted_flow_data,
    "base64"
  );

  const initialVectorBuffer = Buffer.from(
    initial_vector,
    "base64"
  );

  const tagLength = 16;

  if (flowDataBuffer.length <= tagLength) {
    throw new Error("Encrypted Flow payload is invalid.");
  }

  const encryptedBody = flowDataBuffer.subarray(0, -tagLength);
  const authTag = flowDataBuffer.subarray(-tagLength);

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    decryptedAesKey,
    initialVectorBuffer
  );

  decipher.setAuthTag(authTag);

  const decryptedJSONString = Buffer.concat([
    decipher.update(encryptedBody),
    decipher.final(),
  ]).toString("utf8");

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer,
  };
}

// --------------------------------------------------
// Meta WhatsApp Flow response encryption
// --------------------------------------------------

function encryptResponse(
  response,
  aesKeyBuffer,
  initialVectorBuffer
) {
  const flippedIV = Buffer.from(
    initialVectorBuffer.map((byte) => (~byte) & 0xff)
  );

  const cipher = crypto.createCipheriv(
    "aes-128-gcm",
    aesKeyBuffer,
    flippedIV
  );

  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

// --------------------------------------------------
// Test scoring
// --------------------------------------------------

function calculateTestScore(questions, answers) {
  let correctCount = 0;

  for (const answer of answers) {
    const question = questions.find(
      (item) => String(item.id) === String(answer.questionId)
    );

    if (
      question &&
      String(answer.selected).toUpperCase() ===
        String(question.correct_answer).toUpperCase()
    ) {
      correctCount += 1;
    }
  }

  return {
    correct: correctCount,
    percentage: Math.round(
      (correctCount / TOTAL_QUESTIONS) * 100
    ),
  };
}
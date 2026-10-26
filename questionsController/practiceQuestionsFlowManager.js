
import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";
import { practiceTestSessions } from "./practiceTestStore.js";
import { userStatesMap } from "../userStateManager.js";
import {
  fetch25QuestionsFromDB,
  NON_TIMED_TEST_TOTAL_QUESTIONS, saveResults, addFailedQuestionId
} from "./questionsService.js";
dotenv.config();

const PRIVATE_KEY = fs.readFileSync(
  new URL("../private.pem", import.meta.url),
  "utf8"
).trim();

const TOTAL_QUESTIONS = NON_TIMED_TEST_TOTAL_QUESTIONS;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WORDS = ["ONE", "TWO", "THREE", "FOUR", "FIVE"];

const CATEGORIES = [
  { id: "exercise_1", title: "Car Diagrams - Visual right-of-way and junction scenarios testing practical driving positioning.", dbCategory: "exercise_1" },
  { id: "exercise_2", title: "Road Signs - Regulatory, warning, and informative Zimbabwean road sign identification.", dbCategory: "exercise_2" },
  { id: "exercise_3", title: "Theory - General Highway Code rules, road safety regulations, and legal driver duties.", dbCategory: "exercise_3" },
];

function getAttemptWord(attemptNo) {
  const word = ATTEMPT_WORDS[attemptNo - 1];
  if (!word) throw new Error(`Invalid attempt number: ${attemptNo}`);
  return word;
}

function getAttemptNumber(screen, prefix) {
  if (!screen?.startsWith(prefix)) return NaN;
  const word = screen.slice(prefix.length);
  const index = ATTEMPT_WORDS.indexOf(word);
  return index === -1 ? NaN : index + 1;
}

function questionScreenId(attemptNo) {
  return `QUESTION_SCREEN_${getAttemptWord(attemptNo)}`;
}

function completionScreenId(attemptNo) {
  return `COMPLETION_SCREEN_${getAttemptWord(attemptNo)}`;
}


async function fetchAttemptQuestions(category) {
  const questions = await fetch25QuestionsFromDB(
    category,
    TOTAL_QUESTIONS
  );

  if (
    !Array.isArray(questions) ||
    questions.length !== TOTAL_QUESTIONS
  ) {
    throw new Error(
      `Expected ${TOTAL_QUESTIONS} questions for ${category}; ` +
      `received ${questions?.length ?? 0}.`
    );
  }

  return questions;
}


export async function managePracticeQuestionsFlow(req, res) {
  let aesKeyBuffer;
  let initialVectorBuffer;

  try {
    const decrypted = decryptRequest(req.body, PRIVATE_KEY);
    const { decryptedBody } = decrypted;

    aesKeyBuffer = decrypted.aesKeyBuffer;
    initialVectorBuffer = decrypted.initialVectorBuffer;

    const { action, data, flow_token, screen } = decryptedBody;
    const userAction = data?.user_action;

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
      return sendEncryptedResponse(
        res,
        {
          screen: "INSTRUCTIONS_SCREEN",
          data: {
            instructions:
              "Practise up to 5 attempts of 25 road code questions at your own pace. " +
              "Choose a category, answer each question, and learn from the explanation after every answer.",
            categories: CATEGORIES.map(({ id, title }) => ({
              id,
              title,
            })),
          },
        },
        aesKeyBuffer,
        initialVectorBuffer
      );
    }

    if (!flow_token) {
      throw new Error("Missing flow_token.");
    }

    let session = practiceTestSessions.get(flow_token);
    let responsePayload;

    // Start the first attempt after the learner chooses a category.
    if (
      userAction === "START_TEST" &&
      screen === "INSTRUCTIONS_SCREEN"
    ) {
      const selectedCategory = CATEGORIES.find(
        (item) => item.id === data?.category
      );

      if (!selectedCategory) {
        throw new Error("Please select a valid exercise.");
      }

      const questions = await fetchAttemptQuestions(selectedCategory.dbCategory,  TOTAL_QUESTIONS);

      console.log("[Practice Flow] Decrypted body:", {
        userPhone: decryptedBody?.userPhone,
        keys: Object.keys(decryptedBody ?? {}),
      });

      
      session = {
        userPhone: session?.userPhone,
        category: selectedCategory.dbCategory,
        categoryTitle: selectedCategory.title,
        attemptNo: 1,
        attemptResults: [],
        questions,
        currentIndex: 0,
        answers: [],
        pendingAnswer: null,
        completed: false,
        startedAt: Date.now(),
      };

      if (!session.userPhone) {
        throw new Error(
          `Learner phone number missing for flow_token: ${flow_token}`
        );
      }

      practiceTestSessions.set(flow_token, session);
      responsePayload = buildQuestionResponse(session);

    }

    // CONTINUE first checks an answer, then advances after feedback.
    else if (
      userAction === "CONTINUE" &&
      screen?.startsWith("QUESTION_SCREEN_")
    ) {
      requireActiveSession(session);

      const screenAttempt = getAttemptNumber(
        screen,
        "QUESTION_SCREEN_"
      );

      if (screenAttempt !== session.attemptNo) {
        throw new Error(
          "The question screen does not match the active attempt."
        );
      }

      if (session.pendingAnswer) {
        // Feedback has already been shown; record the answer and advance.
        session.answers.push(session.pendingAnswer);
        session.pendingAnswer = null;

        if (session.currentIndex >= TOTAL_QUESTIONS - 1) {
          await recordAttemptResult(session);

          if (session.attemptNo === MAX_ATTEMPTS) {
            session.completed = true;
          }

          responsePayload = buildCompletionResponse(session);
        } else {
          session.currentIndex += 1;
          responsePayload = buildQuestionResponse(session);
        }
      } else {
        // First click: check the selected answer and display feedback.
        const question = session.questions[session.currentIndex];

        if (!question) {
          throw new Error("Current question not found.");
        }

        const selected = String(data?.answer || "").trim();

        const selectedOption = question.options?.find(
          (option) => String(option.id) === selected
        );

        if (!selectedOption) {
          throw new Error(
            "Please select one of the available answers."
          );
        }

        const correctAnswer = String(
          question.correct_answer ?? ""
        ).trim();

        const correctOption = question.options.find(
          (option) =>
            String(option.id).toUpperCase() ===
            correctAnswer.toUpperCase()
        );

        const isCorrect =
          selected.toUpperCase() === correctAnswer.toUpperCase();

        if (!isCorrect) {
  console.log("[Practice Flow] Failed question:", {
    sessionUserPhone: session.userPhone,
    questionId: question.id,
    session,
  });

  await addFailedQuestionId(
    session.userPhone,
    question.id
  );
}
          
        console.log("[FailedQuestions] Explanation check:", {
        questionId: question.id,
        explanation: question.explanation,
        explanationType: typeof question.explanation,
        });


        session.pendingAnswer = {
          questionId: question.id,
          selected,
          isCorrect,
          selectedAnswer: String(
            selectedOption.text ?? selected
          ),
          correctAnswer: String(
            correctOption?.text ?? correctAnswer
          ),
          explanation: String(
            question.explanation ||
              question.answer_explanation ||
              question.rationale ||
              "No explanation is available for this question."
          ),
        };

        responsePayload = buildQuestionResponse(session, true);
      }
    }

    // Fetch a fresh set of questions for the next attempt.
    else if (
      userAction === "NEXT_ATTEMPT" &&
      screen?.startsWith("COMPLETION_SCREEN_")
    ) {
      requireActiveSession(session);

      const screenAttempt = getAttemptNumber(
        screen,
        "COMPLETION_SCREEN_"
      );

      if (screenAttempt !== session.attemptNo) {
        throw new Error(
          "The completion screen does not match the active attempt."
        );
      }

      if (session.attemptNo >= MAX_ATTEMPTS) {
        throw new Error(
          "All five practice attempts have already been completed."
        );
      }

      const questions = await fetchAttemptQuestions(
        session.category
      );

      session.attemptNo += 1;
      session.questions = questions;
      session.currentIndex = 0;
      session.answers = [];
      session.pendingAnswer = null;
      session.completed = false;
      session.startedAt = Date.now();

      responsePayload = buildQuestionResponse(session);
    } else {
      throw new Error(
        `Unsupported action "${userAction}" on screen "${screen}".`
      );
    }

    return sendEncryptedResponse(
      res,
      responsePayload,
      aesKeyBuffer,
      initialVectorBuffer
    );
  } catch (error) {
    console.error("Practice Flow error:", {
      message: error.message,
      stack: error.stack,
    });

    if (aesKeyBuffer && initialVectorBuffer) {
      try {
        return sendEncryptedResponse(
          res,
          {
            data: {
              error:
                "We could not process your request. Please try again.",
            },
          },
          aesKeyBuffer,
          initialVectorBuffer
        );
      } catch (responseError) {
        console.error(
          "Could not encrypt error response:",
          responseError.message
        );
      }
    }

    return res.status(421).send(
      "Decryption or Processing Error"
    );
  }
}

function requireActiveSession(session) {
  if (
    !session ||
    session.completed ||
    !Array.isArray(session.questions) ||
    session.questions.length !== TOTAL_QUESTIONS ||
    !Array.isArray(session.answers) ||
    !Number.isInteger(session.attemptNo)
  ) {
    throw new Error("No active practice session was found.");
  }
}

function buildQuestionResponse(session, showFeedback = false) {
  const question = session.questions[session.currentIndex];

  if (!question) {
    throw new Error("Question not found.");
  }

  if (
    !Array.isArray(question.options) ||
    question.options.length !== 3
  ) {
    throw new Error(
      `Question ${session.currentIndex + 1} must have 3 options.`
    );
  }

  const pending = session.pendingAnswer;

  return {
    screen: questionScreenId(session.attemptNo),
    data: {
      mode: showFeedback ? "feedback" : "question",

      question_number:
        `Attempt ${session.attemptNo} of ${MAX_ATTEMPTS} — ` +
        `Question ${session.currentIndex + 1} of ${TOTAL_QUESTIONS}`,

      image_url: question.image_src || "",
      has_image: Boolean(question.image_src),
      image_ratio: 1.77,
      question_text: question.question_text,

      options: question.options.map((option) => ({
        id: String(option.id),
        title: String(option.text),
      })),

      show_options: !showFeedback,
      show_feedback: showFeedback,

      feedback: showFeedback
        ? pending?.isCorrect
          ? "✅ Correct! Well done."
          : "❌ Not quite. Review the correct answer below."
        : "",

      selected_answer: showFeedback
        ? String(pending?.selectedAnswer ?? "")
        : "",

      correct_answer: showFeedback
        ? String(pending?.correctAnswer ?? "")
        : "",

      explanation: showFeedback
        ? String(pending?.explanation ?? "")
        : "",

      button_label: showFeedback
        ? session.currentIndex === TOTAL_QUESTIONS - 1
          ? "Finish Attempt"
          : "Next Question"
        : "Check Answer",
    },
  };
}

async function recordAttemptResult(session) {
  const correct = session.answers.filter(
    (answer) => answer.isCorrect
  ).length;

  const percentage = Math.round(
    (correct / TOTAL_QUESTIONS) * 100
  );

  const durationMs = Date.now() - session.startedAt;

  const attemptResult = {
    attemptNo: session.attemptNo,
    answered: session.answers.length,
    correct,
    percentage,
    durationMs,
  };

  session.attemptResults.push(attemptResult);

  // Save results to the database
  try {
    await saveResults({
      user: session.userPhone,
      category: session.category, // e.g., "exercise_1", "exercise_2", "exercise_3"
      status: "completed",
      no_correct_answers: correct,
      no_questions_taken: TOTAL_QUESTIONS,
      road_sign_qtn_mark: session.category === "exercise_2" ? correct : null,
      traffic_intersection_qtn_mark: session.category === "exercise_1" ? correct : null,
      theory_qtn_mark: session.category === "exercise_3" ? correct : null,
      time_taken: durationMs,
    });
  } catch (error) {
    console.error("Failed to save practice performance results:", error.message);
  }
}

function buildCompletionResponse(session) {
  const result =
    session.attemptResults[session.attemptResults.length - 1];

  if (!result) {
    throw new Error("Attempt result was not recorded.");
  }

  let scoreSummary =
    `Exercise: ${session.categoryTitle}\n` +
    `Attempt: ${result.attemptNo} of ${MAX_ATTEMPTS}\n\n` +
    `Questions answered: ${result.answered}/${TOTAL_QUESTIONS}\n` +
    `Correct answers: ${result.correct}/${TOTAL_QUESTIONS}\n` +
    `Attempt score: ${result.percentage}%`;

  const completionMessage =
    result.attemptNo < MAX_ATTEMPTS
      ? `Good work. You can start attempt ${
          result.attemptNo + 1
        } with a fresh set of 25 questions.`
      : "You have completed all five practice attempts. Keep practising to strengthen your road code knowledge.";

  if (result.attemptNo === MAX_ATTEMPTS) {
    const totalAnswered = session.attemptResults.reduce(
      (sum, item) => sum + item.answered,
      0
    );

    const totalCorrect = session.attemptResults.reduce(
      (sum, item) => sum + item.correct,
      0
    );

    const overallPercentage = totalAnswered
      ? Math.round((totalCorrect / totalAnswered) * 100)
      : 0;

    const attemptLines = session.attemptResults
      .map(
        (item) =>
          `Attempt ${item.attemptNo}: ${item.correct}/${TOTAL_QUESTIONS} (${item.percentage}%)`
      )
      .join("\n");

    scoreSummary +=
      `\n\nOverall score: ${totalCorrect}/${totalAnswered} (${overallPercentage}%)` +
      `\n\nAttempt breakdown:\n${attemptLines}`;
  }

  return {
    screen: completionScreenId(session.attemptNo),
    data: {
      result_message:
        result.attemptNo < MAX_ATTEMPTS
          ? `Attempt ${result.attemptNo} of ${MAX_ATTEMPTS} complete!`
          : "All 5 practice attempts complete!",

      score_summary: scoreSummary,
      completion_message: completionMessage,
    },
  };
}

// Meta WhatsApp Flow encryption helpers.
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
    throw new Error("Missing Meta Flow encryption fields.");
  }

  const privateKey = crypto.createPrivateKey(
    privatePem.replace(/\\n/g, "\n").trim()
  );

  const aesKeyBuffer = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  if (aesKeyBuffer.length !== 16) {
    throw new Error("Unexpected AES key length.");
  }

  const initialVectorBuffer = Buffer.from(
    initial_vector,
    "base64"
  );

  const encryptedBuffer = Buffer.from(
    encrypted_flow_data,
    "base64"
  );

  if (encryptedBuffer.length <= 16) {
    throw new Error("Invalid encrypted Flow payload.");
  }

  const ciphertext = encryptedBuffer.subarray(0, -16);
  const authTag = encryptedBuffer.subarray(-16);

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    aesKeyBuffer,
    initialVectorBuffer
  );

  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return {
    decryptedBody: JSON.parse(plaintext),
    aesKeyBuffer,
    initialVectorBuffer,
  };
}

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

function sendEncryptedResponse(
  res,
  payload,
  aesKeyBuffer,
  initialVectorBuffer
) {
  res.setHeader("Content-Type", "text/plain");

  return res.send(
    encryptResponse(
      payload,
      aesKeyBuffer,
      initialVectorBuffer
    )
  );
}

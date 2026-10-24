// questionsController/failedSuestionsFlowManager.js

import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";

import { practiceTestSessions } from "./practiceTestStore.js";

import {
  getFailedQuestionIds,
  fetchQuestionsByIdsFromDB,
  removeFailedQuestionId,
} from "./questionsService.js";

dotenv.config();

const PRIVATE_KEY = fs.readFileSync(
  new URL("../private.pem", import.meta.url),
  "utf8"
).trim();

const MAX_ATTEMPTS = 5;
const ATTEMPT_WORDS = ["ONE", "TWO", "THREE", "FOUR", "FIVE"];

// --------------------------------------------------
// Screen helpers
// --------------------------------------------------

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

function questionScreenId(attemptNo) {
  return `QUESTION_SCREEN_${getAttemptWord(attemptNo)}`;
}

function completionScreenId(attemptNo) {
  return `COMPLETION_SCREEN_${getAttemptWord(attemptNo)}`;
}

// --------------------------------------------------
// Failed-question loading
// --------------------------------------------------

async function fetchFailedQuestions(userPhone) {
  const failedIds = await getFailedQuestionIds(userPhone);

  if (!failedIds.length) {
    return [];
  }

  return fetchQuestionsByIdsFromDB(failedIds);
}

// --------------------------------------------------
// Main Flow manager
// --------------------------------------------------

export async function manageFailedQuestionsFlow(req, res) {
  let aesKeyBuffer;
  let initialVectorBuffer;

  try {
    const decrypted = decryptRequest(req.body, PRIVATE_KEY);
    const { decryptedBody } = decrypted;

    aesKeyBuffer = decrypted.aesKeyBuffer;
    initialVectorBuffer = decrypted.initialVectorBuffer;

    const { action, data, flow_token, screen } = decryptedBody;
    const userAction = data?.user_action;

    // Health check from Meta.
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

    if (!flow_token) {
      throw new Error("Missing flow_token.");
    }

    let session = practiceTestSessions.get(flow_token);
    let responsePayload;

    // --------------------------------------------------
    // INIT: show failed-question instructions
    // --------------------------------------------------

    if (action === "INIT") {
      if (!session) {
        throw new Error(
          "Failed-question session not found. Please start the Flow again."
        );
      }

      const questionCount = Array.isArray(session.questions)
        ? session.questions.length
        : 0;

      responsePayload = {
        screen: "INSTRUCTIONS_SCREEN",
        data: {
          instructions:
            questionCount > 0
              ? "Retry questions you previously answered incorrectly. " +
                "Answer each question, review the feedback, and try again. " +
                "You can make up to 5 attempts. Questions you answer correctly " +
                "will be removed from your retry list."
              : "You currently have no failed questions to retry. " +
                "Continue practising to improve your road code knowledge.",

          failed_count: questionCount,
          has_failed_questions: questionCount > 0,
          start_button_label:
            questionCount > 0
              ? "Start Retry"
              : "No Questions to Retry",
        },
      };

      return sendEncryptedResponse(
        res,
        responsePayload,
        aesKeyBuffer,
        initialVectorBuffer
      );
    }

    // --------------------------------------------------
    // START_RETRY: begin attempt 1
    // --------------------------------------------------

    if (
      userAction === "START_RETRY" &&
      screen === "INSTRUCTIONS_SCREEN"
    ) {
      requireRetrySession(session);

      const questions = session.questions;

      if (!questions.length) {
        responsePayload = {
          screen: "INSTRUCTIONS_SCREEN",
          data: {
            instructions:
              "You currently have no failed questions to retry.",
            failed_count: 0,
            has_failed_questions: false,
            start_button_label: "No Questions to Retry",
          },
        };
      } else {
        session.attemptNo = 1;
        session.currentIndex = 0;
        session.answers = [];
        session.pendingAnswer = null;
        session.attemptResults = [];
        session.completed = false;
        session.startedAt = Date.now();

        responsePayload = buildQuestionResponse(session);
      }
    }

    // --------------------------------------------------
    // CONTINUE: check an answer or advance after feedback
    // --------------------------------------------------

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

      const question = session.questions[session.currentIndex];

      if (!question) {
        throw new Error("Current failed question was not found.");
      }

      // Second click: feedback was already shown.
      // Record the answer and advance to the next question.
      if (session.pendingAnswer) {
        session.answers.push(session.pendingAnswer);
        session.pendingAnswer = null;

        // Reload the IDs from the database to determine whether
        // the learner has cleared all failed questions.
        const remainingIds = await getFailedQuestionIds(
          session.userPhone
        );

        if (
          remainingIds.length === 0 ||
          session.currentIndex >= session.questions.length - 1
        ) {
          recordAttemptResult(session);

          session.completed =
            remainingIds.length === 0 ||
            session.attemptNo >= MAX_ATTEMPTS;

          responsePayload = await buildCompletionResponse(
            session,
            remainingIds.length
          );
        } else {
          session.currentIndex += 1;

          responsePayload = buildQuestionResponse(session);
        }
      }

      // First click: check the selected answer and show feedback.
      else {
        const selected = String(data?.answer || "")
          .trim()
          .toUpperCase();

        const selectedOption = question.options?.find(
          (option) =>
            String(option.id).trim().toUpperCase() === selected
        );

        if (!selectedOption) {
          throw new Error(
            "Please select one of the available answers."
          );
        }

        const correctAnswer = String(
          question.correct_answer ?? ""
        )
          .trim()
          .toUpperCase();

        const correctOption = question.options?.find(
          (option) =>
            String(option.id).trim().toUpperCase() ===
            correctAnswer
        );

        const isCorrect = selected === correctAnswer;

        // Remove a correctly answered question from failed_Qtns.
        // Incorrectly answered questions remain available for retry.
        if (isCorrect) {
          await removeFailedQuestionId(
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
              "No explanation is available for this question."
          ),
        };

        responsePayload = buildQuestionResponse(
          session,
          true
        );
      }
    }

    // --------------------------------------------------
    // NEXT_ATTEMPT: fetch the remaining failed IDs afresh
    // --------------------------------------------------

    else if (
      userAction === "NEXT_ATTEMPT" &&
      screen?.startsWith("COMPLETION_SCREEN_")
    ) {
      requireRetrySession(session);

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
          "All five retry attempts have already been completed."
        );
      }

      // Do not reuse the previous attempt's question list.
      // Load only questions whose IDs remain in failed_Qtns.
      const questions = await fetchFailedQuestions(
        session.userPhone
      );

      if (!questions.length) {
        session.completed = true;

        responsePayload = await buildCompletionResponse(
          session,
          0
        );
      } else {
        session.attemptNo += 1;
        session.questions = questions;
        session.failedQuestionIds = questions.map(
          (question) => Number(question.id)
        );

        session.currentIndex = 0;
        session.answers = [];
        session.pendingAnswer = null;
        session.completed = false;
        session.startedAt = Date.now();

        responsePayload = buildQuestionResponse(session);
      }
    }

    else {
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
    console.error("Failed Questions Flow error:", {
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

// --------------------------------------------------
// Session validation
// --------------------------------------------------

function requireRetrySession(session) {
  if (
    !session ||
    session.mode !== "failed_questions" ||
    !session.userPhone ||
    !Array.isArray(session.questions) ||
    !Array.isArray(session.answers) ||
    !Number.isInteger(session.attemptNo)
  ) {
    throw new Error("No active failed-questions session was found.");
  }
}

function requireActiveSession(session) {
  requireRetrySession(session);

  if (
    session.completed ||
    session.questions.length === 0 ||
    session.currentIndex < 0 ||
    session.currentIndex >= session.questions.length
  ) {
    throw new Error("No active failed question was found.");
  }
}

// --------------------------------------------------
// Question response
// --------------------------------------------------

function buildQuestionResponse(session, showFeedback = false) {
  const question = session.questions[session.currentIndex];

  if (!question) {
    throw new Error("Failed question not found.");
  }

  if (
    !Array.isArray(question.options) ||
    question.options.length !== 3
  ) {
    throw new Error(
      `Question ${question.id} must have exactly 3 options.`
    );
  }

  const pending = session.pendingAnswer;
  const totalQuestions = session.questions.length;

  return {
    screen: questionScreenId(session.attemptNo),

    data: {
      mode: showFeedback ? "feedback" : "question",

      question_number:
        `Question ${session.currentIndex + 1} of ${totalQuestions}`,

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
          ? "✅ Correct! This question has been removed from your retry list."
          : "❌ Not quite. This question will remain on your retry list."
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
        ? session.currentIndex === totalQuestions - 1
          ? "Finish Attempt"
          : "Next Question"
        : "Check Answer",
    },
  };
}

// --------------------------------------------------
// Attempt results and completion
// --------------------------------------------------

function recordAttemptResult(session) {
  const totalQuestions = session.questions.length;

  const correct = session.answers.filter(
    (answer) => answer.isCorrect
  ).length;

  const answered = session.answers.length;

  const percentage = answered
    ? Math.round((correct / answered) * 100)
    : 0;

  session.attemptResults.push({
    attemptNo: session.attemptNo,
    answered,
    totalQuestions,
    correct,
    percentage,
  });
}

async function buildCompletionResponse(
  session,
  remainingFailedCount
) {
  const result =
    session.attemptResults[
      session.attemptResults.length - 1
    ];

  if (!result) {
    throw new Error("Attempt result was not recorded.");
  }

  const canRetry =
    remainingFailedCount > 0 &&
    session.attemptNo < MAX_ATTEMPTS;

  const isFinal = !canRetry;

  let scoreSummary =
    `Attempt: ${result.attemptNo} of ${MAX_ATTEMPTS}\n\n` +
    `Questions answered: ${result.answered}/${result.totalQuestions}\n` +
    `Correct answers: ${result.correct}/${result.answered}\n` +
    `Score: ${result.percentage}%\n\n` +
    `Failed questions remaining: ${remainingFailedCount}`;

  if (session.attemptNo === MAX_ATTEMPTS) {
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
          `Failed Questions retry Attempt ${item.attemptNo}: ` +
          `${item.correct}/${item.answered} ` +
          `(${item.percentage}%)`
      )
      .join("\n");

    scoreSummary +=
      `\n\nOverall score: ${totalCorrect}/${totalAnswered} ` +
      `(${overallPercentage}%)` +
      `\n\nFailed Questions retry breakdown:\n${attemptLines}`;
  }

  let completionMessage;

  if (remainingFailedCount === 0) {
    completionMessage =
      "🎉 Excellent work! You have answered all your failed " +
      "questions correctly. Your failed-question retry list is clear.";
  } else if (session.attemptNo >= MAX_ATTEMPTS) {
    completionMessage =
      "You have completed all five attempts. Some questions " +
      "remain on your retry list. Keep practising and try again later.";
  } else {
    completionMessage =
      `${remainingFailedCount} failed question(s) remain. ` +
      `Start Failed Questions retry attempt ${session.attemptNo + 1} to retry them.`;
  }

  return {
    screen: completionScreenId(session.attemptNo),

    data: {
      result_message:
        remainingFailedCount === 0
          ? "🎉 All failed questions cleared!"
          : `Failed Questions retry complete!`,

      score_summary: scoreSummary,
      completion_message: completionMessage,

      remaining_failed_count: remainingFailedCount,
      can_retry: canRetry,
      is_final: isFinal,

      next_button_label: canRetry
        ? "Retry Remaining Questions"
        : "Finish",
    },
  };
}

// --------------------------------------------------
// Meta WhatsApp Flow encryption helpers
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
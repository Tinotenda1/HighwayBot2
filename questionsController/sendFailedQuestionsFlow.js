// questionsController/sendFailedQuestionsFlow.js
import axios from "axios";
import dotenv from "dotenv";
import pool from "../db.js";
import { practiceTestSessions } from "./practiceTestStore.js";
import { fetchQuestionsByIdsFromDB } from "./questionsService.js";

dotenv.config();

function parseFailedQuestionIds(value) {
  if (value == null || String(value).trim() === "") {
    return [];
  }

  return [
    ...new Set(
      String(value)
        .split(",")
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    )
  ];
}

async function getFailedQuestionIds(user) {
  const [rows] = await pool.execute(
    "SELECT failed_Qtns FROM users WHERE phone = ? LIMIT 1",
    [user]
  );

  if (!rows.length) {
    throw new Error("Learner account was not found.");
  }

  return parseFailedQuestionIds(rows[0].failed_Qtns);
}

async function sendWhatsAppText(user, message, token, phoneNumberId) {
  return axios({
    method: "POST",
    url: `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    data: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: user,
      type: "text",
      text: {
        body: message
      }
    }
  });
}

export async function sendFailedQuestionsFlow(user) {
  const WHATSAPP_TOKEN = process.env.GRAPH_API_TOKEN;
  const PHONE_NUMBER_ID = process.env.MY_PHONE_NUMBER_ID;
  const FLOW_ID = process.env.FAILED_QUESTIONS_FLOW_ID;

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error(
      "Missing GRAPH_API_TOKEN or MY_PHONE_NUMBER_ID."
    );

    return {
      success: false,
      error: "WhatsApp configuration is incomplete."
    };
  }

  let flowToken;

  try {
    // Load the failed question IDs.
    const failedQuestionIds = await getFailedQuestionIds(user);

    console.log("[FailedQuestionsSender] Failed IDs loaded:", {
      phone: `********${String(user).slice(-4)}`,
      count: failedQuestionIds.length
    });

    // No failed questions: send a normal WhatsApp message.
    if (failedQuestionIds.length === 0) {
      const response = await sendWhatsAppText(
        user,
        "🎉 You have no failed questions to retry!\n\n" +
          "Keep practising to maintain your progress. " +
          "If you get a question wrong in a future practice test, " +
          "you can return here to retry it.\n\nType *Menu* for the Assistant's Main Menu.",
        WHATSAPP_TOKEN,
        PHONE_NUMBER_ID
      );

      console.log(
        "[FailedQuestionsSender] No failed questions; message sent."
      );

      return {
        success: true,
        noFailedQuestions: true,
        data: response.data
      };
    }

    // Load question data using the existing questions service.
    const questions = await fetchQuestionsByIdsFromDB(
      failedQuestionIds
    );

    if (questions.length === 0) {
      const response = await sendWhatsAppText(
        user,
        "I couldn't load your failed questions right now. " +
          "Please try again shortly.",
        WHATSAPP_TOKEN,
        PHONE_NUMBER_ID
      );

      console.error(
        "[FailedQuestionsSender] Failed IDs exist, but no questions loaded."
      );

      return {
        success: false,
        error: "Failed questions could not be loaded.",
        data: response.data
      };
    }

    if (!FLOW_ID) {
      console.error("Missing FAILED_QUESTIONS_FLOW_ID.");

      return {
        success: false,
        error: "Failed-questions Flow configuration is incomplete."
      };
    }

    // Create a unique token for this retry session.
    flowToken = `${user}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // Save the loaded questions for the Flow manager.
    practiceTestSessions.set(flowToken, {
      userPhone: user,
      mode: "failed_questions",
      category: "failed_questions",
      categoryTitle: "Failed Questions",
      failedQuestionIds: questions.map((question) => Number(question.id)),
      currentIndex: 0,
      questions,
      answers: [],
      pendingAnswer: null,
      attemptNo: 1,
      attemptResults: [],
      completed: false,
      startedAt: null
    });

    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      data: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: user,
        type: "interactive",
        interactive: {
          type: "flow",
          header: {
            type: "text",
            text: "Retry Failed Questions"
          },
          body: {
            text:
              "📘 *Failed Questions Practice*\n\n" +
              `You currently have ${questions.length} failed ` +
              "question(s) to retry.\n\n" +
              "🔁 Retry questions you previously answered incorrectly.\n" +
              "💡 Review feedback and explanations as you practise.\n" +
              "📊 You can retry across up to 5 attempts.\n\n" +
              "Open the Flow to begin! \n\nType *Menu* for the Assistant's Main Menu."
          },
          footer: {
            text: "Driver's Licence Assistant"
          },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: flowToken,
              flow_id: FLOW_ID,
              flow_cta: "Retry Questions",
              flow_action: "data_exchange"
            }
          }
        }
      }
    });

    console.log(
      "[FailedQuestionsSender] Failed-questions Flow sent successfully."
    );

    return {
      success: true,
      data: response.data,
      flowToken
    };
  } catch (error) {
    if (flowToken) {
      practiceTestSessions.delete(flowToken);
    }

    console.error(
      "[FailedQuestionsSender] Error:",
      error.response?.data || error.message
    );

    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

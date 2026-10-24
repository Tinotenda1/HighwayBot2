
 // questionsController/sendPracticeTestFlow.js
import axios from "axios";
import dotenv from "dotenv";
import { practiceTestSessions } from "./practiceTestStore.js";
import { fetch25QuestionsFromDB } from "./questionsService.js";

dotenv.config();

const TOTAL_QUESTIONS = Number(
  process.env.NON_TIMED_TEST_TOTAL_QUESTIONS || 25
);

const PRACTICE_CATEGORIES = {
  exercise_1: {
    title: "Car Diagrams",
    dbCategory: "Car Diagrams"
  },
  exercise_2: {
    title: "Road Signs",
    dbCategory: "Road Signs"
  },
  exercise_3: {
    title: "Theory",
    dbCategory: "Theory"
  }
};

export async function sendPracticeTestFlow(user) {
  const WHATSAPP_TOKEN = process.env.GRAPH_API_TOKEN;
  const PHONE_NUMBER_ID = process.env.MY_PHONE_NUMBER_ID;
  const FLOW_ID = process.env.NON_TIMED_TEST_FLOW_ID;

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !FLOW_ID) {
    console.error(
      "Missing GRAPH_API_TOKEN, MY_PHONE_NUMBER_ID, or NON_TIMED_TEST_FLOW_ID."
    );

    return {
      success: false,
      error: "Practice test Flow configuration is incomplete."
    };
  }

  // Create a unique token for this practice session.
  const flowToken = `${user}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    // Create a session before opening the Flow.
    // Questions are fetched after the learner selects an exercise.
    practiceTestSessions.set(flowToken, {
      userPhone: user,
      category: null,
      categoryTitle: null,
      currentIndex: 0,
      questions: [],
      answers: [],
      pendingAnswer: null,
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
            text: "VID Practice Test"
          },
          body: {
            text:
              "📘 *Specialized Practice Tests*\n\n" +
              "Improve your provisional driver's licence knowledge " +
              "with focused exercises.\n\n" +
              "🚗 Car Diagrams\n" +
              "🚦 Road Signs\n" +
              "📝 Theory\n\n" +
              "✅ Answer at your own pace.\n" +
              "💡 Get instant feedback and explanations after each answer.\n" +
              "📊 See your score when you finish 25 questions.\n\n" +
              "Choose an exercise to begin!\n\nType *Menu* for the Assistant's Main Menu."
          },
          footer: {
            text: "Driver's License Assistant"
          },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: flowToken,
              flow_id: FLOW_ID,
              flow_cta: "Start Practice",
              flow_action: "data_exchange"
            }
          }
        }
      }
    });

    console.log(
      "Practice test Flow message sent successfully:",
      response.data
    );

    return {
      success: true,
      data: response.data,
      flowToken
    };
  } catch (error) {
    // Remove the unused session if sending the message fails.
    practiceTestSessions.delete(flowToken);

    console.error(
      "Error sending practice test Flow:",
      error.response?.data || error.message
    );

    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

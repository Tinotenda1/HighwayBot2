
// questionsController/sendTimedTestFlow.js
import axios from "axios";
import dotenv from "dotenv";
import { timedTestSessions } from "./timedTestStore.js";
import { fetch25QuestionsFromDB } from "./questionsService.js";
dotenv.config();

export async function sendTimedTestFlow(user) {
  const WHATSAPP_TOKEN = process.env.GRAPH_API_TOKEN;
  const PHONE_NUMBER_ID = process.env.MY_PHONE_NUMBER_ID; // Your verified phone number ID
  const FLOW_ID = process.env.TIMED_TEST_FLOW_ID;    // Replace with your created Flow ID from WhatsApp Manager
const TIMED_TEST_DURATION_MS = Number(process.env.TIMED_TEST_DURATION_MS || 8 * 60 * 1000); // 8 minutes in milliseconds
const TOTAL_QUESTIONS = Number(process.env.TIMED_TEST_TOTAL_QUESTIONS || 25); // Total number of questions in the timed test
  // Generate a unique session ID for this test
const flowToken = `${user}_${Date.now()}`;

  try {
    // Fetch questions BEFORE sending the Flow
    const questions = await fetch25QuestionsFromDB("timed_test");

    if (!questions || questions.length !== TOTAL_QUESTIONS) {
        throw new Error(
        `Expected ${TOTAL_QUESTIONS} questions, but received ${questions?.length ?? 0}`
        );
    }

    // Prepare the session, but do not start the timer yet
    timedTestSessions.set(flowToken, {
        userPhone: user,
        currentIndex: 0,
        questions,
        answers: [],
        startTime: null,
        durationMs: TIMED_TEST_DURATION_MS,
    });

    // Send the flow
    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
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
            text: "VID Road Rules Test"
          },
          body: {
            text: "⏳ *Timed Practice Test* – Challenge yourself under real exam conditions! This *8-Minute Timed Test* simulates the actual Provisional License Test. \n\n✅ Consistently score 100% and you are good to go! \n\n🚀 Ready? \n\nType *Menu* for the Assistant's Main Menu."
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
            flow_cta: "Start Timed Test",
            flow_action: "data_exchange"
            }
          }
        }
      }
    });

    console.log("✅ Timed test flow message sent successfully:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Error sending timed test flow:", error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}


import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

export async function sendHighwayCodeCourseFlow(user) {
  const token = process.env.GRAPH_API_TOKEN;
  const phoneNumberId = process.env.MY_PHONE_NUMBER_ID;
  const flowId = process.env.HIGHWAY_CODE_COURSE_FLOW_ID;

  if (!token || !phoneNumberId || !flowId) {
    return {
      success: false,
      error: "Missing WhatsApp Flow configuration."
    };
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: user,
        type: "interactive",
        interactive: {
          type: "flow",
          header: {
            type: "text",
            text: "Highway Code Course"
          },
          body: {
            text:
              "📘 *Highway Code Course*\n\n" +
              "Study the lessons at your own pace. " +
              "Your lesson content is loaded from our course database.\n\n" +
              "Tap below to begin."
          },
          footer: {
            text: "Driver's Licence Assistant"
          },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_id: flowId,
              flow_cta: "Start Course",
              flow_action: "data_exchange"
            }
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(
      "[HighwayCodeCourseFlow] Flow sent:",
      response.data?.messages?.[0]?.id
    );

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error(
      "[HighwayCodeCourseFlow] Send error:",
      error.response?.data || error.message
    );

    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

export default sendHighwayCodeCourseFlow;

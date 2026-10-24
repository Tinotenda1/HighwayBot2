 // messagesController/sendMessage.js

import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

async function sendMessageFunction(businessPhoneNumberId, user, messageId, messageData) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        to: user,
        text: { body: messageData },
        context: {
          message_id: messageId,
        },
      },
    });
  } catch (error) {
    console.error("Error sending other messages:", error.message);
  }
}

async function sendIrideCode(to, message) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.MY_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ iRide code sent successfully:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Failed to send iRide code:", error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}


async function sendDriftOTP(to, otpCode, appAction, supportPhone, templateName) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.MY_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to, // Recipient phone number (e.g. "263771234567")
        type: "template",
        template: {
          name: templateName || "drift_verification",
          language: {
            code: "en_US", // Matches "English (US)" from Meta Manager
          },
          components: [
            // 1. Body parameters for {{1}}, {{2}}, {{3}}
            {
              type: "body",
              parameters: [
                { type: "text", text: String(otpCode) },      // {{1}} -> e.g. "12345"
                { type: "text", text: String(appAction) },    // {{2}} -> e.g. "Login"
                { type: "text", text: String(supportPhone) }, // {{3}} -> e.g. "1800-555-1234"
              ],
            },
            // 2. Button parameter for the "Copy code" button
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [
                { type: "text", text: String(otpCode) },      // OTP passed to clipboard
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Drift OTP code sent successfully:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Failed to send Drift OTP code:", JSON.stringify(error.response?.data || error.message, null, 2));
    return { success: false, error: error.response?.data || error.message };
  }
}

/**
 * Sends a WhatsApp Interactive Flow message (e.g., Driving License Theory Quiz)
 *
 * @param {Object} options Configuration options
 * @param {string} options.to Recipient phone number (e.g. "263771234567")
 * @param {string} [options.flowId] WhatsApp Flow ID (defaults to process.env.WHATSAPP_FLOW_ID)
 * @param {string} [options.flowToken] Session/Quiz tracking ID
 * @param {string} [options.screen="QUESTION_SET_1"] Initial screen ID inside your Flow JSON
 * @param {Object} [options.screenData={}] Data payload to pass into the first screen
 * @param {string} [options.mode="draft"] "draft" during testing or "published" in live production
 * @param {string} [options.ctaText="Start Theory Quiz"] Text shown on the CTA button
 * @param {string} [options.headerText="Provisional Driving Test"] Header text
 * @param {string} [options.bodyText] Main message body text
 * @param {string} [options.footerText="25 Questions • Instant Results"] Footer text
 */
export async function sendFlowMessage({
  to,
  flowId = process.env.WHATSAPP_FLOW_ID || "4757584871136221", // Must be a string
  flowToken,
  screen = "QUESTION_SET_ONE",
  screenData = {},
  mode = process.env.FLOW_MODE || "draft",
  ctaText = "Start Theory Quiz",
  headerText = "Provisional Driving Test",
  bodyText = "Ready to test your Zimbabwean road code knowledge? Tap below to open the interactive quiz.",
  footerText = "25 Questions • Instant Results",
}) {
  try {
    const phoneNumberId = process.env.MY_PHONE_NUMBER_ID;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "flow",
        header: {
          type: "text",
          text: headerText,
        },
        body: {
          text: bodyText,
        },
        footer: {
          text: footerText,
        },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: flowToken || `quiz_session_${Date.now()}`,
            flow_id: String(flowId), // Explicit string conversion
            flow_cta: ctaText,
            mode: mode,
            flow_action: "navigate",
            flow_action_payload: {
              screen: screen,
              ...(Object.keys(screenData).length > 0 && { data: screenData }),
            },
          },
        },
      },
    };

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ WhatsApp Flow sent successfully:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Failed to send WhatsApp Flow:", JSON.stringify(error.response?.data || error.message, null, 2));
    return { success: false, error: error.response?.data || error.message };
  }
}

export {sendMessageFunction, sendIrideCode, sendDriftOTP};

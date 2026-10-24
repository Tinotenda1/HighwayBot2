// Sends the dynamic WhatsApp purchase Flow.
//
// Usage:
// await sendPurchaseFlow(user, "resources");
// await sendPurchaseFlow(user, "subscription");

import axios from "axios";
import dotenv from "dotenv";
import { setPurchaseFlowVariable } from "../userStateManager.js";

dotenv.config();

export async function sendPurchaseFlow(user, requestedMode) {
  console.log("\n[PurchaseFlow] ===== START =====");

  console.log("[PurchaseFlow] Input:", {
    userProvided: Boolean(user),
    recipientLength: user ? String(user).length : 0,
    requestedMode,
  });

  let mode = requestedMode;
  setPurchaseFlowVariable(user, "mode", mode);


  if (mode !== "resources" && mode !== "subscription") {
    const error =
      'User messageState must be "resources" or "subscription" before sending the purchase Flow.';

    console.error("[PurchaseFlow] Invalid messageState:", {
      mode,
      expected: ["resources", "subscription"],
    });

    return {
      success: false,
      error,
    };
  }

  // --------------------------------------------------
  // 2. Validate environment configuration
  // --------------------------------------------------

  const token = process.env.GRAPH_API_TOKEN;
  const phoneNumberId = process.env.MY_PHONE_NUMBER_ID;
  const flowId = process.env.PURCHASE_FLOW_ID;

  const missing = [
    !token && "GRAPH_API_TOKEN",
    !phoneNumberId && "MY_PHONE_NUMBER_ID",
    !flowId && "PURCHASE_FLOW_ID",
  ].filter(Boolean);

  console.log("[PurchaseFlow] Configuration:", {
    hasGraphApiToken: Boolean(token),
    graphApiTokenLength: token?.length ?? 0,
    hasPhoneNumberId: Boolean(phoneNumberId),
    phoneNumberId,
    hasPurchaseFlowId: Boolean(flowId),
    flowId,
    missingVariables: missing,
  });

  if (missing.length) {
    const error = `Purchase Flow configuration is incomplete: ${missing.join(", ")}`;

    console.error("[PurchaseFlow] Configuration error:", error);
    console.log("[PurchaseFlow] ===== END: CONFIGURATION ERROR =====\n");

    return {
      success: false,
      error,
    };
  }

  // --------------------------------------------------
  // 3. Prepare Flow message
  // --------------------------------------------------


  const isSubscription = mode === "subscription";

  const headerText = isSubscription
    ? "Choose a Subscription"
    : "Study Resources";

  const bodyText = isSubscription
    ? "Choose your access package, enter your EcoCash number, and review the purchase details. \n\nType *Menu* for the Assistant's Main Menu."
    : "Choose your study resources or bundle, enter your EcoCash number, and review the purchase details. \n\nType *Menu* for the Assistant's Main Menu.";

  // Normalize the recipient for logging only.
  const recipient = String(user ?? "");

  console.log("[PurchaseFlow] Preparing request:", {
    mode,
    headerText,
    bodyText,
    recipientLength: recipient.length,
    recipientLastFour: recipient.slice(-4),
    endpoint: `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
    flowMessageVersion: "3",
    flowAction: "data_exchange",
    flowTokenPrefix: "purchase:",
  });

  // --------------------------------------------------
  // 4. Send Flow through the WhatsApp Cloud API
  // --------------------------------------------------

  try {
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
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
          text: "Zim Provisional Driver's Licence Assistant",
        },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_id: flowId,
            flow_cta: "Continue",
            flow_action: "data_exchange",

            // The Flow endpoint uses this to identify the user.
            flow_token: `purchase:${recipient}`,
          },
        },
      },
    };

    console.log("[PurchaseFlow] Sending POST request to Meta...");

    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: requestBody,
      timeout: 30000,
    });

    console.log("[PurchaseFlow] Meta API request accepted:", {
      status: response.status,
      statusText: response.statusText,
      messagingProduct: response.data?.messaging_product,
      messageId: response.data?.messages?.[0]?.id,
      recipientWaId: response.data?.contacts?.[0]?.wa_id
        ? `********${String(response.data.contacts[0].wa_id).slice(-4)}`
        : undefined,
    });

    console.log("[PurchaseFlow] ===== END: SUCCESS =====\n");

    return {
      success: true,
      mode,
      data: response.data,
    };
  } catch (error) {
    // --------------------------------------------------
    // 5. Log the actual error returned by Meta or Axios
    // --------------------------------------------------

    const metaError = error.response?.data?.error;

    console.error("[PurchaseFlow] ===== REQUEST FAILED =====");

    console.error("[PurchaseFlow] Error details:", {
      message: error.message,
      code: error.code ?? null,
      status: error.response?.status ?? null,
      statusText: error.response?.statusText ?? null,
      metaErrorType: metaError?.type ?? null,
      metaErrorCode: metaError?.code ?? null,
      metaErrorSubcode: metaError?.error_subcode ?? null,
      metaErrorMessage: metaError?.message ?? null,
      metaErrorUserTitle: metaError?.error_user_title ?? null,
      metaErrorUserMessage: metaError?.error_user_msg ?? null,
      metaErrorDetails: metaError?.error_data?.details ?? null,
      isAxiosError: axios.isAxiosError(error),
      timedOut: error.code === "ECONNABORTED",
    });

    if (error.response?.data) {
      console.error(
        "[PurchaseFlow] Full Meta API response:",
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error(
        "[PurchaseFlow] No HTTP response received. Check network, DNS, and timeout details."
      );
    }

    console.error("[PurchaseFlow] ===== END: FAILURE =====\n");

    return {
      success: false,
      error: error.response?.data || error.message,
    };
  }
}

export default sendPurchaseFlow;
// markAsRead.js

import axios from "axios";

export async function markAsRead(businessPhoneNumberId, messageId) {
  try {
    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v26.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
    });
    
    console.log("[WhatsApp] Message successfully marked as read:", messageId);
    return response.data;
  } catch (error) {
    // Log the detailed Meta API error response if available
    console.error(
      "Error marking message as read:",
      error.response ? JSON.stringify(error.response.data) : error.message
    );
  }
}
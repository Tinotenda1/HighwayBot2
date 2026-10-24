import connection from "../db.js";
import { sendMessageFunction } from '../messagesController/sendMessage.js';
import {
  getImageBase64,
  getOrUploadMediaId,
  getOrUploadFileMediaId,
} from './mediaUtils.js';
import {
  sendOneMessageButtonFunction,
} from '../messagesController/sendButtons.js';
import axiosInstance from '../appUtils/axiosInstance.js';

// Send image message to user.
async function sendImageMessage(
  businessPhoneNumberId,
  user,
  imageId,
  caption
) {
  try {
    await axiosInstance.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: user,
        type: "image",
        image: { id: imageId, caption },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error(
      "Image send error:",
      err.response?.data || err.message
    );
  }
}

// Send a document by media ID or external link.
// Rethrow errors so sendFileFunction can handle an invalid media ID.
async function sendDocumentMessage(
  businessPhoneNumberId,
  user,
  mediaId,
  caption,
  filename,
  isLink = false
) {
  const payload = {
    messaging_product: "whatsapp",
    to: user,
    type: "document",
    document: isLink
      ? { link: mediaId, caption, filename }
      : { id: mediaId, caption, filename },
  };

  try {
    await axiosInstance.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error(
      "Document send error:",
      err.response?.data || err.message
    );

    throw err;
  }
}

// Determine whether a failed send may be caused by a stale/invalid media ID.
function isMediaIdError(error) {
  const apiError = error.response?.data?.error;

  const message = [
    apiError?.message,
    error.message,
    typeof apiError === 'string' ? apiError : '',
  ]
    .filter(Boolean)
    .join(' ');

  return /media.{0,40}(id|invalid|expired|not found|unavailable)|(?:invalid|expired|unavailable|not found).{0,40}media/i
    .test(message);
}

// Send data (message + image if available) to the user.
async function sendDataFunction(
  businessPhoneNumberId,
  user,
  messageId,
  title,
  text,
  label,
  buttonId
) {
  try {
    const [rows] = await connection.execute(
      "SELECT * FROM data WHERE title = ? LIMIT 1",
      [title]
    );

    if (!rows.length) {
      console.warn("No data found for:", title);
      return;
    }

    const { info, image_no } = rows[0];

    if (image_no) {
      const imageData = await getImageBase64(image_no);

      if (imageData) {
        const buffer = Buffer.from(imageData, 'base64');

        const mediaId = await getOrUploadMediaId(
          image_no,
          buffer,
          businessPhoneNumberId
        );

        if (mediaId) {
          await sendImageMessage(
            businessPhoneNumberId,
            user,
            mediaId,
            info
          );
        } else {
          console.warn("Media upload failed for image_no:", image_no);
        }
      }
    } else {
      await sendMessageFunction(
        businessPhoneNumberId,
        user,
        messageId,
        info
      );
    }

    if (buttonId) {
      await new Promise(resolve => setTimeout(resolve, 650));

      await sendOneMessageButtonFunction(
        businessPhoneNumberId,
        user,
        text,
        label,
        buttonId
      );
    }
  } catch (error) {
    console.error("sendDataFunction Error:", error.message);
  }
}

// Send a file stored in MySQL, using its cached WhatsApp media ID.
async function sendFileFunction(
  businessPhoneNumberId,
  user,
  title,
  caption,
  filename,
  messageId,
  messageText,
  buttonText,
  buttonId
) {
  try {
    const [fileRows] = await connection.execute(
      "SELECT * FROM files WHERE title = ? LIMIT 1",
      [title]
    );

    if (!fileRows.length) {
      console.error("No file found with title:", title);
      return;
    }

    const fileRecord = fileRows[0];
    const { file_data, file_link } = fileRecord;

    const hasFileData =
      file_data != null &&
      (!Buffer.isBuffer(file_data) || file_data.length > 0);

    if (hasFileData) {
      // Reuse the cached media ID, or upload the database file if needed.
      let mediaId = await getOrUploadFileMediaId(
        fileRecord,
        businessPhoneNumberId,
        filename
      );

      try {
        await sendDocumentMessage(
          businessPhoneNumberId,
          user,
          mediaId,
          caption,
          filename
        );
      } catch (sendError) {
        if (!isMediaIdError(sendError)) {
          throw sendError;
        }

        console.warn(
          `WhatsApp rejected the media ID for "${title}". Refreshing it and retrying once.`
        );

        // Force a fresh upload from the original MySQL file.
        mediaId = await getOrUploadFileMediaId(
          fileRecord,
          businessPhoneNumberId,
          filename,
          true
        );

        await sendDocumentMessage(
          businessPhoneNumberId,
          user,
          mediaId,
          caption,
          filename
        );
      }
    } else if (file_link) {
      // Preserve support for files stored as external links.
      await sendDocumentMessage(
        businessPhoneNumberId,
        user,
        file_link,
        caption,
        filename,
        true
      );
    } else {
      console.error(
        `File "${title}" has neither file_data nor file_link.`
      );
      return;
    }

    // Send the existing button after the document send succeeds.
    if (buttonId) {
      await new Promise(resolve => setTimeout(resolve, 650));

      await sendOneMessageButtonFunction(
        businessPhoneNumberId,
        user,
        messageText,
        buttonText,
        buttonId
      );
    }
  } catch (error) {
    console.error(
      `Error sending file "${title}":`,
      error.response?.data || error.message
    );
  }
}

export {
  sendImageMessage,
  sendDocumentMessage,
  sendDataFunction,
  sendFileFunction,
};
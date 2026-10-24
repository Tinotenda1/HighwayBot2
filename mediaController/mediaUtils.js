import fs from 'fs';
import connection from "../db.js";
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TEMP_DIR = path.join(__dirname, 'temp');

const MEDIA_CACHE_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000;

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(filename, fileType) {
  const extension = path.extname(filename || '').toLowerCase();
  const fallbackExtension = fileType
    ? `.${String(fileType).replace(/^\./, '').toLowerCase()}`
    : '';

  return MIME_TYPES[extension]
    || MIME_TYPES[fallbackExtension]
    || 'application/octet-stream';
}

export async function ensureTempDir() {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  } catch (error) {
    console.error("Error ensuring temp directory:", error.message);
  }
}

// Convert database file data to a Buffer.
// MySQL BLOB values normally arrive as Buffers. Also support legacy
// Base64-encoded PDF content if that is what a record contains.
function getFileBuffer(fileData, fileType) {
  if (fileData == null) {
    throw new Error("File data is empty.");
  }

  let buffer = Buffer.isBuffer(fileData)
    ? fileData
    : Buffer.from(fileData);

  const normalizedType = String(fileType || '')
    .replace(/^\./, '')
    .toLowerCase();

  if (normalizedType === 'pdf') {
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      return buffer;
    }

    // A Base64 PDF begins with text such as JVBERi0.
    const encodedText = buffer.toString('utf8').trim();

    if (
      encodedText.length > 0 &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(encodedText)
    ) {
      const decoded = Buffer.from(encodedText, 'base64');

      if (decoded.subarray(0, 5).toString('ascii') === '%PDF-') {
        return decoded;
      }
    }
  }

  return buffer;
}

// Upload a media file to WhatsApp.
export async function uploadBufferToWhatsApp(
  buffer,
  businessPhoneNumberId,
  filename,
  suppliedMimeType
) {
  const mimeType = suppliedMimeType
    || getMimeType(filename);

  const formData = new FormData();

  formData.append("file", Readable.from(buffer), {
    filename,
    contentType: mimeType,
  });

  formData.append("messaging_product", "whatsapp");
  formData.append("type", mimeType);

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          ...formData.getHeaders(),
        },
        maxBodyLength: Infinity,
      }
    );

    return data.id || null;
  } catch (error) {
    console.error(
      "Media upload failed:",
      error.response?.data || error.message
    );
    return null;
  }
}

// Check whether an existing image media ID can still be accessed.
async function checkMediaIdValidity(mediaId) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        params: {
          access_token: process.env.GRAPH_API_TOKEN,
        },
      }
    );

    return Boolean(response.data.id);
  } catch (error) {
    console.error(
      "Error checking media ID validity:",
      error.response?.data || error.message
    );
    return false;
  }
}

// Get an image as Base64 from the database.
export async function getImageBase64(image_no) {
  try {
    const [rows] = await connection.execute(
      "SELECT image_data FROM diagrams WHERE image_no = ? LIMIT 1",
      [image_no]
    );

    return rows.length && rows[0].image_data
      ? rows[0].image_data.toString('base64')
      : null;
  } catch (error) {
    console.error("Image fetch error:", error.message);
    return null;
  }
}

// Get or upload a WhatsApp media ID for an image.
export async function getOrUploadMediaId(
  image_no,
  buffer,
  businessPhoneNumberId
) {
  const [rows] = await connection.execute(
    "SELECT media_id FROM diagrams WHERE image_no = ? LIMIT 1",
    [image_no]
  );

  if (rows.length && rows[0].media_id) {
    const mediaId = rows[0].media_id;
    const isValid = await checkMediaIdValidity(mediaId);

    if (isValid) {
      return mediaId;
    }

    console.log(`Image media ID for ${image_no} is invalid; re-uploading.`);
  }

  const mediaId = await uploadBufferToWhatsApp(
    buffer,
    businessPhoneNumberId,
    `${image_no}.jpg`,
    'image/jpeg'
  );

  if (mediaId) {
    await connection.execute(
      "UPDATE diagrams SET media_id = ? WHERE image_no = ?",
      [mediaId, image_no]
    );

    console.log(`Image media ID updated for ${image_no}.`);
  }

  return mediaId;
}

// Get or upload the cached WhatsApp media ID for a file stored in MySQL.
// fileRecord must be the row returned from the files table.
export async function getOrUploadFileMediaId(
  fileRecord,
  businessPhoneNumberId,
  filename,
  forceRefresh = false
) {
  if (!fileRecord?.id) {
    throw new Error("Cannot cache file media ID: database file ID is missing.");
  }

  const { id, file_data, file_type, media_id, media_uploaded_at } = fileRecord;

  if (!file_data) {
    throw new Error(`No file_data exists for database file ID ${id}.`);
  }

  if (!forceRefresh && media_id && media_uploaded_at) {
    const uploadedAt = new Date(media_uploaded_at).getTime();
    const ageMs = Date.now() - uploadedAt;

    if (
      Number.isFinite(uploadedAt) &&
      ageMs >= 0 &&
      ageMs < MEDIA_CACHE_MAX_AGE_MS
    ) {
      return media_id;
    }
  }

  const fileBuffer = getFileBuffer(file_data, file_type);

  const uploadFilename = filename
    || `document.${String(file_type || 'pdf').replace(/^\./, '')}`;

  const mimeType = getMimeType(uploadFilename, file_type);

  console.log(`Uploading file ID ${id} to WhatsApp for media caching.`);

  const newMediaId = await uploadBufferToWhatsApp(
    fileBuffer,
    businessPhoneNumberId,
    uploadFilename,
    mimeType
  );

  if (!newMediaId) {
    throw new Error(`WhatsApp media upload failed for database file ID ${id}.`);
  }

  await connection.execute(
    `UPDATE files
     SET media_id = ?, media_uploaded_at = NOW()
     WHERE id = ?`,
    [newMediaId, id]
  );

  console.log(`Cached WhatsApp media ID for file ID ${id}.`);

  return newMediaId;
}

// Upload a file from a local path. Retained for compatibility with other code.
export async function uploadFile(filePath, businessPhoneNumberId) {
  try {
    const formData = new FormData();
    const filename = path.basename(filePath);
    const mimeType = getMimeType(filename);

    formData.append("file", fs.createReadStream(filePath), {
      filename,
      contentType: mimeType,
    });
    formData.append("messaging_product", "whatsapp");
    formData.append("type", mimeType);

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
          ...formData.getHeaders(),
        },
      }
    );

    return response.data.id || null;
  } catch (error) {
    console.error(
      "Error uploading file:",
      error.response?.data || error.message
    );
    return null;
  }
}
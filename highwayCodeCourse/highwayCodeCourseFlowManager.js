
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY = await fs.readFile(
  path.resolve(__dirname, "../private.pem"),
  "utf8"
);
const ASSET_DIR = path.resolve(__dirname, "../assets/course-images-base64");

const LESSONS = [
  { title: "highway_code", screen: "WELCOME", heading: "Welcome to the Highway Code!" },
  { title: "introduction", screen: "INTRODUCTION", heading: "1. Introduction" },
  { title: "test_mistakes", screen: "TEST_MISTAKES", heading: "2. Test's Common Mistakes" },
  { title: "five_rules", screen: "FIVE_RULES", heading: "3. Rules for Solving Car Diagrams" },
  { title: "Controlled_intersections", screen: "CONTROLLED_INTERSECTIONS", heading: "4. Controlled Intersections" },
  { title: "understanding_car_diagram_questions", screen: "UNDERSTANDING_DIAGRAMS", heading: "5. Understanding Car Diagrams" },
  { title: "summary", screen: "SUMMARY", heading: "6. Points to Remember" },
];

const SCREEN_IDS = [...LESSONS.map(x => x.screen), "FINAL_OPTIONS"];

function decryptRequest(body) {
  const {
    encrypted_aes_key,
    encrypted_flow_data,
    initial_vector
  } = body ?? {};

  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error("Missing Flow encryption fields.");
  }

  const privateKey = crypto.createPrivateKey(
    PRIVATE_KEY.replace(/\\n/g, "\n").trim()
  );

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  if (aesKey.length !== 16) {
    throw new Error("Unexpected AES key length.");
  }

  const iv = Buffer.from(initial_vector, "base64");
  const encrypted = Buffer.from(encrypted_flow_data, "base64");
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);

  decipher.setAuthTag(encrypted.subarray(-16));

  const plaintext = Buffer.concat([
    decipher.update(encrypted.subarray(0, -16)),
    decipher.final()
  ]).toString("utf8");

  return {
    body: JSON.parse(plaintext),
    aesKey,
    iv
  };
}

function encryptResponse(payload, aesKey, iv) {
  const flippedIV = Buffer.from(iv.map(byte => (~byte) & 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flippedIV);

  return Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString("base64");
}

function sendEncrypted(res, payload, aesKey, iv) {
  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send(encryptResponse(payload, aesKey, iv));
}

async function findJsonFiles(directory) {
  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

const courseImageCache = new Map();

async function loadImage(imageNo) {
  if (
    imageNo === null ||
    imageNo === undefined ||
    String(imageNo).trim() === ""
  ) {
    return null;
  }

  const imageNumber = String(imageNo).trim();

  if (!/^\d+$/.test(imageNumber)) {
    console.warn(`[HighwayCodeCourseFlow] Invalid image number: ${imageNumber}`);
    return null;
  }

  if (courseImageCache.has(imageNumber)) {
    return courseImageCache.get(imageNumber);
  }

  const imagePath = path.join(
    ASSET_DIR,
    `${imageNumber}.json`
  );

  try {
    const fileContent = await fs.readFile(imagePath, "utf8");
    const image = JSON.parse(fileContent);

    if (
      typeof image.base64 !== "string" ||
      image.base64.trim().length === 0
    ) {
      throw new Error("Missing Base64 image data.");
    }

    const mimeType = image.mimeType || "image/png";

    if (!["image/png", "image/jpeg"].includes(mimeType)) {
      throw new Error(`Unsupported image type: ${mimeType}`);
    }

    const base64 = image.base64
      .replace(/^data:[^,]+,/, "")
      .replace(/\s/g, "");

    courseImageCache.set(imageNumber, base64);

    console.log(
      `[HighwayCodeCourseFlow] Image cached: ${imageNumber}, ` +
      `MIME: ${mimeType}, Base64 length: ${base64.length}`
    );

    return base64;
  } catch (error) {
    console.error(
      `[HighwayCodeCourseFlow] Could not load image ${imageNumber}:`,
      error.message
    );

    courseImageCache.set(imageNumber, null);
    return null;
  }
}


async function getLesson(screenId) {
  const lesson = LESSONS.find(item => item.screen === screenId);

  if (!lesson) {
    throw new Error(`Unknown lesson screen: ${screenId}`);
  }

  const [rows] = await pool.execute(
    "SELECT title, info, image_no FROM data WHERE title = ? LIMIT 1",
    [lesson.title]
  );

  if (!rows.length) {
    throw new Error(`No database lesson found for ${lesson.title}.`);
  }

  const row = rows[0];
  const imageSrc = await loadImage(row.image_no);

    return {
    lesson_title: lesson.heading,
    lesson_text: String(row.info ?? ""),
    image_src: imageSrc || "",
    has_image: Boolean(imageSrc),
    };
}

function getTargetScreen(currentScreen, userAction) {
  const index = SCREEN_IDS.indexOf(currentScreen);

  if (index < 0 || currentScreen === "FINAL_OPTIONS") {
    throw new Error(`Invalid current screen: ${currentScreen}`);
  }

  if (userAction === "BACK") {
    return SCREEN_IDS[Math.max(0, index - 1)];
  }

  return SCREEN_IDS[Math.min(SCREEN_IDS.length - 1, index + 1)];
}

export async function manageHighwayCodeCourseFlow(req, res) {
  let aesKey;
  let iv;

  try {
    const decrypted = decryptRequest(req.body);
    const body = decrypted.body;
    aesKey = decrypted.aesKey;
    iv = decrypted.iv;

    if (body.action === "ping") {
      return sendEncrypted(res, {
        data: { status: "active" }
      }, aesKey, iv);
    }

    if (body.action === "INIT") {
      return sendEncrypted(res, {
        screen: "WELCOME",
        data: await getLesson("WELCOME")
      }, aesKey, iv);
    }

    if (body.action === "data_exchange") {
      const userAction = String(
        body.data?.user_action ?? "NEXT"
      ).toUpperCase();

      if (!["NEXT", "BACK"].includes(userAction)) {
        throw new Error(`Unsupported action: ${userAction}`);
      }

      const target = getTargetScreen(body.screen, userAction);

      if (target === "FINAL_OPTIONS") {
        return sendEncrypted(res, {
          screen: "FINAL_OPTIONS",
          data: {}
        }, aesKey, iv);
      }

      return sendEncrypted(res, {
        screen: target,
        data: await getLesson(target)
      }, aesKey, iv);
    }

    throw new Error(`Unsupported Flow action: ${body.action}`);
  } catch (error) {
    console.error("[HighwayCodeCourseFlow]", error.message);

    if (aesKey && iv) {
      try {
        return sendEncrypted(res, {
          data: {
            error_message:
              "We could not load this lesson. Please go back and try again."
          }
        }, aesKey, iv);
      } catch (encryptionError) {
        console.error("Could not encrypt error response:", encryptionError.message);
      }
    }

    return res.status(421).send("Flow request could not be decrypted.");
  }
}

export default manageHighwayCodeCourseFlow;

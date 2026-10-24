// questionsService.js
import pool from "../db.js";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE64_IMAGES_DIR = path.resolve(
  __dirname,
  "../assets/road-signs-base64"
);

export const TIMED_TEST_TOTAL_QUESTIONS = Number(
  process.env.TIMED_TEST_TOTAL_QUESTIONS || 25
);

export const NON_TIMED_TEST_TOTAL_QUESTIONS = Number(
  process.env.NON_TIMED_TEST_TOTAL_QUESTIONS || 25
);

const TIMED_TEST_DURATION_MS = Number(
  process.env.TIMED_TEST_DURATION_MS || 8 * 60 * 1000
);

// Cache images so the same files are not repeatedly read from disk.
const imageCache = new Map();

function parseQuestion(rawText) {
  const text = String(rawText ?? "").trim();

  const optionPattern =
    /(?:^|\n)\s*([ABC])\s*[.)]\s*([\s\S]*?)(?=(?:\n\s*[ABC]\s*[.)]\s*)|$)/g;

  const matches = [...text.matchAll(optionPattern)];

  if (matches.length !== 3) {
    throw new Error(
      `Expected 3 options (A, B, C), but found ${matches.length}.`
    );
  }

  const questionText = text.slice(0, matches[0].index).trim();

  const options = matches.map((match) => ({
    id: match[1],
    text: `${match[1]}. ${match[2].trim().replace(/\s+/g, " ")}`,
  }));

  if (!questionText) {
    throw new Error("Question text is missing.");
  }

  return {
    question_text: questionText,
    options,
  };
}


/**
 * Load a Base64 image from assets/road-signs-base64.
 * The filename must match the MySQL image_no.
 * Example: image_no = 12 loads 12.json.
 */
async function loadBase64Image(imageNo) {
  if (
    imageNo === null ||
    imageNo === undefined ||
    String(imageNo).trim() === ""
  ) {
    return null;
  }

  const imageNumber = String(imageNo).trim();

  // Accept numeric image identifiers only.
  if (!/^\d+$/.test(imageNumber)) {
    console.warn(`Invalid image number: ${imageNumber}`);
    return null;
  }

  if (imageCache.has(imageNumber)) {
    return imageCache.get(imageNumber);
  }

  const imagePath = path.join(
    BASE64_IMAGES_DIR,
    `${imageNumber}.json`
  );

  try {
    const fileContent = await fs.readFile(imagePath, "utf8");
    const image = JSON.parse(fileContent);

    if (
      typeof image.base64 !== "string" ||
      image.base64.length === 0
    ) {
      console.warn(
        `Image ${imageNumber} has no valid Base64 data.`
      );
      imageCache.set(imageNumber, null);
      return null;
    }

    const mimeType = image.mimeType || "image/png";

    if (!["image/png", "image/jpeg"].includes(mimeType)) {
      console.warn(
        `Unsupported image type for image ${imageNumber}: ${mimeType}`
      );
      imageCache.set(imageNumber, null);
      return null;
    }

    const imageSrc = image.base64;

    imageCache.set(imageNumber, imageSrc);
    return imageSrc;

  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(
        `Base64 image not found: ${imageNumber}.json`
      );
    } else {
      console.error(
        `Could not load image ${imageNumber}:`,
        error.message
      );
    }

    imageCache.set(imageNumber, null);
    return null;
  }
}


export async function fetch25QuestionsFromDB(
  category,
  totalQuestions = TIMED_TEST_TOTAL_QUESTIONS
) {
  if (!category || typeof category !== "string") {
    throw new Error("A valid question category is required.");
  }

  if (
    !Number.isInteger(totalQuestions) ||
    totalQuestions < 1
  ) {
    throw new Error(
      "The configured question count must be a positive integer."
    );
  }

  const [rows] = await pool.execute(
    `SELECT
        q.id,
        q.question,
        q.answer,
        q.explanation,
        q.image_no
     FROM questions AS q
     WHERE q.category = ?
       AND q.answer IN ('A', 'B', 'C')
     ORDER BY RAND()
     LIMIT ${totalQuestions}`,
    [category]
  );

  if (rows.length !== totalQuestions) {
    throw new Error(
      `Expected ${totalQuestions} questions in category ` +
      `"${category}", but found ${rows.length}.`
    );
  }

  return Promise.all(
    rows.map(async (row) => {
      const parsed = parseQuestion(row.question);
      const imageSrc = await loadBase64Image(row.image_no);

      return {
        id: row.id,
        question_text: parsed.question_text,
        options: parsed.options,
        correct_answer: String(row.answer)
          .trim()
          .toUpperCase(),
        explanation: row.explanation ?? null,
        image_no: row.image_no,
        image_src: imageSrc,
      };
    })
  );
}


export async function getFailedQuestionIds(userPhone) {
  const [rows] = await pool.execute(
    "SELECT failed_Qtns FROM users WHERE phone = ?",
    [userPhone]
  );

  const raw = rows[0]?.failed_Qtns || "";

  return [
    ...new Set(
      String(raw)
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id))
        .map(Number)
    ),
  ];
}

export async function fetchQuestionsByIdsFromDB(ids) {
  const validIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];

  if (validIds.length === 0) return [];

  const placeholders = validIds.map(() => "?").join(",");

  const [rows] = await pool.execute(
    `SELECT
        q.id,
        q.question,
        q.answer,
        q.explanation,
        q.image_no
     FROM questions AS q
     WHERE q.id IN (${placeholders})
       AND q.answer IN ('A', 'B', 'C')
     ORDER BY FIELD(q.id, ${placeholders})`,
    [...validIds, ...validIds]
  );

  return Promise.all(
    rows.map(async (row) => {
      const parsed = parseQuestion(row.question);
      const imageSrc = await loadBase64Image(row.image_no);

      return {
        id: row.id,
        question_text: parsed.question_text,
        options: parsed.options,
        correct_answer: String(row.answer).trim().toUpperCase(),
        explanation: row.explanation ?? null,
        image_no: row.image_no,
        image_src: imageSrc,
      };
    })
  );
}

export async function removeFailedQuestionId(userPhone, questionId) {
  const [rows] = await pool.execute(
    "SELECT failed_Qtns FROM users WHERE phone = ?",
    [userPhone]
  );

  if (!rows.length) {
    throw new Error("Learner was not found in the users table.");
  }

  const existingIds = String(rows[0].failed_Qtns || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));

  const updatedIds = existingIds.filter(
    (id) => Number(id) !== Number(questionId)
  );

  await pool.execute(
    "UPDATE users SET failed_Qtns = ? WHERE phone = ?",
    [updatedIds.join(","), userPhone]
  );

  return updatedIds.length;
}

export async function addFailedQuestionId(userPhone, questionId) {
  const [rows] = await pool.execute(
    "SELECT failed_Qtns FROM users WHERE phone = ?",
    [userPhone]
  );

  if (!rows.length) {
    throw new Error("Learner was not found in the users table.");
  }

  const numericQuestionId = Number(questionId);
  if (!Number.isSafeInteger(numericQuestionId) || numericQuestionId <= 0) {
    throw new Error("A valid question ID is required.");
  }

  const existingIds = String(rows[0].failed_Qtns || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .map(Number);

  // Add the question ID only if it doesn't already exist in the list
  if (!existingIds.includes(numericQuestionId)) {
    existingIds.push(numericQuestionId);
  }

  await pool.execute(
    "UPDATE users SET failed_Qtns = ? WHERE phone = ?",
    [existingIds.join(","), userPhone]
  );

  return existingIds.length;
}

/**
 * Save a user's test performance results to the database.
 * Automatically calculates the next incremental test number for the user and category.
 */
export async function saveResults({
  user,
  category = "timed_test",
  status = "completed",
  no_correct_answers = 0,
  no_questions_taken = 25,
  road_sign_qtn_mark = null,
  traffic_intersection_qtn_mark = null,
  theory_qtn_mark = null,
  time_taken = null,
}) {
  if (!user) {
    throw new Error("User phone number is required to save performance results.");
  }

  // Get the next incremental test number for this user and category
  const [testRows] = await pool.execute(
    `SELECT COALESCE(MAX(test_number), 0) AS last_test_number 
     FROM performance 
     WHERE user_phone = ? AND category = ?`,
    [user, category]
  );

  const nextTestNumber = testRows[0].last_test_number + 1;                          

  // Insert the performance record into the database
  await pool.execute(
    `INSERT INTO performance (
      test_number, status, category, no_correct_answers, no_questions_taken,
      road_sign_qtn_mark, traffic_intersection_qtn_mark, theory_qtn_mark, time_taken, user_phone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nextTestNumber,
      status,
      category,
      no_correct_answers,
      no_questions_taken,
      road_sign_qtn_mark,
      traffic_intersection_qtn_mark,
      theory_qtn_mark,
      time_taken ?? null,
      user
    ]
  );

  return nextTestNumber;
}
import path from "path";
import fs from "fs";
import connection from "../db.js";
import {
  userStatesMap,
  initializeUserState,
  setCorrectAnswer,
  setQuestionType,
  setExplanation,
  incrementQuestionNumber,
} from "../userStateManager.js";
import { sendMessageFunction } from "../messagesController/sendMessage.js";
import { getImageBase64, getOrUploadMediaId } from "../mediaController/mediaUtils.js";
import { sendThreeMessageButtonFunction, sendImageButtonFunction, sendOneMessageButtonFunction } from "../messagesController/sendButtons.js";
import {sendImageMessage} from "../mediaController/mediaFunctions.js"

// ... same import statements

export async function sendExerciseQuestionFunction(businessPhoneNumberId, user, messageId, category) {
  try {
    const buttons = [
      { title: "A", id: "A" },
      { title: "B", id: "B" },
      { title: "C", id: "C" },
    ];

    initializeUserState(user);
    const userState = userStatesMap.get(user);

    if (!userState.questionsLimit) {
      console.error("User question limit not set.");
      return;
    }

    const currentQuestionNumber = `${userState.incrementedQuestionNumber}/${userState.questionsLimit}`;
    const askedIds = Array.from(userState.askedQuestions);
    const excludedIds = askedIds.length ? askedIds : [0];

    // 🔁 Build dynamic placeholders for `NOT IN (...)`
    const placeholders = excludedIds.map(() => '?').join(',');
    const [questions] = await connection.execute(
      `SELECT * FROM questions 
       WHERE category = ? 
       AND id NOT IN (${placeholders}) 
       ORDER BY RAND() LIMIT 1`,
      [category, ...excludedIds]
    );

    if (questions.length === 0) {
      const messageData = "🎉 You have completed all available questions in this category.";
      await sendMessageFunction(businessPhoneNumberId, user, messageId, messageData);
      return;
    }

    const fetchedQuestion = questions[0];
    const { id, question, answer, image_no, explanation, question_type } = fetchedQuestion;

    setCorrectAnswer(user, answer);
    setQuestionType(user, question_type);
    setExplanation(user, explanation);
    userState.askedQuestions.add(id);

    let questionText;
    if (userState.category === "timed_test") {
      const currentTime = Date.now();
      const remainingTimeMs = userState.startTime + (userState.timeLimit * 60 * 1000) - currentTime;
      const remainingMinutes = Math.floor(remainingTimeMs / (1000 * 60));
      const remainingSeconds = Math.floor((remainingTimeMs % (1000 * 60)) / 1000);
      const remainingTimeFormatted = `${remainingMinutes}m ${remainingSeconds}s`;
      questionText = `*${currentQuestionNumber}*. ${question} ⏳ *${remainingTimeFormatted}*`;
    } else {
      questionText = `*${currentQuestionNumber}*. ${question}`;
    }

    if (image_no) {
      const imageData = await getImageBase64(image_no);
      if (imageData) {
        const buffer = Buffer.from(imageData, 'base64');
        const mediaId = await getOrUploadMediaId(image_no, buffer, businessPhoneNumberId);
        if (mediaId) {
          await sendImageButtonFunction(businessPhoneNumberId, user, mediaId, questionText, buttons);
        } else {
          console.warn("⚠️ Media upload failed for image_no:", image_no);
        }
      }
    } else {
      await sendThreeMessageButtonFunction(
        businessPhoneNumberId,
        user,
        questionText,
        "A", "B", "C",
        "A", "B", "C"
      );
    }

  } catch (error) {
    console.error("❌ Error sending question:", error.message);
  }
}


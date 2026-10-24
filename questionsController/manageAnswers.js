import connection from '../db.js';
import {
  userStatesMap,

} from '../userStateManager.js';

// MANAGE ANSWERS
export async function manageAnswers(user, provided_answer) {
  const userState = userStatesMap.get(user);
  if (!userState.incrementedQuestionNumber) return;

  const currentQuestionNumber = `${userState.incrementedQuestionNumber}/${userState.questionsLimit}`;
  const result = userState.correctAnswer === provided_answer ? 'correct' : '*incorrect*';

  await connection.execute(
    "INSERT INTO answers (question_number, correct_answer, provided_answer, result, user_phone, question_type) VALUES (?, ?, ?, ?, ?, ?)",
    [currentQuestionNumber, userState.correctAnswer, provided_answer, result, user, userState.questionType]
  );
  
  
  const questionId = userState.questionId;

    // Fetch existing failed_Qtns
    const [rows] = await connection.execute(
      "SELECT failed_Qtns FROM users WHERE phone = ?",
      [user]
    );

    let failedQtns = rows[0]?.failed_Qtns
      ? rows[0].failed_Qtns.split(',').map(id => id.trim())
      : [];

    const questionIdStr = String(questionId);

    if (result === '*incorrect*') {
      // Add questionId if not already present
      if (!failedQtns.includes(questionIdStr)) {
        failedQtns.push(questionIdStr);
      }
    } else {
      // Remove questionId if it exists
      failedQtns = failedQtns.filter(id => id !== questionIdStr);
    }
  
    // Determine what to save in the column
    const failedQtnsToSave = failedQtns.length ? failedQtns.join(',') : null;

    // Update DB with new failed_Qtns list (even if unchanged to ensure sync)
    await connection.execute(
      "UPDATE users SET failed_Qtns = ? WHERE phone = ?",
      [failedQtnsToSave, user]
    );


  
  
  /*
  // If answer is incorrect, update failed_Qtns column
  if (result === '*incorrect*') {
    const questionId = userState.questionId;

    // Fetch existing failed_Qtns
    const [rows] = await connection.execute(
      "SELECT failed_Qtns FROM users WHERE phone = ?",
      [user]
    );

    let failedQtns = rows[0]?.failed_Qtns ? rows[0].failed_Qtns.split(',') : [];

    // Add new questionId if not already present
    if (!failedQtns.includes(String(questionId))) {
      failedQtns.push(String(questionId));

      // Update DB with new failed_Qtns list
      await connection.execute(
        "UPDATE users SET failed_Qtns = ? WHERE phone = ?",
        [failedQtns.join(','), user]
      );
    }
  }
  */
}
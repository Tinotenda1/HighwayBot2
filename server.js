
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import connection from "./db.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from "openai";
import {sendIrideCode, sendDriftOTP, sendMessageFunction} from './messagesController/sendMessage.js';
import {markAsRead} from './messagesController/markAsRead.js';
import {sendMainMenuList} from './messagesController/interactiveLists.js';
import {analyzeUserPerformance} from './performanceController/analyzePerformance.js';
import {checkSubscriptionAndHandleMessage, checkSubscriptionFunction} from './subscriptionController/subscription.js';
import './appUtils/dailyTasks.js';
import './appUtils/refreshFileMediaIds.js';
import { refreshFileMediaIds } from './appUtils/refreshFileMediaIds.js';
import {manageTimedQuestionsFlow} from './questionsController/timedQuestionsFlowManager.js';
import {sendTimedTestFlow} from './questionsController/sendTimedTestFlow.js';
import {sendPracticeTestFlow} from './questionsController/sendPracticeTestFlow.js';
import {managePracticeQuestionsFlow} from './questionsController/practiceQuestionsFlowManager.js';
import {manageFailedQuestionsFlow} from './questionsController/failedQuestionsFlowManager.js';
import {manageHighwayCodeCourseFlow} from './highwayCodeCourse/highwayCodeCourseFlowManager.js'
import {sendHighwayCodeCourseFlow} from './highwayCodeCourse/sendHighwayCodeCourseFlow.js'
import {managePurchaseFlow} from './subscriptionController/purchaseFlowManager.js';
import {initiatePayment} from './paymentsController/initiatePayment.js';
import {
  initializeUserState,
  userStatesMap,
  setMessageState,
  resetUserData
} from './userStateManager.js';
import { sendFailedQuestionsFlow } from "./questionsController/sendFailedQuestionsFlow.js";
import {sendPurchaseFlow} from "./subscriptionController/sendPurchaseFlow.js";


// Function to ping the Glitch app and keep it awake
function keepAppAlive() {
  setInterval(() => {
    axios.get('https://zim-provisional-drivers-license-whatsapp.onrender.com')  // Replace with your Glitch project URL
      .then((response) => {
        console.log('Pinged successfully', response.status);
      })
      .catch((error) => {
        console.error('Error pinging app:', error);
      });
  }, 1 * 60 * 1000); // Ping every 5 minutes
}

keepAppAlive();

//await refreshFileMediaIds();



// Get the current directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'temp');
const ensureTempDir = async () => { try { await fs.mkdir(TEMP_DIR, { recursive: true }); } catch {} };


dotenv.config();

const app = express();
app.use(express.json());


const {PORT, GITHUB_TOKEN, MY_PHONE_NUMBER_ID} = process.env;

const client = new OpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: GITHUB_TOKEN,
});


app.post("/send-code", async (req, res) => {
  console.log("Incoming send-code message:", req.body);
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ success: false, message: "Phone and code are required" });
    }

    // Send the WhatsApp message
    await sendIrideCode(phone, "Your iRide verification code is *" + code + "*.");
    await sendDriftOTP(phone, code, "DRIFT", "0777937111", "drift_verification");

    // ✅ Respond to the caller
    res.status(200).json({ success: true, message: "Code sent successfully" });
  } catch (error) {
    console.error("Error sending code:", error);
    res.status(500).json({ success: false, message: "Failed to send code" });
  }
});

app.post("/flow-data-exchange", manageTimedQuestionsFlow);
app.post("/practice-test-flow-data-exchange", managePracticeQuestionsFlow);
app.post("/failed-questions-flow-data-exchange", manageFailedQuestionsFlow);
app.post("/highway-code-course-flow", manageHighwayCodeCourseFlow);
app.post('/purchase-flow', managePurchaseFlow);


app.post("/webhook", async (req, res) => {
  //console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));
  
  const user = req.body.entry?.[0].changes?.[0].value?.messages?.[0]?.from;
  
  if(user && req.body.entry[0].changes[0].value.metadata.phone_number_id === MY_PHONE_NUMBER_ID){
  const message = req.body.entry?.[0].changes?.[0].value?.messages?.[0];
  const businessPhoneNumberId = req.body.entry?.[0].changes?.[0].value?.metadata?.phone_number_id;
  const messageType = message?.type;
  const buttonReplyId = message?.interactive?.button_reply?.id;
  const optionReplyId = message?.interactive?.list_reply?.id;
  const messageId = message?.id;

    console.log("businessPhoneNumberId:", businessPhoneNumberId);
    console.log("message:", message);
  initializeUserState(user);
  // Access a specific user's state
  const userState = userStatesMap.get(user);
  let messageState;
  
  if (!userStatesMap.get(user)?.messageState) {
   await resetUserData(user);
          
    if (user) {

    await markAsRead(businessPhoneNumberId, messageId);
    await checkSubscriptionAndHandleMessage(businessPhoneNumberId, user, messageId);
      
    messageState = "main_menu";
    setMessageState(user, messageState);
    return res.sendStatus(200);
    }
    
  } else {
    
    switch (userStatesMap.get(user)?.messageState) {                
      case "main_menu":
        
       if(optionReplyId === "menu_check_subscription") {
                await markAsRead(businessPhoneNumberId, messageId);
                    await checkSubscriptionFunction(businessPhoneNumberId, user, messageId);

                    messageState = "main_menu"; 
                    
                  setMessageState(user, messageState);
        }else if(optionReplyId === "menu_subscribe") {
                await markAsRead(businessPhoneNumberId, messageId);
                    await sendPurchaseFlow(user, "subscription");

                    messageState = "main_menu"; 
                    
                  setMessageState(user, messageState);

        }else if (message?.type === "interactive" && message?.interactive?.type === "nfm_reply") {
          const responseJson = JSON.parse(message.interactive.nfm_reply.response_json);
          const user = message.from; // Ensure user phone is defined from the message sender
          const messageId = message.id;

          // Handle purchase confirmation flow
          if (responseJson.user_action === "CONFIRM_PURCHASE") {
            await markAsRead(businessPhoneNumberId, messageId);
            
            // Trigger Paynow mobile payment
            initiatePayment(businessPhoneNumberId, user, messageId)
              .then(() => console.log("[Webhook] Payment initiated successfully"))
              .catch((err) => console.error("[Webhook] Payment initiation failed:", err.message));

            messageState = "main_menu";
            setMessageState(user, messageState);
          }

          // ✅ Handle tests action flow
          else if (responseJson.action === "tests") {
            await markAsRead(businessPhoneNumberId, messageId);
            await sendPracticeTestFlow(user);

            const text = "You have selected the practice tests menu. Choose an option below to begin:";
            // Add your function to send the tests menu or list here
            // await sendTestsMenuFunction(businessPhoneNumberId, user, messageId, text);

            messageState = "main_menu"; 
            setMessageState(user, messageState);
          }
        }else if (user && optionReplyId) {
            // Check if the user is subscribed or on a trial
            const isAllowed = await checkSubscriptionAndHandleMessage(businessPhoneNumberId, user, messageId);

            if (!isAllowed) {
              setMessageState(user, "main_menu");
              return res.sendStatus(200);

            }else if(optionReplyId && isAllowed){

              if (optionReplyId === "menu_timed_test") {
              await markAsRead(businessPhoneNumberId, messageId);
              await sendTimedTestFlow(user);

              //messageState = "timed_test";
              messageState = "main_menu"; 
              setMessageState(user, messageState);
            
              } else if (optionReplyId === "menu_specialised_tests") {
                await markAsRead(businessPhoneNumberId, messageId);
                  await sendPracticeTestFlow(user);

                  //messageState = "timed_test";
                  messageState = "main_menu"; 
                setMessageState(user, messageState);
                
              } else if(optionReplyId === "menu_retry_failed") {
                await markAsRead(businessPhoneNumberId, messageId);
                    await sendFailedQuestionsFlow(user);

                    //messageState = "timed_test";
                    messageState = "main_menu"; 
                  setMessageState(user, messageState);
              } else if(optionReplyId === "menu_road_rules_course") {
                await markAsRead(businessPhoneNumberId, messageId);
                    await sendHighwayCodeCourseFlow(user);

                    //messageState = "timed_test";
                    messageState = "main_menu"; 
                  setMessageState(user, messageState);
              } else if(optionReplyId === "menu_pdf_resources") {
                await markAsRead(businessPhoneNumberId, messageId);
                    await sendPurchaseFlow(user, "resources");

                    //messageState = "timed_test";
                    messageState = "resources"; 
                    
                  setMessageState(user, messageState);
              } else if (optionReplyId === "menu_track_performance") {
                await markAsRead(businessPhoneNumberId, messageId);
                await analyzeUserPerformance(businessPhoneNumberId, user, messageId);
                messageState = "main_menu";
                setMessageState(user, messageState);
              } else {
                await markAsRead(businessPhoneNumberId, messageId);
                await sendMainMenuList(businessPhoneNumberId, user);
                messageState = "main_menu"; 
                setMessageState(user, messageState);
              }

            }else{
                  await markAsRead(businessPhoneNumberId, messageId);
                  await sendMainMenuList(businessPhoneNumberId, user);
                  messageState = "main_menu"; 
                setMessageState(user, messageState);
            }
        }else{
          await markAsRead(businessPhoneNumberId, messageId);
          await sendMainMenuList(businessPhoneNumberId, user);
          messageState = "main_menu";
          setMessageState(user, messageState);
        }
        
        break;    
        
        case "resources":
        if (buttonReplyId === "downloads"){
          
            await markAsRead(businessPhoneNumberId, messageId);
            await sendPurchaseFlow(user, "resources");

            messageState = "resources";
          setMessageState(user, messageState);
          
        }else {
          await markAsRead(businessPhoneNumberId, messageId);
          await sendMainMenuList(businessPhoneNumberId, user);
          messageState = "main_menu";
          setMessageState(user, messageState);
        }
        break;
    }
  }  
  res.sendStatus(200);
  }
});



connection.getConnection()
  .then(() => {
    console.log('Connected to the database');
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
  });


app.get("/", (req, res) => {
  res.send(`<pre>Nothing to see here. 
Checkout README.md to start.</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});

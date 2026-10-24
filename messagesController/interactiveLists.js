import axios from "axios";

// Default welcome message for the main menu
const DEFAULT_MAIN_MENU_BODY = 
  "🚦 Welcome to *Zim Provisional Driver's License Whatsapp Assistant* - Your *One-Stop* Place to master everything you need to *ACE* your VID provisional Test.\n\n" +
  "Select 'Subscribe/Check Subscription' to subscribe or check your subscription status.\n" +
  "Send 'Menu' for main menu.";

// Function to send the Main Menu interactive list
async function sendMainMenuList(businessPhoneNumberId, user, bodyText = DEFAULT_MAIN_MENU_BODY) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: user,
        type: "interactive",
        interactive: {
          type: "list",
          header: {
            type: "text",
            text: "Main Menu",
          },
          body: {
            text: bodyText,
          },
          footer: {
            text: "Drive safe, Drive smart, Pass easy.",
          },
          action: {
            button: "Menu",
            sections: [
              {
                title: "Study Resources",
                rows: [
                  {
                    id: "menu_road_rules_course",
                    title: "Road Rules Course",
                    description: "Learn short course lessons on road rules",
                  },
                  {
                    id: "menu_pdf_resources",
                    title: "PDF Study Resources",
                    description: "Download Highway Code, signs & booklets",
                  },
                ],
              },
              {
                title: "Tests & Exercises",
                rows: [
                  {
                    id: "menu_specialised_tests",
                    title: "Specialised Tests",
                    description: "Practice category & topic specific tests",
                  },
                  {
                    id: "menu_timed_test",
                    title: "8 Minute Timed Test",
                    description: "Simulate real exam conditions with timer",
                  },
                  {
                    id: "menu_retry_failed",
                    title: "Retry Failed Questions",
                    description: "Review and retry questions you got wrong",
                  },
                ],
              },
              {
                title: "Performance",
                rows: [
                  {
                    id: "menu_track_performance",
                    title: "Track Performance",
                    description: "View progress, scores, and analytics",
                  },
                ],
              },
              {
                title: "Subscription",
                rows: [
                  {
                    id: "menu_check_subscription",
                    title: "Check Subscription",
                    description: "Buy packages or check subscription status",
                  },
                  {
                    id: "menu_subscribe",
                    title: "Subscribe",
                    description: "Buy packages or check subscription status",
                  },
                ],
              },
            ],
          },
        },
      },
    });
  } catch (error) {
    console.error("Error sending main menu interactive list message:", error.response?.data || error.message);
  }
}

// Function to send an interactive Payment Options list message
async function sendOptionsFunction(businessPhoneNumberId, user) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: user,
        type: "interactive",
        interactive: {
          type: "list",
          header: {
            type: "text",
            text: "Choose Payment Option",
          },
          body: {
            text: "Which payment option do you prefer?",
          },
          footer: {
            text: "Drive safe, Drive smart, Pass easy.",
          },
          action: {
            sections: [
              {
                title: "ECOCASH - USD",
                rows: [
                  { id: "usd_ecocash_2weeks", title: "2 Weeks", description: "USD$ 2.05 - 2 Weeks Access." },
                  { id: "usd_ecocash_1month", title: "1 Month", description: "USD$ 3.05 - 1 Month Access. (Save $1-00!) " },
                  { id: "usd_starter", title: "Basic Pack", description: "USD$ 3.55 - 1 Month Access + Highway Code + Road Signs (Save $2-50!)." },
                  { id: "usd_exam_booster", title: "Exam Booster", description: "USD$ 4.05 - Basic Pack + Questions Bank + 1 Month Access (Save $5-00!)." },
                  { id: "usd_self_reliance", title: "Self Reliance Package", description: "USD$ 4.55 - Exam Booster + 2 Months Access (Save $8-50!)." },
                ],
              },
              {
                title: "ECOCASH - ZWG",
                rows: [
                  { id: "zwg_ecocash_2weeks", title: "2 Weeks", description: "ZiG 82 - 2 Weeks Access." },
                  { id: "zwg_ecocash_1month", title: "1 Month", description: "ZiG 122 - 1 Month Access. (Save ZiG 40!)" },
                  { id: "zwg_starter", title: "Basic Pack", description: "ZiG 142 - 1 Month Access + Highway Code + Road Signs (Save ZiG 100!)." },
                  { id: "zwg_exam_booster", title: "Exam Booster", description: "ZiG 162 - Basic Pack + Questions Bank + 1 Month Access (Save ZiG 200!)." },
                  { id: "zwg_self_reliance", title: "Self Reliance Package", description: "ZiG 182 - Exam Booster + 2 Months Access (Save ZiG 340!)." },
                ],
              },
            ],
            button: "Payment Options",
          },
        },
      },
    });
  } catch (error) {
    console.error("Error sending interactive list message:", error.response?.data || error.message);
  }
}

// Function to send an interactive Documents list message
async function sendDocumentOptionsFunction(businessPhoneNumberId, user) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: user,
        type: "interactive",
        interactive: {
          type: "list",
          header: {
            type: "text",
            text: "Choose Document",
          },
          body: {
            text: "Which document would you like to buy?",
          },
          footer: {
            text: "Drive safe, Drive smart, Pass easy.",
          },
          action: {
            sections: [
              {
                title: "ECOCASH - ZWG",
                rows: [
                  {
                    id: "zwg_ecocash_highway_code",
                    title: "Highway Code",
                    description: "ZiG 82",
                  },
                  {
                    id: "zwg_ecocash_road_signs",
                    title: "Road Signs",
                    description: "ZiG 82",
                  },
                  {
                    id: "zwg_ecocash_questions_bank",
                    title: "Questions Bank",
                    description: "ZiG 122",
                  },
                ],
              },
              {
                title: "ECOCASH - USD",
                rows: [
                  {
                    id: "usd_ecocash_highway_code",
                    title: "Highway Code",
                    description: "USD$ 2.05",
                  },
                  {
                    id: "usd_ecocash_road_signs",
                    title: "Road Signs",
                    description: "USD$ 2.05",
                  },
                  {
                    id: "usd_ecocash_questions_bank",
                    title: "Questions Bank",
                    description: "USD$ 3.05",
                  },
                ],
              },
            ],
            button: "Payment Options",
          },
        },
      },
    });
  } catch (error) {
    console.error("Error sending interactive list message:", error.response?.data || error.message);
  }
}

export { sendMainMenuList, sendOptionsFunction, sendDocumentOptionsFunction };
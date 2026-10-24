// ..
import crypto from "node:crypto";
import fs from "node:fs";
import dotenv from "dotenv";
import { userStatesMap, setPaymentAmount, setPaymentNumber, setPaymentOption, setPaymentCurrency, setSubscriptionPackage } from "../userStateManager.js";
import { initiatePayment } from "../paymentsController/initiatePayment.js";

dotenv.config();

const PRIVATE_KEY = fs
  .readFileSync(new URL("../private.pem", import.meta.url), "utf8")
  .trim();

const businessPhoneNumberId = process.env.MY_PHONE_NUMBER_ID;

const RESOURCES = [
  {
    id: "highway_code",
    name: "Highway Code",
    type: "resource",
    envUSD: "PRICE_USD_HIGHWAY_CODE",
    envZWG: "PRICE_ZWG_HIGHWAY_CODE",
    detail: "Downloadable Highway Code study document",
  },
  {
    id: "road_signs",
    name: "Road Signs",
    type: "resource",
    envUSD: "PRICE_USD_ROAD_SIGNS",
    envZWG: "PRICE_ZWG_ROAD_SIGNS",
    detail: "Downloadable Road Signs study document",
  },
  {
    id: "questions_bank",
    name: "Questions Bank",
    type: "resource",
    envUSD: "PRICE_USD_QUESTIONS_BANK",
    envZWG: "PRICE_ZWG_QUESTIONS_BANK",
    detail: "Questions Bank study resource",
  },
];

const SUBSCRIPTIONS = [
  {
    id: "two_weeks",
    name: "2 Weeks",
    type: "subscription",
    envUSD: "PRICE_USD_2_WEEKS",
    envZWG: "PRICE_ZWG_2_WEEKS",
    detail: "2 weeks of assistant access",
  },
  {
    id: "one_month",
    name: "1 Month",
    type: "subscription",
    envUSD: "PRICE_USD_1_MONTH",
    envZWG: "PRICE_ZWG_1_MONTH",
    detail: "1 month of assistant access",
  },
 {
    id: "basic_pack",
    name: "Basic Pack",
    type: "bundle",
    envUSD: "PRICE_USD_BASIC_PACK",
    envZWG: "PRICE_ZWG_BASIC_PACK",
    detail: "1 month access + Highway Code + Road Signs",
  },
  {
    id: "exam_booster",
    name: "Exam Booster",
    type: "bundle",
    envUSD: "PRICE_USD_EXAM_BOOSTER",
    envZWG: "PRICE_ZWG_EXAM_BOOSTER",
    detail: "Basic Pack + Questions Bank + 1 month access",
  },
  {
    id: "self_reliance",
    name: "Self Reliance Package",
    type: "bundle",
    envUSD: "PRICE_USD_SELF_RELIANCE",
    envZWG: "PRICE_ZWG_SELF_RELIANCE",
    detail: "Exam Booster + 2 months access",
  },
];

const PRODUCTS = [...RESOURCES, ...SUBSCRIPTIONS];

const MODE_TITLES = {
  resources: {
    mode_heading: "Select Resource",
    mode_subheading: "Choose the study document or resource you would like to purchase below.",
  },
  subscription: {
    mode_heading: "Choose Subscription Package",
    mode_subheading: "Select your preferred subscription tier or bundle to unlock full access.",
  },
};

// --------------------------------------------------
// Logging helpers
// --------------------------------------------------

function maskPhone(phone) {
  if (!phone) return phone;

  const value = String(phone);

  if (value.length <= 4) return "****";

  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function safeDataForLog(data = {}) {
  return {
    ...data,
    ...(data.payment_phone
      ? { payment_phone: maskPhone(data.payment_phone) }
      : {}),
  };
}

function logPurchaseState(user, label) {
  const state = userStatesMap.get(user);

  if (!state) {
    console.log(`[PurchaseFlow] ${label}: no user state found`);
    return;
  }

  console.log(`[PurchaseFlow] ${label}:`, {
    messageState: state.messageState,
    purchaseFlow: state.purchaseFlow
      ? {
          ...state.purchaseFlow,
          payment_phone: maskPhone(
            state.purchaseFlow.payment_phone
          ),
        }
      : null,
    paymentOption: state.paymentOption,
    paymentNumber: maskPhone(state.paymentNumber),
    paymentAmount: state.paymentAmount,
    paymentCurrency: state.paymentCurrency,
    subscriptionPackage: state.subscriptionPackage,
  });
}

// --------------------------------------------------
// Purchase mode and user context
// --------------------------------------------------

function normalizeMode(mode) {
  if (mode !== "resources" && mode !== "subscription") {
    throw new Error(
      'Invalid purchase mode. User messageState must be "resources" or "subscription".'
    );
  }

  return mode;
}

function getFlowContext(decryptedBody) {
  const flowToken = decryptedBody?.flow_token;

  if (
    typeof flowToken !== "string" ||
    !flowToken.startsWith("purchase:")
  ) {
    throw new Error(
      "Purchase Flow token is missing or invalid. Please reopen the menu."
    );
  }

  const user = flowToken.slice("purchase:".length);

  if (!user) {
    throw new Error("Could not identify the user for this purchase.");
  }

  const userState = userStatesMap.get(user);

  if (!userState) {
    throw new Error(
      "Your session has expired. Please reopen the purchase menu."
    );
  }

  const mode = normalizeMode(userState.purchaseFlow?.mode);

  return { user, userState, mode };
}

// --------------------------------------------------
// Product catalogue and pricing
// --------------------------------------------------

function productsForMode(mode) {
  normalizeMode(mode);

  if (mode === "resources") {
    return PRODUCTS.filter(
      (product) => product.type === "resource"
    );
  }

  return PRODUCTS.filter(
    (product) =>
      product.type === "subscription" ||
      product.type === "bundle"
  );
}

function getPrice(product, currency) {
  const envName =
    currency === "USD" ? product.envUSD : product.envZWG;

  const raw = process.env[envName];

  if (raw == null || String(raw).trim() === "") {
    return null;
  }

  const price = Number(raw);

  return Number.isFinite(price) && price > 0 ? price : null;
}

function money(currency, price) {
  return currency === "USD"
    ? `USD $${price.toFixed(2)}`
    : `ZiG ${price.toFixed(2)}`;
}

function buildProductOptions(mode) {
  const usdOptions = [];
  const zwgOptions = [];

  for (const product of productsForMode(mode)) {
    for (const currency of ["USD", "ZWG"]) {
      const price = getPrice(product, currency);

      if (price == null) {
        const envName =
          currency === "USD" ? product.envUSD : product.envZWG;

        console.warn(
          `[PurchaseFlow] Missing or invalid price: ${envName}`
        );

        continue;
      }

      const optionItem = {
        id: `${product.id}__${currency}`,
        title: `${product.name} (${product.detail}) — ${money(currency, price)}`,
      };

      if (currency === "USD") {
        usdOptions.push(optionItem);
      } else {
        zwgOptions.push(optionItem);
      }
    }
  }

  const options = [];

  // Add USD Section if options exist
  if (usdOptions.length > 0) {
    options.push({
      id: "header_usd",
      title: "=== USD PRICED OPTIONS ===",
      enabled: false, // Makes it unselectable if supported by the component layout
    });
    options.push(...usdOptions);
  }

  // Add ZiG Section if options exist
  if (zwgOptions.length > 0) {
    options.push({
      id: "header_zig",
      title: "=== ZIG PRICED OPTIONS ===",
      enabled: false,
    });
    options.push(...zwgOptions);
  }

  if (!options.length) {
    throw new Error(
      `No prices are configured in .env for purchase mode "${mode}".`
    );
  }

  console.log("[PurchaseFlow] Product options generated with headings:", {
    mode,
    count: options.length,
    options,
  });

  return options;
}

function resolveChoice(choiceId, mode) {
  if (typeof choiceId !== "string") {
    throw new Error("Please select a purchase option.");
  }

  const match = /^(.*)__(USD|ZWG)$/.exec(choiceId);

  if (!match) {
    throw new Error(
      "That purchase option is invalid. Please select it again."
    );
  }

  const [, productId, currency] = match;

  const product = PRODUCTS.find(
    (item) => item.id === productId
  );

  if (!product) {
    throw new Error("The selected product could not be found.");
  }

  if (
    !productsForMode(mode).some(
      (item) => item.id === product.id
    )
  ) {
    throw new Error(
      "That item is not available in this purchase mode."
    );
  }

  const price = getPrice(product, currency);

  if (price == null) {
    throw new Error(
      "The selected price is not configured. Please choose another option."
    );
  }

  return { product, currency, price };
}

function formatPhone(phone) {
  const value = String(phone ?? "").trim();

  if (!/^07\d{8}$/.test(value)) {
    throw new Error(
      "Enter a valid EcoCash number in the format 0771234567."
    );
  }

  return value;
}

// --------------------------------------------------
// Build and save selected product data
// --------------------------------------------------

function buildProductData(mode, choiceId) {
  const { product, currency, price } = resolveChoice(
    choiceId,
    mode
  );

  // Use the actual properties from the PRODUCTS catalogue.
  const formattedPrice = money(currency, price);

  // Send complete strings to WhatsApp Flow instead of relying
  // on interpolation inside a longer TextBody string.
  return {
    mode,
    product_id: product.id,
    product_choice: choiceId,
    product_name: product.name,
    product_type: product.type,
    product_detail: product.detail,

    currency,
    price_currency: currency,
    price: String(price),
    formatted_price: formattedPrice,

    // Display fields used by the Flow JSON.
    product_type_display: `Product type: ${product.type}`,
    mode_display: `Purchase category: ${mode}`,
    product_choice_display: `Selected option: ${choiceId}`,
    currency_display: `Currency: ${currency}`,
    formatted_price_display: `Total price: ${formattedPrice}`,
  };
}

function saveProductToState(userState, productData) {
  userState.purchaseFlow = {
    ...(userState.purchaseFlow || {}),
    ...productData,
    payment_phone:
      userState.purchaseFlow?.payment_phone ?? null,
    status: "product_selected",
  };

  // Maintain compatibility with existing payment-related state.
  userState.paymentAmount = Number(productData.price);
  userState.paymentCurrency = productData.price_currency;
  userState.paymentOption = "EcoCash";

  if (productData.product_type === "subscription") {
    userState.subscriptionPackage = productData.product_id;
  }

  console.log("[PurchaseFlow] Product saved to user state:", {
    ...userState.purchaseFlow,
    payment_phone: maskPhone(
      userState.purchaseFlow.payment_phone
    ),
  });
}

function getSavedOrSubmittedChoice(data, userState) {
  const submittedChoice = data?.product_choice;

  if (
    typeof submittedChoice === "string" &&
    submittedChoice.trim()
  ) {
    return submittedChoice;
  }

  const savedChoice = userState.purchaseFlow?.product_choice;

  if (
    typeof savedChoice === "string" &&
    savedChoice.trim()
  ) {
    console.log(
      "[PurchaseFlow] Reusing saved product choice:",
      savedChoice
    );

    return savedChoice;
  }

  throw new Error(
    "Your selected product was not found. Please reopen the purchase menu."
  );
}

// --------------------------------------------------
// Meta Flow encryption
// --------------------------------------------------

function decryptRequest(body) {
  const {
    encrypted_aes_key,
    encrypted_flow_data,
    initial_vector,
  } = body ?? {};

  if (
    !encrypted_aes_key ||
    !encrypted_flow_data ||
    !initial_vector
  ) {
    throw new Error(
      "Meta Flow request is missing encryption fields."
    );
  }

  const privateKey = crypto.createPrivateKey(
    PRIVATE_KEY.replace(/\\n/g, "\n").trim()
  );

  const aesKeyBuffer = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  if (aesKeyBuffer.length !== 16) {
    throw new Error(
      `Unexpected AES key length: ${aesKeyBuffer.length}`
    );
  }

  const initialVectorBuffer = Buffer.from(
    initial_vector,
    "base64"
  );

  const encryptedBuffer = Buffer.from(
    encrypted_flow_data,
    "base64"
  );

  const tagLength = 16;

  if (encryptedBuffer.length <= tagLength) {
    throw new Error("Encrypted Flow payload is invalid.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    aesKeyBuffer,
    initialVectorBuffer
  );

  decipher.setAuthTag(
    encryptedBuffer.subarray(-tagLength)
  );

  const decryptedText = Buffer.concat([
    decipher.update(
      encryptedBuffer.subarray(0, -tagLength)
    ),
    decipher.final(),
  ]).toString("utf8");

  return {
    decryptedBody: JSON.parse(decryptedText),
    aesKeyBuffer,
    initialVectorBuffer,
  };
}

function encryptResponse(
  payload,
  aesKeyBuffer,
  initialVectorBuffer
) {
  // Meta requires the response IV to be the bitwise inverse
  // of the request IV.
  const responseIv = Buffer.from(
    initialVectorBuffer.map((byte) => byte ^ 0xff)
  );

  const cipher = crypto.createCipheriv(
    "aes-128-gcm",
    aesKeyBuffer,
    responseIv
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([
    encrypted,
    cipher.getAuthTag(),
  ]).toString("base64");
}

function sendEncryptedResponse(
  res,
  payload,
  aesKeyBuffer,
  initialVectorBuffer
) {

  // Mask the phone number in logs without changing the actual response.
  const safePayload = JSON.parse(JSON.stringify(payload));

  if (safePayload?.data?.payment_phone) {
    safePayload.data.payment_phone = maskPhone(
      safePayload.data.payment_phone
    );
  }

  let encryptedResponse;

  try {
    encryptedResponse = encryptResponse(
      payload,
      aesKeyBuffer,
      initialVectorBuffer
    );

    console.log("[PurchaseFlow] Encryption successful:", {
      responseType: typeof encryptedResponse,
      responseLength: encryptedResponse.length,
      isBase64String:
        typeof encryptedResponse === "string" &&
        /^[A-Za-z0-9+/]+=*$/.test(encryptedResponse),
    });
  } catch (error) {
    console.error(
      "[PurchaseFlow] RESPONSE ENCRYPTION FAILED:",
      {
        message: error.message,
        stack: error.stack,
      }
    );

    throw error;
  }

  res.setHeader("Content-Type", "text/plain");

  console.log("[PurchaseFlow] Sending HTTP response:", {
    status: 200,
    contentType: res.getHeader("Content-Type"),
    encryptedLength: encryptedResponse.length,
  });

  const result = res.status(200).send(encryptedResponse);

  console.log("[PurchaseFlow] HTTP response sent:", {
    statusCode: res.statusCode,
    headersSent: res.headersSent,
    writableEnded: res.writableEnded,
  });

  console.log(
    "[PurchaseFlow] =====================================\n"
  );

  return result;
}

// --------------------------------------------------
// Main endpoint: every encrypted Flow screen request
// --------------------------------------------------

export async function managePurchaseFlow(req, res) {
  let aesKeyBuffer;
  let initialVectorBuffer;
  let userForLogging;

  try {
    const decrypted = decryptRequest(req.body);
    const { decryptedBody } = decrypted;

    aesKeyBuffer = decrypted.aesKeyBuffer;
    initialVectorBuffer = decrypted.initialVectorBuffer;

    const {
      action,
      data,
      screen,
      flow_token: flowToken,
    } = decryptedBody;

    const userAction = data?.user_action;

    // Meta health check.
    if (action === "ping") {
      console.log("[PurchaseFlow] Responding to ping.");

      return sendEncryptedResponse(
        res,
        { data: { status: "active" } },
        aesKeyBuffer,
        initialVectorBuffer
      );
    }

    const { user, userState, mode } =
      getFlowContext(decryptedBody);

    userForLogging = user;

    logPurchaseState(
      user,
      "State before processing request"
    );

    // ------------------------------------------------
    // INIT: render the mode-specific product selector
    // ------------------------------------------------

    if (action === "INIT") {
      const products = buildProductOptions(mode);
      const modeInfo = MODE_TITLES[mode] || MODE_TITLES.resources; // Fallback

      userState.purchaseFlow = {
        mode,
        product_id: null,
        product_choice: null,
        product_name: null,
        product_type: null,
        product_detail: null,
        currency: null,
        price_currency: null,
        price: null,
        formatted_price: null,
        payment_phone: null,
        status: "selecting_product",
      };

      console.log("[PurchaseFlow] INIT state initialized:", {
        mode,
        productCount: products.length,
      });

      logPurchaseState(user, "State after INIT");

      return sendEncryptedResponse(
        res,
        {
          screen: "SELECT_PRODUCT",
          data: {
            mode,
            mode_heading: modeInfo.mode_heading,
            mode_subheading: modeInfo.mode_subheading,
            products,
          },
        },
        aesKeyBuffer,
        initialVectorBuffer
      );
    }

    // ------------------------------------------------
    // SELECT_PRODUCT: save selection and open phone screen
    // ------------------------------------------------

    if (
      userAction === "SELECT_PRODUCT" &&
      screen === "SELECT_PRODUCT"
    ) {
      const choiceId = getSavedOrSubmittedChoice(
        data,
        userState
      );

      console.log(
        "[PurchaseFlow] Processing product selection:",
        {
          choiceId,
          mode,
        }
      );

      const productData = buildProductData(
        mode,
        choiceId
      );

      saveProductToState(userState, productData);


      const responsePayload = {
        screen: "ENTER_PHONE",
        data: productData,
      };

      console.log(
        "[PurchaseFlow] ENTER_PHONE response data:",
        responsePayload.data
      );

      logPurchaseState(
        user,
        "State after SELECT_PRODUCT"
      );

      return sendEncryptedResponse(
        res,
        responsePayload,
        aesKeyBuffer,
        initialVectorBuffer
      );
    }

    // ------------------------------------------------
    // REVIEW_PURCHASE: save phone and open final review screen
    // ------------------------------------------------

    if (
      userAction === "REVIEW_PURCHASE" &&
      screen === "ENTER_PHONE"
    ) {
      const choiceId = getSavedOrSubmittedChoice(
        data,
        userState
      );

      console.log(
        "[PurchaseFlow] Processing phone submission:",
        {
          choiceId,
          paymentPhoneProvided: Boolean(data?.payment_phone),
          paymentPhone: maskPhone(data?.payment_phone),
        }
      );

      // Resolve the product and price from trusted server data.
      const productData = buildProductData(
        mode,
        choiceId
      );

      // Validate the submitted EcoCash number.
      const paymentPhone = formatPhone(
        data?.payment_phone ??
          userState.purchaseFlow?.payment_phone
      );

      saveProductToState(userState, productData);

      userState.purchaseFlow = {
        ...userState.purchaseFlow,
        ...productData,
        payment_phone: paymentPhone,
        status: "awaiting_user_completion",
      };

      // Maintain existing downstream payment state.
      userState.paymentOption = "ecoCash";
      userState.paymentNumber = paymentPhone;
      userState.paymentAmount = Number(productData.price);
      userState.paymentCurrency = productData.price_currency;

      setPaymentOption(user, "ecocash");
      setPaymentNumber(user, paymentPhone);
      setPaymentAmount(user, Number(productData.price));
      setPaymentCurrency(user, productData.price_currency);
      setSubscriptionPackage(user, productData.product_name);

      if (productData.product_type === "subscription") {
        userState.subscriptionPackage = productData.product_id;
      }

      const paymentDisclosureText =
        productData.product_type === "subscription"
          ? `You are about to subscribe to ${productData.formatted_price} ${productData.product_name}. By selecting Yes & Continue, you agree to the Zim Provisional Driver's License WhatsApp Assistant Terms and Conditions.`
          : `You are about to purchase ${productData.formatted_price} ${productData.product_name}. By selecting Yes & Continue, you agree to the Zim Provisional Driver's License WhatsApp Assistant Terms and Conditions.`;

      const responsePayload = {
        screen: "REVIEW_PURCHASE",
        data: {
          ...productData,
          payment_phone: paymentPhone,
          payment_phone_display: `EcoCash number: ${paymentPhone}`,
          payment_disclosure: paymentDisclosureText,
        },
      };

      console.log(
        "[PurchaseFlow] REVIEW_PURCHASE response data:",
        {
          ...responsePayload.data,
          payment_phone: maskPhone(paymentPhone),
        }
      );

      logPurchaseState(
        user,
        "State after REVIEW_PURCHASE"
      );

      return sendEncryptedResponse(
        res,
        responsePayload,
        aesKeyBuffer,
        initialVectorBuffer
      );
    }

    // ------------------------------------------------
    // Unsupported screen/action
    // ------------------------------------------------

    console.error(
      "[PurchaseFlow] Unsupported screen change:",
      {
        action,
        screen,
        userAction: userAction ?? null,
        mode,
      }
    );

    throw new Error(
      `Unsupported action "${userAction}" on screen "${screen}".`
    );
  } catch (error) {
    console.error(
      "[PurchaseFlow] Endpoint processing error:",
      {
        message: error.message,
        stack: error.stack,
      }
    );

    if (userForLogging) {
      logPurchaseState(
        userForLogging,
        "State after processing error"
      );
    }

    if (aesKeyBuffer && initialVectorBuffer) {
      try {
        return sendEncryptedResponse(
          res,
          {
            data: {
              error:
                error.message ||
                "We could not process this purchase. Please try again.",
            },
          },
          aesKeyBuffer,
          initialVectorBuffer
        );
      } catch (encryptError) {
        console.error(
          "[PurchaseFlow] Unable to encrypt error response:",
          encryptError.message
        );
      }
    }

    return res
      .status(421)
      .send("Decryption or Processing Error");
  }
}

export default managePurchaseFlow;
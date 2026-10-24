const PRODUCTS = {
  highway_code: {
    name: "Highway Code",
    type: "resource",
    priceUSD: () => process.env.PRICE_USD_HIGHWAY_CODE,
    priceZWG: () => process.env.PRICE_ZWG_HIGHWAY_CODE,
  },

  road_signs: {
    name: "Road Signs",
    type: "resource",
    priceUSD: () => process.env.PRICE_USD_ROAD_SIGNS,
    priceZWG: () => process.env.PRICE_ZWG_ROAD_SIGNS,
  },

  questions_bank: {
    name: "Questions Bank",
    type: "resource",
    priceUSD: () => process.env.PRICE_USD_QUESTIONS_BANK,
    priceZWG: () => process.env.PRICE_ZWG_QUESTIONS_BANK,
  },

  two_weeks: {
    name: "2 Weeks",
    type: "subscription",
    priceUSD: () => process.env.PRICE_USD_2_WEEKS,
    priceZWG: () => process.env.PRICE_ZWG_2_WEEKS,
  },

  one_month: {
    name: "1 Month",
    type: "subscription",
    priceUSD: () => process.env.PRICE_USD_1_MONTH,
    priceZWG: () => process.env.PRICE_ZWG_1_MONTH,
  },

  basic_pack: {
    name: "Basic Pack",
    type: "bundle",
    priceUSD: () => process.env.PRICE_USD_BASIC_PACK,
    priceZWG: () => process.env.PRICE_ZWG_BASIC_PACK,
  },

  essentials_combo: {
    name: "Essentials Combo",
    type: "bundle",
    priceUSD: () => process.env.PRICE_USD_ESSENTIALS_COMBO,
    priceZWG: () => process.env.PRICE_ZWG_ESSENTIALS_COMBO,
  },

  exam_booster: {
    name: "Exam Booster",
    type: "bundle",
    priceUSD: () => process.env.PRICE_USD_EXAM_BOOSTER,
    priceZWG: () => process.env.PRICE_ZWG_EXAM_BOOSTER,
  },

  self_reliance: {
    name: "Self Reliance Package",
    type: "bundle",
    priceUSD: () => process.env.PRICE_USD_SELF_RELIANCE,
    priceZWG: () => process.env.PRICE_ZWG_SELF_RELIANCE,
  },
};

export function getProduct(productId) {
  return PRODUCTS[productId] ?? null;
}

export function getProductPrice(productId, currency) {
  const product = getProduct(productId);

  if (!product) {
    throw new Error("Unknown product");
  }

  const rawPrice =
    currency === "USD"
      ? product.priceUSD()
      : currency === "ZWG"
        ? product.priceZWG()
        : null;

  if (
    rawPrice == null ||
    rawPrice.trim() === "" ||
    !Number.isFinite(Number(rawPrice)) ||
    Number(rawPrice) <= 0
  ) {
    throw new Error(
      `Missing or invalid price for ${productId} (${currency})`
    );
  }

  return Number(rawPrice);
}
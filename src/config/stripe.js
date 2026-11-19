import Stripe from "stripe";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export const getStripeSecretKey = () => {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
};

export const getStripeWebhookSecret = () => {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
};

export const getStripeCurrency = () => {
  return (process.env.STRIPE_CURRENCY || "usd").toLowerCase().trim();
};

export const getFrontendUrl = () => {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "https://salonbook-virid.vercel.app"
  ).replace(/\/$/, "");
};

let stripeClientInstance = null;

export const getStripeClient = () => {
  const secretKey = getStripeSecretKey();
  if (!secretKey || secretKey === "sk_test_your_stripe_secret_key") {
    return null;
  }
  if (!stripeClientInstance || stripeClientInstance._secret !== secretKey) {
    stripeClientInstance = new Stripe(secretKey);
    stripeClientInstance._secret = secretKey;
  }
  return stripeClientInstance;
};

/**
 * Converts standard currency amount into Stripe's smallest unit (e.g. $85.00 -> 8500 cents)
 */
export const formatStripeAmount = (amount, currency = "usd") => {
  const curr = (currency || "usd").toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(curr)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
};

/**
 * Converts Stripe's smallest unit back to standard currency amount (e.g. 8500 cents -> 85.00)
 */
export const parseStripeAmount = (stripeAmount, currency = "usd") => {
  const curr = (currency || "usd").toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(curr)) {
    return stripeAmount;
  }
  return stripeAmount / 100;
};

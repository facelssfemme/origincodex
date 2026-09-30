export function required(name: string) {
  const value = process.env[name];
  if (!value) throw Error(`Missing configuration: ${name}`);
  return value;
}
export function paymentConfig() {
  const environment = required("SYRENA_PAYMENT_MODE");
  if (environment !== "test" && environment !== "live")
    throw Error("Invalid payment mode");
  const key = required("STRIPE_SECRET_KEY");
  if (!new RegExp(`^[sr]k_${environment}_`).test(key))
    throw Error("Credential mode mismatch");
  const accountId = required("SYRENA_STRIPE_ACCOUNT_ID");
  if (accountId !== "acct_1SrJtXK3yFNUEpTU")
    throw Error("Unapproved Stripe account");
  const origin = required("SYRENA_APP_ORIGIN");
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (environment === "live" && url.protocol !== "https:") ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw Error("Invalid app origin");
  const accessSecret = required("SYRENA_ORDER_ACCESS_SECRET");
  if (accessSecret.length < 32) throw Error("Order access secret is too short");
  required("DATABASE_URL");
  return {
    environment: environment as "test" | "live",
    key,
    origin,
    accessSecret,
    accountId,
    basePrice: required("STRIPE_BASE_PRICE_ID"),
    shadowPrice: required("STRIPE_SHADOW_PRICE_ID"),
  };
}

// Check only when opening live checkout; payment webhooks must keep reconciling
// existing purchases if generation is subsequently paused.
export function assertLiveCheckoutReady() {
  if (process.env.SYRENA_LIVE_CHECKOUT_ENABLED !== "approved-live")
    throw Error("Live checkout disabled");
  if (
    process.env.SYRENA_GENERATION_ENABLED !== "approved-live" ||
    process.env.SYRENA_FULFILLMENT_READY !== "approved-live"
  )
    throw Error("Live delivery not enabled");
  for (const name of [
    "STRIPE_WEBHOOK_SECRET",
    "ANTHROPIC_API_KEY",
    "SYRENA_READING_MODEL",
    "ELEVENLABS_API_KEY",
    "RESEND_API_KEY",
    "RESEND_EMAIL_FROM",
  ])
    required(name);
  if (required("SYRENA_WORKER_SECRET").length < 32)
    throw Error("Worker secret too short");
  if (
    process.env.ELEVENLABS_VOICE_ID !== "uG1JFy6xppqckhHCs2KG" ||
    process.env.SYRENA_VOICE_APPROVED !== "true"
  )
    throw Error("Approved website voice required");
}

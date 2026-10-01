import { createServerFn } from "@tanstack/react-start";
import Stripe from "stripe";
import {
  APP_TAG,
  CATALOG,
  CURRENCY,
  configuredPriceIds,
  expectedAmountCents,
  getPriceId,
  getStripeSecretKey,
  isAllowedPriceId,
  resolveSiteUrl,
  type PlanKey,
} from "~/server/stripe-catalog";
import { recordVerifiedPurchase, type VerifiedPurchaseContext } from "~/server/events";

/**
 * Stripe Checkout for the Starseed Origin Reading — created and verified
 * server-side. Nothing about pricing or payment state is trusted from the
 * client:
 *
 *   createCheckoutSession  builds a Checkout Session for the quiz result and
 *                          returns Stripe's hosted URL. Price IDs come from
 *                          server-side config (~/server/stripe-catalog), never
 *                          from the browser. success_url points back at
 *                          /thank-you with Stripe's {CHECKOUT_SESSION_ID}.
 *   verifyCheckoutSession  retrieves the session from Stripe, confirms it was
 *                          paid, belongs to this product and carries our quiz
 *                          metadata, then records the `purchase` analytics
 *                          event itself. /thank-you only shows a reading when
 *                          this returns verified: true.
 *
 * No webhook is required for this flow (verification is a synchronous session
 * retrieve, so delivery happens even if a webhook is missed). If
 * STRIPE_WEBHOOK_SECRET is later configured, a webhook could be added as a
 * belt-and-braces path without changing this contract.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckoutQuizContext {
  name?: string;
  primaryArchetype?: string;
  secondaryArchetype?: string;
  sunSign?: string;
  /** One-time DB token, recorded so a buyer returning in a new tab can still be matched. */
  token?: string;
}

export interface CheckoutRequest {
  includeShadow: boolean;
  customerEmail?: string;
  quiz?: CheckoutQuizContext;
  /** window.location.origin — only used when SITE_URL is unset, and only for allowlisted hosts. */
  origin?: string;
}

export interface CheckoutResponse {
  ok: boolean;
  /** Stripe-hosted Checkout URL to redirect to. */
  url?: string;
  sessionId?: string;
  /** Machine-readable failure code: stripe_not_configured | stripe_error | no_checkout_url. */
  reason?: string;
  /** Buyer-facing message (safe to render). */
  message?: string;
}

export interface VerifyRequest {
  sessionId?: string;
  /** Client-side attribution context; never used for revenue math. */
  context?: VerifiedPurchaseContext;
}

export interface VerifyResponse {
  verified: boolean;
  reason?: string;
  message?: string;
  sessionId?: string;
  /** Amount actually charged, in dollars. */
  amount?: number;
  currency?: string;
  /** Email Stripe has on record for this payment (authoritative buyer email). */
  email?: string;
  includeShadow?: boolean;
  name?: string;
  primaryArchetype?: string;
  secondaryArchetype?: string;
  sunSign?: string;
  paymentIntentId?: string;
  /** True when this call wrote the (deduplicated) `purchase` event. */
  purchaseRecorded?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{4,}$/;
/** Stripe metadata values are capped at 500 chars; stay clear of the limit. */
const MAX_METADATA_VALUE = 480;

function cleanMetadataValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_METADATA_VALUE ? trimmed.slice(0, MAX_METADATA_VALUE) : trimmed;
}

function buildMetadata(req: CheckoutRequest, plan: PlanKey): Record<string, string> {
  const includeShadow = req.includeShadow === true;
  const metadata: Record<string, string> = {
    app: APP_TAG,
    plan,
    include_shadow: includeShadow ? "true" : "false",
    expected_amount_cents: String(expectedAmountCents(includeShadow)),
  };

  const quiz: [string, unknown][] = [
    ["customer_name", req.quiz?.name],
    ["primary_archetype", req.quiz?.primaryArchetype],
    ["secondary_archetype", req.quiz?.secondaryArchetype],
    ["sun_sign", req.quiz?.sunSign],
    ["quiz_token", req.quiz?.token],
  ];
  for (const [key, raw] of quiz) {
    const value = cleanMetadataValue(raw);
    if (value) metadata[key] = value;
  }
  return metadata;
}

/**
 * Line items for the order. Prefers catalog price IDs (so Stripe reporting and
 * verification line up with the dashboard); falls back to an inline
 * `price_data` entry at the same amount when an ID is not configured.
 */
function buildLineItems(plan: PlanKey, includeShadow: boolean): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const lineItemFor = (key: PlanKey): Stripe.Checkout.SessionCreateParams.LineItem => {
    const priceId = getPriceId(key);
    if (priceId) return { price: priceId, quantity: 1 };
    return {
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: CATALOG[key].amountCents,
        product_data: { name: CATALOG[key].label },
      },
    };
  };

  if (!includeShadow) return [lineItemFor("base")];
  // The order bump is a real line item when we have separate prices, so Stripe
  // reporting shows the add-on; otherwise use the bundle price.
  const bundlePriceId = getPriceId("bundle");
  if (bundlePriceId) return [{ price: bundlePriceId, quantity: 1 }];
  return [lineItemFor("base"), lineItemFor("shadow")];
}

function lineItemPriceIds(session: Stripe.Checkout.Session): string[] {
  const items = session.line_items?.data ?? [];
  return items
    .map((item) => (typeof item.price === "object" && item.price ? item.price.id : item.price))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// ─── Create a Checkout Session ───────────────────────────────────────────────

export const createCheckoutSession = createServerFn({ method: "POST" })
  .validator((d: CheckoutRequest) => d)
  .handler(async ({ data }): Promise<CheckoutResponse> => {
    const secretKey = getStripeSecretKey();
    if (!secretKey) {
      console.error("[stripe] STRIPE_SECRET_KEY is not set — checkout is disabled");
      return {
        ok: false,
        reason: "stripe_not_configured",
        message:
          "Secure checkout isn't connected yet. Please try again in a few minutes — no payment has been taken.",
      };
    }

    const includeShadow = data?.includeShadow === true;
    const plan: PlanKey = includeShadow ? "bundle" : "base";
    const customerEmail =
      typeof data?.customerEmail === "string" && EMAIL_RE.test(data.customerEmail.trim())
        ? data.customerEmail.trim()
        : undefined;

    const siteUrl = resolveSiteUrl(data?.origin);
    const metadata = buildMetadata({ ...data, includeShadow }, plan);

    const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
      description: `${CATALOG[plan].label} — The Origin Codex`,
      metadata,
    };
    if (customerEmail) {
      // Receipt goes straight from Stripe, independent of the thank-you page.
      paymentIntentData.receipt_email = customerEmail;
    }

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: buildLineItems(plan, includeShadow),
      // Stripe appends the real session id — this is what /thank-you verifies.
      success_url: `${siteUrl}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      // Abandoning checkout returns to the paywall (quiz restores the reveal).
      cancel_url: `${siteUrl}/quiz?checkout=cancelled`,
      metadata,
      payment_intent_data: paymentIntentData,
    };
    if (customerEmail) {
      params.customer_email = customerEmail;
      // Keep a durable Stripe customer record for this buyer, not just a receipt.
      params.customer_creation = "always";
    }

    try {
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.create(params);
      if (!session.url) {
        console.error("[stripe] session created without a checkout URL:", session.id);
        return {
          ok: false,
          reason: "no_checkout_url",
          message: "We couldn't open secure checkout. Please try again in a moment.",
        };
      }
      return { ok: true, url: session.url, sessionId: session.id };
    } catch (err) {
      console.error("[stripe] failed to create checkout session:", err);
      return {
        ok: false,
        reason: "stripe_error",
        message: "We couldn't open secure checkout. Please try again in a moment.",
      };
    }
  });

// ─── Verify a returned Checkout Session ──────────────────────────────────────

/**
 * Retrieve the session from Stripe and decide whether this really is a paid
 * Starseed Origin Reading order. Anything that cannot be proven is rejected —
 * an arbitrary `?session_id=` string no longer unlocks a reading.
 */
export const verifyCheckoutSession = createServerFn({ method: "POST" })
  .validator((d: VerifyRequest) => d)
  .handler(async ({ data }): Promise<VerifyResponse> => {
    const sessionId = typeof data?.sessionId === "string" ? data.sessionId.trim() : "";
    if (!SESSION_ID_RE.test(sessionId)) {
      return {
        verified: false,
        reason: "invalid_session_id",
        message: "We couldn't find a payment for this link.",
      };
    }

    const secretKey = getStripeSecretKey();
    if (!secretKey) {
      console.error("[stripe] STRIPE_SECRET_KEY is not set — cannot verify payments");
      return {
        verified: false,
        reason: "stripe_not_configured",
        message:
          "Payment verification isn't connected yet. If you were charged, your Stripe receipt is your record — please reply to it and we'll send your reading.",
      };
    }

    try {
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });

      const reject = (reason: string, message: string): VerifyResponse => {
        console.warn("[stripe] payment verification rejected:", sessionId, reason);
        return { verified: false, reason, message };
      };

      // 1. The session must be one we created for this product.
      if (session.metadata?.app !== APP_TAG) {
        return reject("not_our_session", "This payment isn't for a Starseed Origin Reading.");
      }
      if (session.mode !== "payment") {
        return reject("wrong_mode", "This payment isn't a one-time reading purchase.");
      }

      // 2. It must actually be paid.
      if (session.payment_status !== "paid" || session.status !== "complete") {
        return reject("not_paid", "This payment hasn't completed yet. If you were just charged, refresh in a moment.");
      }

      // 3. Amount and currency must match the order the quiz asked for.
      if ((session.currency ?? "").toLowerCase() !== CURRENCY) {
        return reject("currency_mismatch", "This payment was made in an unsupported currency.");
      }
      const includeShadow = session.metadata?.include_shadow === "true";
      const expected = expectedAmountCents(includeShadow);
      if (session.amount_total !== expected) {
        return reject("amount_mismatch", "This payment amount doesn't match a Starseed Origin Reading order.");
      }

      // 4. When the catalog price IDs are configured, every line item must be one of them.
      const priceIds = lineItemPriceIds(session);
      if (configuredPriceIds().length > 0) {
        if (priceIds.length === 0) {
          return reject("no_line_items", "This payment has no line items we can match to our catalog.");
        }
        if (priceIds.some((id) => !isAllowedPriceId(id))) {
          return reject("price_not_in_catalog", "This payment doesn't match our product catalog.");
        }
      }

      const amountCents = session.amount_total ?? expected;
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      const email = session.customer_details?.email ?? session.customer_email ?? undefined;

      // Payment is real — record the (deduplicated) purchase event server-side.
      // A logging failure must never block the reading.
      const purchaseRecorded = await recordVerifiedPurchase({
        data: {
          stripeSessionId: session.id,
          amountCents,
          currency: session.currency ?? CURRENCY,
          includeShadow,
          paymentIntentId,
          email,
          context: data?.context,
        },
      });

      return {
        verified: true,
        sessionId: session.id,
        amount: Math.round(amountCents) / 100,
        currency: session.currency ?? CURRENCY,
        email,
        includeShadow,
        name: session.metadata?.customer_name,
        primaryArchetype: session.metadata?.primary_archetype,
        secondaryArchetype: session.metadata?.secondary_archetype,
        sunSign: session.metadata?.sun_sign,
        paymentIntentId,
        purchaseRecorded,
      };
    } catch (err) {
      console.error("[stripe] session verification failed:", err);
      return {
        verified: false,
        reason: "verification_failed",
        message: "We couldn't verify this payment with Stripe. If you were charged, your Stripe receipt is your record.",
      };
    }
  });

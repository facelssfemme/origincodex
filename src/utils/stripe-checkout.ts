import { createServerFn } from "@tanstack/react-start";
import Stripe from "stripe";

const STRIPE_PRICE_BASE = "price_1TttZrDSBWwnXC8boAV0Lg8Z";
const STRIPE_PRICE_SHADOW = "price_1TttuzDSBWwnXC8bG372J8lJ";

export const createCheckoutSession = createServerFn({ method: "POST" })
  .validator((d: { includeShadow: boolean; customerEmail?: string }) => d)
  .handler(async ({ data }) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      const baseUrl = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8i9j0";
      return {
        url: data.includeShadow
          ? baseUrl
          : baseUrl,
        sessionId: "cs_test_placeholder",
      };
    }

    const stripe = new Stripe(secretKey, {
      apiVersion: "2025-03-31.agent",
    });

    const lineItems = [
      { price: STRIPE_PRICE_BASE, quantity: 1 },
    ];

    if (data.includeShadow) {
      lineItems.push({ price: STRIPE_PRICE_SHADOW, quantity: 1 });
    }

    const origin = process.env.SITE_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: "payment",
      success_url: `${origin}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/quiz`,
      customer_email: data.customerEmail,
      allow_promotion_codes: true,
    });

    return {
      url: session.url,
      sessionId: session.id,
    };
  });

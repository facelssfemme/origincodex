import { createServerFn } from "@tanstack/react-start";

// Payment links created via the platform's Stripe integration
// These are the supported way to accept payments without a server-side secret key
const PAYMENT_LINK_BASE = "https://buy.stripe.com/00w4gz3lq2TSaLG3oJ2Ry00";
const PAYMENT_LINK_COMBO = "https://buy.stripe.com/00waEXf48amkdXSbVf2Ry01";

export const createCheckoutSession = createServerFn({ method: "POST" })
  .validator((d: { includeShadow: boolean; customerEmail?: string }) => d)
  .handler(async ({ data }) => {
    // Use pre-created Stripe payment links (platform-managed Stripe, no secret key available)
    const url = data.includeShadow ? PAYMENT_LINK_COMBO : PAYMENT_LINK_BASE;

    return {
      url,
      sessionId: "pay_link",
    };
  });

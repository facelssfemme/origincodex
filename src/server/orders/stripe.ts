import Stripe from "stripe";
import { createHash } from "node:crypto";
import { paymentConfig, required, assertLiveCheckoutReady } from "./config.ts";
import type { Order, Session } from "./domain.ts";
export function stripeGateway(
  config = paymentConfig(),
  stripe = new Stripe(config.key, { maxNetworkRetries: 2, timeout: 15000 }),
) {
  async function verifyAccount() {
    const account = await stripe.accounts.retrieveCurrent();
    if (account.id !== config.accountId) throw Error("Stripe account mismatch");
  }
  return {
    config,
    environment: config.environment,
    async create(order: Order) {
      if (config.environment === "live") assertLiveCheckoutReady();
      await verifyAccount();
      if (
        order.environment !== config.environment ||
        order.stripeAccountId !== config.accountId
      )
        throw Error("Order environment mismatch");
      for (let i = 0; i < order.priceIds.length; i++) {
        const price = await stripe.prices.retrieve(order.priceIds[i]);
        if (
          price.livemode !== (config.environment === "live") ||
          price.metadata?.brand !== "syrena" ||
          price.metadata?.offer !==
            (i === 0 ? "origin-reading" : "shadow-origin") ||
          !price.active ||
          price.currency !== "usd" ||
          price.recurring ||
          price.unit_amount !== (i === 0 ? 1900 : 1200)
        )
          throw Error("Price mismatch");
      }
      const suffix = [
        ...createHash("sha256").update(order.id).digest().subarray(0, 8),
      ]
        .map((n) => String.fromCharCode(97 + (n % 26)))
        .join("");
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: order.id,
          metadata: {
            order_id: order.id,
            brand: "syrena",
            environment: config.environment,
          },
          payment_intent_data: {
            metadata: {
              order_id: order.id,
              brand: "syrena",
              environment: config.environment,
            },
          },
          integration_identifier: `syrena-${config.environment}-${suffix}`,
          line_items: order.priceIds.map((price) => ({ price, quantity: 1 })),
          success_url: `${config.origin}/thank-you?order=${order.id}`,
          cancel_url: `${config.origin}/quiz?checkout=cancelled`,
        },
        { idempotencyKey: `syrena-checkout/${order.id}/v1` },
      );
      if (session.livemode !== (config.environment === "live") || !session.url)
        throw Error("Checkout unavailable");
      return { id: session.id, url: session.url };
    },
    verify(raw: string, signature: string) {
      const event = stripe.webhooks.constructEvent(
        raw,
        signature,
        required("STRIPE_WEBHOOK_SECRET"),
      );
      const object = event.data.object;
      return {
        type: event.type,
        livemode: event.livemode,
        data: {
          object: {
            id:
              "id" in object && typeof object.id === "string" ? object.id : "",
          },
        },
      };
    },
    async retrieve(id: string) {
      await verifyAccount();
      const session = await stripe.checkout.sessions.retrieve(id, {
        expand: ["line_items"],
      });
      if (session.livemode !== (config.environment === "live"))
        throw Error("Session mode mismatch");
      return {
        ...session,
        stripeAccountId: config.accountId,
      } as unknown as Session;
    },
  };
}

import {
  assertAccess,
  hashToken,
  validateSnapshot,
  credentials,
  type Order,
} from "./domain.ts";
import type { Store } from "./service.ts";
export interface CheckoutGateway {
  create(order: Order): Promise<{ id: string; url: string }>;
}
export async function checkout(
  store: Store,
  gateway: CheckoutGateway,
  input: unknown,
  config: {
    basePrice: string;
    shadowPrice: string;
    accessSecret: string;
    environment: "test" | "live";
    accountId: string;
  },
  now = Date.now(),
) {
  const access = credentials(input);
  const snapshot = validateSnapshot(input);
  const candidate: Order = {
    environment: config.environment,
    stripeAccountId: config.accountId,
    id: access.orderId,
    accessHash: hashToken(access.accessToken),
    snapshot,
    createdAt: now,
    priceIds: snapshot.includeShadow
      ? [config.basePrice, config.shadowPrice]
      : [config.basePrice],
    amount: snapshot.includeShadow ? 3100 : 1900,
    currency: "usd",
    paid: false,
    stage: "pending",
  };
  await store.insert(candidate);
  const order = await store.get(access.orderId);
  if (!order) throw Error("Order unavailable");
  if (
    order.environment !== config.environment ||
    order.stripeAccountId !== config.accountId
  )
    throw Error("Order environment mismatch");
  // Creation/retry requires the original browser capability, not a fulfillment link.
  if (order.accessHash !== hashToken(access.accessToken))
    throw Error("Order unavailable");
  assertAccess(order, access.accessToken, config.accessSecret);
  if (
    JSON.stringify(validateSnapshot(order.snapshot)) !==
    JSON.stringify(snapshot)
  )
    throw Error("Quiz changed; start a separate checkout attempt");
  if (order.sessionId && order.checkoutUrl)
    return { url: order.checkoutUrl, orderId: order.id };
  // Do not reuse Stripe's creation key outside its retention window.
  if (now - order.createdAt > 20 * 60 * 60 * 1000)
    throw Error("Checkout attempt needs review");
  const session = await gateway.create(order);
  await store.attachSession(order.id, session.id, session.url);
  return { url: session.url, orderId: order.id };
}

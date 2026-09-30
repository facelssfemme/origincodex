import { assertAccess, credentials } from "./domain.ts";
import type { Store } from "./service.ts";
export async function getOrder(store: Store, input: unknown, secret: string) {
  const c = credentials(input);
  const order = await store.get(c.orderId);
  if (!order) throw Error("Order unavailable");
  assertAccess(order, c.accessToken, secret);
  return order;
}
export async function readingStatus(
  store: Store,
  input: unknown,
  secret: string,
) {
  const o = await getOrder(store, input, secret);
  return {
    orderId: o.id,
    paid: o.paid,
    stage: o.stage,
    name: o.snapshot.answers.name,
    archetype: o.snapshot.result.primaryArchetype,
    reading: o.paid ? (o.reading ?? null) : null,
    audioReady: o.paid && Boolean(o.audioBase64),
    emailAccepted: o.paid && Boolean(o.emailId),
    emailDelivered: Boolean(
      o.paid &&
      o.emailId &&
      store.deliveryConfirmed &&
      (await store.deliveryConfirmed(o.emailId)),
    ),
  };
}

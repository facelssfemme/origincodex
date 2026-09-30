import { randomUUID } from "node:crypto";
import {
  assertPaidSession,
  emailFor,
  validateReading,
  type Order,
  type Session,
  type Reading,
  type EmailPayload,
} from "./domain.ts";
export interface Store {
  deliveryConfirmed?(emailId: string): Promise<boolean>;
  get(id: string): Promise<Order | null>;
  insert(order: Order): Promise<void>;
  attachSession(id: string, sessionId: string, url: string): Promise<void>;
  markPaid(id: string, email: string): Promise<void>;
  claim(id: string, lease: string): Promise<Order | null>;
  patch(id: string, lease: string, patch: Partial<Order>): Promise<void>;
  release(id: string, lease: string): Promise<void>;
}
export interface Providers {
  preflight(order: Order): { modelId: string; voiceId: string };
  text(order: Order): Promise<Reading>;
  audio(order: Order): Promise<string>;
  email(payload: EmailPayload, key: string): Promise<string>;
}
// Called only after signature verification + fresh retrieval from Stripe.
export async function confirmPayment(store: Store, session: Session) {
  const id = session.metadata?.order_id;
  if (!id) throw Error("Missing order reference");
  const order = await store.get(id);
  if (!order) throw Error("Unknown order");
  const email = assertPaidSession(order, session);
  await store.markPaid(order.id, email);
}
// All stages belong to an atomically claimed paid order, never a browser payload.
// A lost lease/crash stays locked for operator reconciliation: no silent re-spend.
export async function fulfill(
  store: Store,
  providers: Providers,
  id: string,
  origin: string,
  secret: string,
  now = Date.now(),
) {
  const lease = randomUUID();
  let order = await store.claim(id, lease);
  if (!order) return "not_claimed";
  let sideEffect: "text" | "audio" | "email" | null = null;
  const save = async (p: Partial<Order>) => {
    await store.patch(id, lease, p);
    order = { ...order!, ...p };
  };
  try {
    if (!order.paid || !order.paymentEmail) throw Error("Payment required");
    const identity = providers.preflight(order);
    if (
      order.providerIdentity &&
      (order.providerIdentity.modelId !== identity.modelId ||
        order.providerIdentity.voiceId !== identity.voiceId)
    )
      throw Error("Provider identity changed");
    if (!order.providerIdentity) await save({ providerIdentity: identity });
    if (!order.reading) {
      await save({ stage: "text_started" });
      sideEffect = "text";
      const reading = validateReading(
        await providers.text(order),
        order.snapshot.includeShadow,
      );
      await save({ reading, stage: "text_ready", lastError: "" });
      sideEffect = null;
    }
    if (!order.audioBase64) {
      await save({ stage: "audio_started" });
      sideEffect = "audio";
      const audioBase64 = await providers.audio(order);
      if (!audioBase64 || audioBase64.length > 11_000_000)
        throw Error("Invalid audio");
      await save({ audioBase64, stage: "audio_ready", lastError: "" });
      sideEffect = null;
    }
    if (!order.emailPayload)
      await save({
        emailPayload: emailFor(order, origin, secret),
        emailFirstAttempt: now,
        stage: "email_ready",
      });
    if (!order.emailId) {
      if (
        !order.emailFirstAttempt ||
        now - order.emailFirstAttempt >= 23 * 60 * 60 * 1000
      ) {
        await save({
          stage: "review",
          lastError: "email_idempotency_window_expired",
        });
        return "review";
      }
      sideEffect = "email";
      const emailId = await providers.email(
        order.emailPayload!,
        `syrena-reading/${id}/v1`,
      );
      if (!emailId) throw Error("Email not accepted");
      await save({ emailId, stage: "complete", lastError: "" });
      sideEffect = null;
    }
    return "complete";
  } catch {
    // No provider exception text enters customer responses or logs.
    await save({
      stage:
        sideEffect === "text" || sideEffect === "audio"
          ? "review"
          : order.stage,
      lastError: sideEffect
        ? `${sideEffect}_outcome_uncertain`
        : "configuration_or_storage_unavailable",
    });
    return "pending_or_review";
  } finally {
    await store.release(id, lease);
  }
}

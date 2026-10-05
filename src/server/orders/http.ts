import { confirmPayment, fulfill } from "./service.ts";
import { getOrder } from "./access.ts";
import { timingSafeEqual } from "node:crypto";
import type { Store, Providers } from "./service.ts";
import type { Session } from "./domain.ts";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export async function webhook(
  request: Request,
  repo: Store,
  gateway: {
    environment: "test" | "live";
    verify(
      raw: string,
      signature: string,
    ): { type: string; livemode: boolean; data: { object: { id: string } } };
    retrieve(id: string): Promise<Session>;
  },
) {
  let event;
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000)
      return new Response("Too large", { status: 413 });
    event = gateway.verify(raw, request.headers.get("stripe-signature") || "");
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (
    !["test", "live"].includes(gateway.environment) ||
    event.livemode !== (gateway.environment === "live")
  )
    return new Response("Event mode mismatch", { status: 400 });
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ].includes(event.type)
  )
    return new Response("Ignored");
  try {
    const session = await gateway.retrieve(event.data.object.id);
    // Failed/unpaid events never grant access; a later paid event can queue fulfillment.
    if (session.payment_status !== "paid")
      return new Response("Awaiting payment");
    await confirmPayment(repo, session);
    return new Response("Queued");
  } catch {
    return new Response("Payment reconciliation pending", { status: 503 });
  }
}
export async function worker(
  request: Request,
  repo: Store & { next(): Promise<string | null> },
  p: Providers,
  config: { workerSecret: string; origin: string; accessSecret: string },
) {
  const actual = request.headers.get("authorization") || "";
  const expected = `Bearer ${config.workerSecret}`;
  if (
    config.workerSecret.length < 32 ||
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    const id = await repo.next();
    if (!id) return Response.json({ state: "idle" }, { headers });
    return Response.json(
      { state: await fulfill(repo, p, id, config.origin, config.accessSecret) },
      { headers },
    );
  } catch {
    return new Response("Worker unavailable", { status: 503, headers });
  }
}
export async function audio(request: Request, repo: Store, secret: string) {
  try {
    const o = await getOrder(repo, await request.json(), secret);
    if (!o.paid || !o.audioBase64)
      return new Response("Audio unavailable", { status: 404, headers });
    return new Response(Buffer.from(o.audioBase64, "base64"), {
      headers: { ...headers, "Content-Type": "audio/mpeg" },
    });
  } catch {
    return new Response("Audio unavailable", { status: 404, headers });
  }
}

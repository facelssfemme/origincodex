import { Resend } from "resend";
import type { Query } from "./orders/store.ts";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function deliveryReceipt(
  request: Request,
  query: Query,
  secret: string,
) {
  if (!secret)
    return new Response("Delivery verification unavailable", { status: 503 });
  let event;
  try {
    const payload = await request.text();
    if (payload.length > 1000000)
      return new Response("Too large", { status: 413 });
    event = new Resend("verification-only-no-network").webhooks.verify({
      payload,
      webhookSecret: secret,
      headers: {
        id: request.headers.get("svix-id") || "",
        timestamp: request.headers.get("svix-timestamp") || "",
        signature: request.headers.get("svix-signature") || "",
      },
    });
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (event.type !== "email.delivered") return new Response("Ignored");
  if (
    !uuidPattern.test(event.data.email_id) ||
    !Number.isFinite(Date.parse(event.created_at))
  )
    return new Response("Invalid event", { status: 400 });
  try {
    await query(
      `INSERT INTO syrena_email_delivery(email_id,delivered_at) VALUES($1,$2::timestamptz) ON CONFLICT(email_id) DO NOTHING`,
      [event.data.email_id, event.created_at],
    );
    return new Response("Recorded");
  } catch {
    return new Response("Delivery recording unavailable", { status: 503 });
  }
}

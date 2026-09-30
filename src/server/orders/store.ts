import { sql } from "../../db.ts";
import type { Order } from "./domain.ts";
import type { Store } from "./service.ts";
export type Query = (
  query: string,
  params?: unknown[],
) => Promise<Record<string, unknown>[]>;
export function postgresStore(
  query: Query,
): Store & { next(): Promise<string | null> } {
  return {
    async deliveryConfirmed(emailId) {
      const rows = await query(
        "SELECT email_id FROM syrena_email_delivery WHERE email_id::text=$1",
        [emailId],
      );
      return rows.length > 0;
    },
    async get(id) {
      const r = await query("SELECT data FROM syrena_orders WHERE id=$1", [id]);
      return (r[0]?.data as Order) || null;
    },
    async insert(order) {
      await query(
        "INSERT INTO syrena_orders(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING",
        [order.id, JSON.stringify(order)],
      );
    },
    async attachSession(id, sessionId, url) {
      const r = await query(
        `UPDATE syrena_orders SET data=data||$2::jsonb WHERE id=$1 AND (stripe_session_id IS NULL OR stripe_session_id=$3) RETURNING id`,
        [id, JSON.stringify({ sessionId, checkoutUrl: url }), sessionId],
      );
      if (!r.length) throw Error("Session association conflict");
    },
    async markPaid(id, email) {
      await query(
        `UPDATE syrena_orders SET data=data||$2::jsonb WHERE id=$1 AND data->>'paid'='false'`,
        [
          id,
          JSON.stringify({ paid: true, paymentEmail: email, stage: "queued" }),
        ],
      );
    },
    async claim(id, lease) {
      const r = await query(
        `UPDATE syrena_orders SET lease=$2,locked_at=now() WHERE id=$1 AND lease IS NULL AND data->>'paid'='true' AND data->>'stage' IN ('queued','text_ready','audio_ready','email_ready') RETURNING data`,
        [id, lease],
      );
      return (r[0]?.data as Order) || null;
    },
    async patch(id, lease, patch) {
      const r = await query(
        "UPDATE syrena_orders SET data=data||$3::jsonb WHERE id=$1 AND lease=$2 RETURNING id",
        [id, lease, JSON.stringify(patch)],
      );
      if (!r.length) throw Error("Lost lease");
    },
    async release(id, lease) {
      await query(
        "UPDATE syrena_orders SET lease=NULL,locked_at=NULL WHERE id=$1 AND lease=$2",
        [id, lease],
      );
    },
    async next() {
      const r = await query(
        `SELECT id FROM syrena_orders WHERE lease IS NULL AND data->>'paid'='true' AND data->>'stage' IN ('queued','text_ready','audio_ready','email_ready') ORDER BY created_at LIMIT 1`,
      );
      return (r[0]?.id as string) || null;
    },
  };
}
export const store = () => postgresStore((q, p) => sql().query(q, p));

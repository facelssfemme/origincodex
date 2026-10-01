import { createServerFn } from "@tanstack/react-start";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Funnel analytics event ingestion.
 *
 * Client code (src/utils/analytics.ts) POSTs batches of tracked events here.
 * Events are appended as JSON lines to a file-based log (one JSON object per
 * line, append-only) — no database required. The log is read + aggregated by
 * src/server/analytics.ts for the /dashboard view.
 *
 * NOTE: this TanStack Start version has no REST API-route support, so this is a
 * server function (same-origin RPC POST) rather than a literal `/api/events`
 * route. It is functionally identical: accepts a JSON array of events, returns
 * a write receipt. Path is overridable via ANALYTICS_FILE (useful if the site
 * is ever hosted somewhere without /home/team/shared).
 */

export interface TrackedEvent {
  /** Event name, e.g. "quiz_start", "purchase". */
  name: string;
  /** ISO timestamp of when the event happened on the client. */
  timestamp: string;
  /** Anonymous per-tab session id (UUID from sessionStorage). */
  session_id: string;
  /** "mobile" | "desktop" | "tablet" — derived from the user agent. */
  device_type: string;
  /** "tiktok", "direct", "google", ... from UTM source or referrer. */
  traffic_source: string;
  /** Pathname of the page that fired the event, e.g. "/quiz". */
  page: string;
  /** Event-specific properties (flat JSON-serializable object). */
  props: Record<string, unknown>;
}

const DEFAULT_ANALYTICS_FILE = "/home/team/shared/analytics/events.jsonl";
const MAX_EVENTS_PER_BATCH = 100;
const MAX_EVENT_JSON_LENGTH = 16_000;

function getAnalyticsFile(): string {
  return process.env.ANALYTICS_FILE || DEFAULT_ANALYTICS_FILE;
}

async function appendEvents(events: TrackedEvent[]): Promise<void> {
  if (!events.length) return;
  const file = getAnalyticsFile();
  await mkdir(dirname(file), { recursive: true });
  const lines = events
    .map((e) => {
      const json = JSON.stringify(e);
      // Guard against pathological payloads blowing up the log.
      return json.length <= MAX_EVENT_JSON_LENGTH
        ? json + "\n"
        : JSON.stringify({ ...e, props: { truncated: true, name: e.name, timestamp: e.timestamp } }) + "\n";
    })
    .join("");
  await appendFile(file, lines, "utf8");
}

export const trackEvents = createServerFn({ method: "POST" })
  .validator((d: { events: TrackedEvent[] }) => d)
  .handler(async ({ data }) => {
    // Tolerate both `{ data: { events } }` (client RPC convention) and a raw
    // `{ events }` payload — never drop events over a shape mismatch.
    const raw =
      (data && Array.isArray((data as { events?: unknown }).events)
        ? (data as { events: unknown[] }).events
        : (data as { data?: { events?: unknown[] } } | undefined)?.data?.events) ?? [];
    const events = (raw as TrackedEvent[]).slice(0, MAX_EVENTS_PER_BATCH).filter(
      (e): e is TrackedEvent =>
        !!e && typeof e.name === "string" && e.name.length > 0 && e.name.length <= 64,
    );

    if (!events.length) {
      return { ok: true, written: 0 };
    }

    try {
      await appendEvents(events);
      return { ok: true, written: events.length };
    } catch (err) {
      // Never let a tracking failure break the user's page — log and return.
      console.error("[analytics] failed to write events:", err);
      return { ok: false, written: 0, error: (err as Error).message };
    }
  });

// ─── Server-verified purchase events ─────────────────────────────────────────
//
// A `purchase` event is only ever written from the server, after Stripe has
// confirmed the payment (see verifyCheckoutSession in ~/utils/stripe-checkout).
// The client can no longer mint a purchase, so the dashboard's revenue figure
// is trustworthy: `props.verified === true` means "Stripe says this was paid".
//
// This lives behind a server function (like every other writer of the log) so
// that the node-only imports above never reach the browser bundle.

export interface VerifiedPurchaseContext {
  /** Anonymous analytics session id from the buyer's tab (attribution only). */
  analyticsSessionId?: string;
  deviceType?: string;
  trafficSource?: string;
  /** Client-attested paywall metrics — never used for revenue math. */
  paywallDurationSec?: number;
  scrollDepthPct?: number | null;
}

export interface VerifiedPurchaseInput {
  /** Stripe Checkout Session id (`cs_…`) — the idempotency key for this event. */
  stripeSessionId: string;
  /** Amount actually charged, in cents (from the Stripe session). */
  amountCents: number;
  currency: string;
  /** Whether the Shadow Origin order bump was part of the paid order. */
  includeShadow: boolean;
  paymentIntentId?: string;
  /** Buyer email captured by Stripe, if any. */
  email?: string;
  context?: VerifiedPurchaseContext;
}

/**
 * Append a server-verified `purchase` event. Returns false if the write failed —
 * the caller must not treat that as a payment failure.
 *
 * Duplicate Stripe sessions (e.g. reloading /thank-you) are collapsed at
 * aggregation time in src/server/analytics.ts, which counts unique
 * `stripe_session_id` values.
 */
export const recordVerifiedPurchase = createServerFn({ method: "POST" })
  .validator((d: VerifiedPurchaseInput) => d)
  .handler(async ({ data }): Promise<boolean> => {
    try {
      const ctx = data.context ?? {};
      const event: TrackedEvent = {
        name: "purchase",
        timestamp: new Date().toISOString(),
        // Prefer the buyer's tab session id so the purchase joins the rest of
        // that session's funnel; fall back to a deterministic id.
        session_id: ctx.analyticsSessionId?.trim() || `stripe:${data.stripeSessionId}`,
        device_type: ctx.deviceType || "unknown",
        traffic_source: ctx.trafficSource || "unknown",
        page: "/thank-you",
        props: {
          upsell_taken: data.includeShadow,
          amount: Math.round(data.amountCents) / 100,
          currency: data.currency,
          verified: true,
          verification: "stripe_checkout_session",
          stripe_session_id: data.stripeSessionId,
          payment_intent_id: data.paymentIntentId ?? null,
          has_customer_email: Boolean(data.email),
          paywall_duration_seconds:
            typeof ctx.paywallDurationSec === "number" ? ctx.paywallDurationSec : null,
          scroll_depth_pct: typeof ctx.scrollDepthPct === "number" ? ctx.scrollDepthPct : null,
        },
      };

      await appendEvents([event]);
      return true;
    } catch (err) {
      console.error("[analytics] failed to record verified purchase:", err);
      return false;
    }
  });


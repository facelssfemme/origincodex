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

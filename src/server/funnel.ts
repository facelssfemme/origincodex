import type { Query } from "./orders/store.ts";
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const names = [
  "landing_view",
  "quiz_start",
  "quiz_question_complete",
  "quiz_complete",
  "paywall_view",
  "checkout_redirect_requested",
  "paywall_exit",
  "checkout_return",
];
export function sanitizeEvent(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  if (
    typeof e.event_id !== "string" ||
    !uuidPattern.test(e.event_id) ||
    typeof e.session_id !== "string" ||
    !uuidPattern.test(e.session_id) ||
    !names.includes(String(e.name))
  )
    return null;
  const props =
    e.props && typeof e.props === "object"
      ? (e.props as Record<string, unknown>)
      : {};
  const question =
    e.name === "quiz_question_complete" ? props.question_number : null;
  if (
    e.name === "quiz_question_complete" &&
    (!Number.isInteger(question) ||
      Number(question) < 1 ||
      Number(question) > 9)
  )
    return null;
  return {
    id: e.event_id,
    session: e.session_id,
    name: String(e.name),
    question,
    device: ["desktop", "mobile", "tablet"].includes(String(e.device_type))
      ? String(e.device_type)
      : "unknown",
    source: [
      "direct",
      "tiktok",
      "instagram",
      "facebook",
      "google",
      "social",
    ].includes(String(e.traffic_source))
      ? String(e.traffic_source)
      : "other",
  };
}
export async function ingest(
  query: Query,
  input: unknown,
  environment: string,
) {
  // Production analytics requires separate explicit enablement; checkout currently supports test only.
  if (!["test", "live"].includes(environment))
    throw Error("Analytics disabled");
  if (
    !Array.isArray(input) ||
    input.length > 20 ||
    JSON.stringify(input).length > 12000
  )
    throw Error("Invalid batch");
  const events = input.map(sanitizeEvent).filter((e) => e !== null);
  let written = 0;
  for (const e of events) {
    const rows = await query(
      `INSERT INTO syrena_funnel_events(event_id,session_id,environment,name,question,device,source) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
      [e.id, e.session, environment, e.name, e.question, e.device, e.source],
    );
    written += rows.length;
  }
  return written;
}
export function reportRange(from: string, to: string) {
  for (const date of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw Error("Invalid UTC date");
  const start = new Date(from).toISOString(),
    end = new Date(Date.parse(to) + 86400000).toISOString();
  if (start >= end || Date.parse(end) - Date.parse(start) > 366 * 86400000)
    throw Error("Invalid range");
  return { start, end };
}
export async function report(
  query: Query,
  from: string,
  to: string,
  environment: string,
) {
  if (!["test", "live"].includes(environment))
    throw Error("Invalid environment");
  const range = reportRange(from, to);
  const browser = await query(
    `SELECT name,question,count(DISTINCT session_id)::int AS sessions FROM syrena_funnel_events WHERE environment=$1 AND received_at >= $2::timestamptz AND received_at < $3::timestamptz GROUP BY name,question ORDER BY name,question`,
    [environment, range.start, range.end],
  );
  const orders = await query(
    `SELECT count(*) FILTER(WHERE data->>'sessionId' IS NOT NULL)::int AS checkout_created,
    count(*) FILTER(WHERE data->>'paid'='true')::int AS paid,
    count(*) FILTER(WHERE data->>'paid'='true' AND data->'reading' IS NOT NULL AND data->>'audioBase64' IS NOT NULL)::int AS artifacts_ready,
    count(*) FILTER(WHERE data->>'paid'='true' AND data->>'emailId' IS NOT NULL)::int AS email_accepted,
    count(*) FILTER(WHERE data->>'paid'='true' AND d.email_id IS NOT NULL)::int AS email_delivered,
    COALESCE(sum((data->>'amount')::int) FILTER(WHERE data->>'paid'='true'),0)::bigint AS paid_gross_cents
    FROM syrena_orders o LEFT JOIN syrena_email_delivery d ON d.email_id::text=o.data->>'emailId'
    WHERE o.data->>'environment'=$1 AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz`,
    [environment, range.start, range.end],
  );
  return {
    environment,
    range,
    browser: browser.map((r) => ({
      name: String(r.name),
      question: r.question === null ? null : Number(r.question),
      sessions: Number(r.sessions),
    })),
    orders: Object.fromEntries(
      Object.entries(orders[0]).map(([k, v]) => [k, Number(v)]),
    ) as Record<string, number>,
    definitions:
      "Browser counts are distinct per-tab sessions observed within the UTC range, per stage/question; untrusted and best-effort, not people or an ordered conversion cohort. Order counts are current states for orders created within that range. Paid gross is confirmed charge amount before refunds/fees, not net revenue. Email delivered means signed provider delivery receipt, not read or inbox placement. Missing receipt means unknown. Legacy orders without environment are excluded.",
  };
}

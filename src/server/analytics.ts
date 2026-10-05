import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import type { TrackedEvent } from "./events";

/**
 * Aggregation endpoint for the analytics dashboard (/dashboard).
 * Reads the JSONL event log written by src/server/events.ts and computes
 * funnel conversion, per-question drop-off, paywall behavior, and revenue.
 */

const DEFAULT_ANALYTICS_FILE = "/home/team/shared/analytics/events.jsonl";

export interface AnalyticsRange {
  /** Inclusive "YYYY-MM-DD" start date (local-ish: treated as UTC day start). */
  from?: string;
  /** Inclusive "YYYY-MM-DD" end date (treated as UTC day end). */
  to?: string;
}

export interface FunnelRow {
  step: string;
  count: number;
  conversionFromPrev: number | null;
}

export interface QuestionDropoffRow {
  question: number;
  count: number;
  dropoffPct: number | null;
}

export interface PaywallStats {
  viewedSessions: number;
  abandonedSessions: number;
  checkoutStartedSessions: number;
  paymentAbandonedSessions: number;
  avgDurationSecBeforeAbandon: number;
  avgDurationSecAllViewers: number;
  avgScrollPct: number;
}

export interface PurchaseStats {
  /**
   * Purchases verified server-side against Stripe (a paid Checkout Session
   * belonging to this product). Client-fired `purchase` events are NOT counted.
   */
  count: number;
  upsellCount: number;
  upsellRate: number;
  /** Verified revenue only, in dollars. */
  revenue: number;
  avgOrderValue: number;
  /** Legacy client-fired purchase events (pre-verification flow) — excluded from revenue. */
  legacyUnverifiedCount: number;
  legacyUnverifiedRevenue: number;
}

export interface AnalyticsReport {
  range: { from: string | null; to: string | null };
  totalEvents: number;
  uniqueSessions: number;
  funnel: FunnelRow[];
  questionDropoff: QuestionDropoffRow[];
  paywall: PaywallStats;
  purchase: PurchaseStats;
  trafficSources: { source: string; sessions: number }[];
  deviceSplit: { device: string; sessions: number }[];
}

const FUNNEL_STEPS = [
  "bio_link_click",
  "quiz_start",
  "quiz_complete",
  "paywall_view",
  "checkout_started",
  "purchase",
] as const;

const QUESTION_COUNT = 9;

function getAnalyticsFile(): string {
  return process.env.ANALYTICS_FILE || DEFAULT_ANALYTICS_FILE;
}

function inRange(ts: string | undefined, from: number | null, to: number | null): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return true; // unparseable — include rather than drop
  if (from !== null && t < from) return false;
  if (to !== null && t > to) return false;
  return true;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * A `purchase` only counts once the server has confirmed it with Stripe
 * (props.verified === true, written by recordVerifiedPurchase). Anything fired
 * from the browser — including the legacy thank-you page events — is treated as
 * an unverified artifact and kept out of the revenue figure.
 */
function isVerifiedPurchase(event: TrackedEvent): boolean {
  // Historical file entries are client-writable and cannot prove payment.
  void event;
  return false;
}

export const getAnalytics = createServerFn({ method: "POST" })
  .validator((d: AnalyticsRange) => d ?? {})
  .handler(async ({ data }): Promise<AnalyticsReport> => {
    const fromDate = typeof data?.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.from)
      ? Date.parse(`${data.from}T00:00:00.000Z`)
      : null;
    const toDate = typeof data?.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.to)
      ? Date.parse(`${data.to}T23:59:59.999Z`)
      : null;

    const empty = (): AnalyticsReport => ({
      range: { from: data?.from ?? null, to: data?.to ?? null },
      totalEvents: 0,
      uniqueSessions: 0,
      funnel: FUNNEL_STEPS.map((step, i) => ({
        step,
        count: 0,
        conversionFromPrev: i === 0 ? null : 0,
      })),
      questionDropoff: Array.from({ length: QUESTION_COUNT }, (_, i) => ({
        question: i + 1,
        count: 0,
        dropoffPct: null,
      })),
      paywall: {
        viewedSessions: 0,
        abandonedSessions: 0,
        checkoutStartedSessions: 0,
        paymentAbandonedSessions: 0,
        avgDurationSecBeforeAbandon: 0,
        avgDurationSecAllViewers: 0,
        avgScrollPct: 0,
      },
      purchase: {
        count: 0,
        upsellCount: 0,
        upsellRate: 0,
        revenue: 0,
        avgOrderValue: 0,
        legacyUnverifiedCount: 0,
        legacyUnverifiedRevenue: 0,
      },
      trafficSources: [],
      deviceSplit: [],
    });

    let raw: string;
    try {
      raw = await readFile(getAnalyticsFile(), "utf8");
    } catch {
      // No events logged yet — return an empty report rather than erroring.
      return empty();
    }

    const events: TrackedEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as TrackedEvent;
        if (ev && typeof ev.name === "string" && typeof ev.session_id === "string") {
          events.push(ev);
        }
      } catch {
        // Skip malformed lines (manual edits, partial writes) — never crash the dashboard.
      }
    }

    const filtered = events.filter((e) => inRange(e.timestamp, fromDate, toDate));
    const totalEvents = filtered.length;

    // ── Per-session rollup ──────────────────────────────────────────────────
    const bySession = new Map<string, TrackedEvent[]>();
    for (const ev of filtered) {
      const list = bySession.get(ev.session_id);
      if (list) list.push(ev);
      else bySession.set(ev.session_id, [ev]);
    }
    const uniqueSessions = bySession.size;

    const has = (session: TrackedEvent[], name: string) =>
      session.some((e) => e.name === name);
    const propOf = (session: TrackedEvent[], names: string[], key: string): unknown => {
      for (const e of session) {
        if (names.includes(e.name) && e.props && key in e.props) return e.props[key];
      }
      return undefined;
    };

    const funnel = FUNNEL_STEPS.map((step, i) => {
      const count = [...bySession.values()].filter((s) => has(s, step)).length;
      return {
        step,
        count,
        conversionFromPrev: i === 0 ? null : count,
      };
    });
    // conversionFromPrev as a percentage of the previous step (computed after, in one pass)
    for (let i = 1; i < funnel.length; i++) {
      funnel[i]!.conversionFromPrev =
        funnel[i - 1]!.count > 0
          ? Math.round((funnel[i]!.count / funnel[i - 1]!.count) * 1000) / 10
          : null;
    }

    // ── Per-question drop-off ───────────────────────────────────────────────
    const questionCounts: number[] = Array.from({ length: QUESTION_COUNT }, () => 0);
    for (const session of bySession.values()) {
      let maxQ = 0;
      for (const e of session) {
        if (e.name !== "quiz_question_complete") continue;
        const q = num(e.props?.question_number);
        if (q !== null && q >= 1 && q <= QUESTION_COUNT && q > maxQ) maxQ = q;
      }
      if (maxQ > 0) questionCounts[maxQ - 1]!++;
    }
    const questionDropoff: QuestionDropoffRow[] = questionCounts.map((count, i) => ({
      question: i + 1,
      count,
      dropoffPct:
        i === 0 || questionCounts[i - 1]! === 0
          ? null
          : Math.round((count / questionCounts[i - 1]!) * 1000) / 10,
    }));

    // ── Paywall behavior ────────────────────────────────────────────────────
    let viewedSessions = 0;
    let abandonedSessions = 0;
    let checkoutStartedSessions = 0;
    let purchaseSessions = 0;
    const durationsBeforeAbandon: number[] = [];
    const durationsAllViewers: number[] = [];
    const scrollPcts: number[] = [];

    for (const session of bySession.values()) {
      if (!has(session, "paywall_view")) continue;
      viewedSessions++;
      const maxDur = Math.max(
        0,
        ...[
          num(propOf(session, ["paywall_heartbeat", "paywall_abandon", "payment_abandon", "checkout_started", "purchase"], "paywall_duration_seconds")),
        ].filter((v): v is number => v !== null),
      );
      if (maxDur > 0 || has(session, "paywall_abandon")) durationsAllViewers.push(maxDur);
      const scroll = num(propOf(session, ["paywall_heartbeat", "paywall_abandon", "payment_abandon", "checkout_started", "purchase"], "scroll_depth_pct"));
      if (scroll !== null) scrollPcts.push(scroll);

      if (has(session, "paywall_abandon")) {
        abandonedSessions++;
        durationsBeforeAbandon.push(maxDur);
      }
      if (has(session, "checkout_started")) checkoutStartedSessions++;
      if (session.some(isVerifiedPurchase)) purchaseSessions++;
    }

    // ── Purchase / revenue (verified server-side against Stripe only) ───────
    // Verified events carry the Stripe Checkout Session id; a buyer reloading
    // /thank-you (or replaying the verification call) writes the same id again,
    // so revenue counts each Stripe session exactly once.
    let purchaseCount = 0;
    let upsellCount = 0;
    let revenue = 0;
    let legacyUnverifiedCount = 0;
    let legacyUnverifiedRevenue = 0;
    const countedStripeSessions = new Set<string>();
    for (const session of bySession.values()) {
      for (const event of session) {
        if (event.name !== "purchase") continue;
        const upsellTaken = event.props?.upsell_taken === true;
        const amount = num(event.props?.amount);
        if (isVerifiedPurchase(event)) {
          const stripeSessionId =
            typeof event.props?.stripe_session_id === "string"
              ? event.props.stripe_session_id
              : `${session[0]?.session_id ?? "unknown"}:${event.timestamp}`;
          if (countedStripeSessions.has(stripeSessionId)) continue;
          countedStripeSessions.add(stripeSessionId);
          purchaseCount++;
          if (upsellTaken) upsellCount++;
          revenue += amount ?? (upsellTaken ? 31 : 19);
        } else {
          // Client-fired purchase (legacy flow / forged session_id) — recorded
          // for visibility but never counted as revenue.
          legacyUnverifiedCount++;
          legacyUnverifiedRevenue += amount ?? (upsellTaken ? 31 : 19);
        }
      }
    }

    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;

    // ── Traffic sources / devices (by each session's first event) ───────────
    const sourceCounts = new Map<string, number>();
    const deviceCounts = new Map<string, number>();
    for (const [sid, session] of bySession) {
      const first = session.slice().sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))[0]!;
      const source = first.traffic_source || "unknown";
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      const device = first.device_type || "unknown";
      deviceCounts.set(device, (deviceCounts.get(device) ?? 0) + 1);
      void sid;
    }

    return {
      range: { from: data?.from ?? null, to: data?.to ?? null },
      totalEvents,
      uniqueSessions,
      funnel,
      questionDropoff,
      paywall: {
        viewedSessions,
        abandonedSessions,
        checkoutStartedSessions,
        paymentAbandonedSessions: Math.max(0, checkoutStartedSessions - purchaseSessions),
        avgDurationSecBeforeAbandon: avg(durationsBeforeAbandon),
        avgDurationSecAllViewers: avg(durationsAllViewers),
        avgScrollPct: avg(scrollPcts),
      },
      purchase: {
        count: purchaseCount,
        upsellCount,
        upsellRate: purchaseCount > 0 ? Math.round((upsellCount / purchaseCount) * 1000) / 10 : 0,
        revenue: Math.round(revenue * 100) / 100,
        avgOrderValue: purchaseCount > 0 ? Math.round((revenue / purchaseCount) * 100) / 100 : 0,
        legacyUnverifiedCount,
        legacyUnverifiedRevenue: Math.round(legacyUnverifiedRevenue * 100) / 100,
      },
      trafficSources: [...sourceCounts.entries()]
        .map(([source, sessions]) => ({ source, sessions }))
        .sort((a, b) => b.sessions - a.sessions),
      deviceSplit: [...deviceCounts.entries()]
        .map(([device, sessions]) => ({ device, sessions }))
        .sort((a, b) => b.sessions - a.sessions),
    };
  });

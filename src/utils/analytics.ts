import { trackEvents, type TrackedEvent } from "~/server/events";

/** Anonymous, best-effort observations. The server strips all non-allowlisted fields. */
const SESSION_KEY = "analytics_session_id";
const PAYWALL_KEY = "syrena_paywall_metrics";
const UNLOCK_KEY = "syrena_unlock_clicked";

const HEARTBEAT_MS = 15_000;
const FLUSH_DEBOUNCE_MS = 120;
const MAX_BATCH = 20;

let sessionIdCache: string | null = null;
let queue: TrackedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ─── Identity / context ──────────────────────────────────────────────────────

function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Anonymous session id — generated on first use, persisted in sessionStorage. */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  if (sessionIdCache) return sessionIdCache;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(SESSION_KEY);
  } catch {
    // sessionStorage unavailable (private mode edge cases) — fall through
  }
  if (!id) {
    id = uuid();
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      // ignore — id still works for this page lifetime
    }
  }
  sessionIdCache = id;
  return id;
}

export function getDeviceType(): "mobile" | "desktop" | "tablet" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/tablet|ipad|playbook|silk/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|opera mini|iemobile/i.test(ua)) return "mobile";
  return "desktop";
}

/** "tiktok" | "google" | "instagram" | hostname | "direct" — from UTM source or referrer. */
export function getTrafficSource(): string {
  if (typeof window === "undefined") return "direct";
  try {
    const params = new URLSearchParams(window.location.search);
    const utm = params.get("utm_source");
    if (utm && utm.trim())
      return ["tiktok", "instagram", "facebook", "google", "social"].includes(
        utm.trim().toLowerCase(),
      )
        ? utm.trim().toLowerCase()
        : "other";

    const referrer = document.referrer;
    if (!referrer) return "direct";
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    if (!host) return "direct";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("google.")) return "google";
    if (host.includes("instagram.com") || host.includes("facebook.com"))
      return "social";
    return "other";
  } catch {
    return "direct";
  }
}

// ─── Core tracking ───────────────────────────────────────────────────────────

/**
 * Fire a tracked event. Safe to call anywhere in client code; no-op during SSR.
 */
export function trackEvent(
  name: string,
  props: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  const aliases: Record<string, string> = {
    bio_link_click: "landing_view",
    checkout_started: "checkout_redirect_requested",
    paywall_abandon: "paywall_exit",
    payment_abandon: "checkout_return",
  };
  name = aliases[name] || name;
  if (
    ![
      "landing_view",
      "quiz_start",
      "quiz_question_complete",
      "quiz_complete",
      "paywall_view",
      "checkout_redirect_requested",
      "paywall_exit",
      "checkout_return",
    ].includes(name)
  )
    return;
  const ev: TrackedEvent = {
    event_id: uuid(),
    name,
    timestamp: new Date().toISOString(),
    session_id: getSessionId(),
    device_type: getDeviceType(),
    traffic_source: getTrafficSource(),
    page: "",
    props:
      name === "quiz_question_complete"
        ? { question_number: props.question_number }
        : {},
  };
  queue.push(ev);
  scheduleFlush(false);
}

function scheduleFlush(immediate: boolean): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (immediate) {
    flush();
    return;
  }
  flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

function flush(): void {
  flushTimer = null;
  if (!queue.length) return;
  const batch = queue.splice(0, MAX_BATCH);
  // Fire-and-forget; a dropped batch is acceptable (analytics is best-effort).
  void trackEvents({ data: { events: batch } }).catch(() => {});
  if (queue.length) scheduleFlush(false);
}

/**
 * Synchronously push any buffered events. Call from pagehide/beforeunload so
 * the pending batch is sent before the page goes away.
 */
export function flushEventsNow(): void {
  if (typeof window === "undefined") return;
  scheduleFlush(true);
}

// ─── Paywall instrumentation ─────────────────────────────────────────────────

interface PaywallMetrics {
  viewTs: number;
  maxScrollPct: number;
}

function readPaywallMetrics(): PaywallMetrics | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PAYWALL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PaywallMetrics>;
    if (typeof parsed.viewTs !== "number") return null;
    return {
      viewTs: parsed.viewTs,
      maxScrollPct:
        typeof parsed.maxScrollPct === "number" ? parsed.maxScrollPct : 0,
    };
  } catch {
    return null;
  }
}

function writePaywallMetrics(m: PaywallMetrics): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PAYWALL_KEY, JSON.stringify(m));
  } catch {
    // ignore
  }
}

function getScrollPct(): number {
  if (typeof window === "undefined") return 0;
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((window.scrollY / max) * 100)));
}

/** Seconds since the paywall was first shown for this session, or 0. */
export function getPaywallDurationSeconds(): number {
  const m = readPaywallMetrics();
  return m ? Math.max(0, Math.round((Date.now() - m.viewTs) / 1000)) : 0;
}

/** Track max scroll depth into the blurred reading (0-100). */
export function updatePaywallScroll(): void {
  const m = readPaywallMetrics();
  if (!m) return;
  m.maxScrollPct = Math.max(m.maxScrollPct, getScrollPct());
  writePaywallMetrics(m);
}

/**
 * Mark the paywall as viewed: records the view timestamp, starts the 15s
 * heartbeat (each beat re-reports paywall_duration_seconds + scroll depth so
 * duration survives any exit path), and returns the view time in ms.
 */
export function startPaywallTracking(): number | null {
  if (typeof window === "undefined") return null;
  let m = readPaywallMetrics();
  if (m) return m.viewTs; // already tracking — don't double-start
  m = { viewTs: Date.now(), maxScrollPct: getScrollPct() };
  writePaywallMetrics(m);

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    updatePaywallScroll();
    const mm = readPaywallMetrics();
    if (!mm) return;
    trackEvent("paywall_heartbeat", {
      paywall_duration_seconds: Math.max(
        0,
        Math.round((Date.now() - mm.viewTs) / 1000),
      ),
      scroll_depth_pct: mm.maxScrollPct,
    });
  }, HEARTBEAT_MS);

  return m.viewTs;
}

export function stopPaywallHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Call when the "Unlock" button is clicked (before the Stripe redirect).
 * Fires `checkout_started` and sets a flag so a later return without a
 * completed purchase can be counted as `payment_abandon`.
 */
export function markUnlockClicked(includeShadow: boolean): void {
  if (typeof window === "undefined") return;
  updatePaywallScroll();
  const m = readPaywallMetrics();
  try {
    sessionStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    // ignore
  }
  trackEvent("checkout_started", {
    paywall_duration_seconds: getPaywallDurationSeconds(),
    scroll_depth_pct: m?.maxScrollPct ?? null,
    upsell: includeShadow,
  });
}

/**
 * Fire `paywall_abandon` (paywall shown, left without paying) — wired to
 * pagehide/beforeunload on the quiz page. No-op if the paywall wasn't viewed
 * or the user clicked unlock (those become checkout_started/payment_abandon).
 */
export function trackPaywallExit(): void {
  if (typeof window === "undefined") return;
  const m = readPaywallMetrics();
  if (!m) return;
  let unlockClicked = false;
  try {
    unlockClicked = sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    // ignore
  }
  if (unlockClicked) return; // headed to Stripe, not an abandon
  stopPaywallHeartbeat();
  trackEvent("paywall_abandon", {
    paywall_duration_seconds: Math.max(
      0,
      Math.round((Date.now() - m.viewTs) / 1000),
    ),
    scroll_depth_pct: m.maxScrollPct,
  });
  try {
    sessionStorage.removeItem(PAYWALL_KEY);
  } catch {
    // ignore
  }
}

/**
 * Call on quiz page mount: if the user previously clicked unlock but never
 * reached a confirmed purchase (e.g. they backed out of Stripe and returned),
 * count it as `payment_abandon`. Clears the flag either way.
 */
export function detectPaymentAbandon(): void {
  if (typeof window === "undefined") return;
  let unlockClicked = false;
  try {
    unlockClicked = sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    // ignore
  }
  if (!unlockClicked) return;
  const m = readPaywallMetrics();
  stopPaywallHeartbeat();
  trackEvent("payment_abandon", {
    paywall_duration_seconds: m
      ? Math.max(0, Math.round((Date.now() - m.viewTs) / 1000))
      : null,
    scroll_depth_pct: m?.maxScrollPct ?? null,
  });
  try {
    sessionStorage.removeItem(PAYWALL_KEY);
  } catch {
    // ignore
  }
}

/**
 * Call once payment is confirmed (thank-you page): clears paywall/unlock state
 * so a later revisit isn't misread as an abandon. Returns the paywall metrics
 * (duration + scroll depth) so the purchase event can carry them.
 */
export function completePurchaseTracking(): {
  durationSec: number;
  scrollPct: number | null;
} {
  stopPaywallHeartbeat();
  const m = readPaywallMetrics();
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
    sessionStorage.removeItem(PAYWALL_KEY);
  } catch {
    // ignore
  }
  return {
    durationSec: m
      ? Math.max(0, Math.round((Date.now() - m.viewTs) / 1000))
      : 0,
    scrollPct: m ? m.maxScrollPct : null,
  };
}

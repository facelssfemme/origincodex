/**
 * Server-side Stripe configuration — the single source of truth for pricing
 * and redirect URLs. Nothing here is ever imported into client-rendered code
 * (only server-function handlers reference it), so no price ID or secret key
 * is shipped to the browser.
 *
 * Required environment variables / platform Secrets:
 *
 *   STRIPE_SECRET_KEY           sk_live_… or sk_test_…  (required to create or
 *                               verify a Checkout Session; checkout fails
 *                               closed without it)
 *   STRIPE_PRICE_BASE_READING   price_1TttZr…  $19.00  Starseed Origin Reading
 *   STRIPE_PRICE_SHADOW_ORIGIN  price_1Tttuz…  $12.00  Shadow Origin add-on
 *   STRIPE_PRICE_BUNDLE         price_1Tttyi…  $31.00  Reading + Shadow Origin
 *   SITE_URL                    e.g. https://syrenacodex.com — absolute base used
 *                               for Stripe success_url/cancel_url. Optional: if
 *                               unset we fall back to the request origin when it
 *                               is on an allowlisted domain (see below).
 *   STRIPE_WEBHOOK_SECRET       whsec_…  (optional — this flow does not need a
 *                               webhook; verification is a synchronous session
 *                               retrieve. Read only for diagnostics.)
 *
 * If a price ID is missing, the corresponding line item is created with an
 * inline `price_data` entry at the same amount, so the funnel still works with
 * only STRIPE_SECRET_KEY set. When the IDs ARE set they are used for the
 * session and server-side verification additionally asserts that every line
 * item matches the configured catalog.
 */

export type PlanKey = "base" | "shadow" | "bundle";

export interface CatalogEntry {
  key: PlanKey;
  /** Human-readable product name (used for inline price_data + Stripe descriptions). */
  label: string;
  /** Price in cents. Must match the Stripe catalog exactly. */
  amountCents: number;
  /** Environment variable holding the Stripe price ID for this entry. */
  envKey: string;
}

export const CATALOG: Record<PlanKey, CatalogEntry> = {
  base: {
    key: "base",
    label: "Starseed Origin Reading",
    amountCents: 1900,
    envKey: "STRIPE_PRICE_BASE_READING",
  },
  shadow: {
    key: "shadow",
    label: "Shadow Origin Reading (add-on)",
    amountCents: 1200,
    envKey: "STRIPE_PRICE_SHADOW_ORIGIN",
  },
  bundle: {
    key: "bundle",
    label: "Starseed Origin Reading + Shadow Origin",
    amountCents: 3100,
    envKey: "STRIPE_PRICE_BUNDLE",
  },
};

/** Marks a Checkout Session as ours; verification rejects sessions without it. */
export const APP_TAG = "origin-codex";

/** Only currency we accept. */
export const CURRENCY = "usd";

/** Price ID prefixes we consider valid (guards against typos in env). */
const PRICE_ID_PREFIX = "price_";

// ─── Secrets / catalog access ────────────────────────────────────────────────

export function getStripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key ? key : null;
}

export function getWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  return secret ? secret : null;
}

/** Configured Stripe price ID for a catalog entry, or null if unset/invalid. */
export function getPriceId(plan: PlanKey): string | null {
  const raw = process.env[CATALOG[plan].envKey]?.trim();
  return raw && raw.startsWith(PRICE_ID_PREFIX) ? raw : null;
}

/** All price IDs currently configured (empty array = inline price_data mode). */
export function configuredPriceIds(): string[] {
  return (Object.keys(CATALOG) as PlanKey[])
    .map((plan) => getPriceId(plan))
    .filter((id): id is string => id !== null);
}

export function isAllowedPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  return configuredPriceIds().includes(priceId);
}

/** Expected order total in cents for a purchase with/without the order bump. */
export function expectedAmountCents(includeShadow: boolean): number {
  return includeShadow ? CATALOG.bundle.amountCents : CATALOG.base.amountCents;
}

// ─── Absolute site URL (for Stripe success_url / cancel_url) ─────────────────

/**
 * Hosts we will build redirect URLs for when SITE_URL is not configured.
 * A client-supplied origin outside this list is ignored (never trusted).
 */
const ALLOWED_HOST_SUFFIXES = ["ctonew.app", "syrenacodex.com", "theorigincodex.com"];
const ALLOWED_HOSTS = ["localhost", "127.0.0.1"];

export function isAllowedSiteHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_HOSTS.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Absolute base URL for Stripe redirects.
 * Order: SITE_URL → allowlisted client origin → VERCEL_URL → localhost.
 */
export function resolveSiteUrl(clientOrigin?: string): string {
  const configured = (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//i.test(configured)) return configured;

  if (clientOrigin) {
    try {
      const url = new URL(clientOrigin);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        isAllowedSiteHost(url.hostname)
      ) {
        return url.origin;
      }
    } catch {
      // malformed origin — fall through
    }
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

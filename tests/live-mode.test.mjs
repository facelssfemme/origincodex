import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  paymentConfig,
  assertLiveCheckoutReady,
} from "../src/server/orders/config.ts";
import { stripeGateway } from "../src/server/orders/stripe.ts";
import { assertPaidSession, emailFor } from "../src/server/orders/domain.ts";
import { webhook } from "../src/server/orders/http.ts";
import { checkout } from "../src/server/orders/checkout.ts";
const account = "acct_1SrJtXK3yFNUEpTU";
const env = {
  SYRENA_PAYMENT_MODE: "live",
  SYRENA_LIVE_CHECKOUT_ENABLED: "approved-live",
  STRIPE_SECRET_KEY: "sk_live_FIXTURE_NOT_A_KEY",
  SYRENA_STRIPE_ACCOUNT_ID: account,
  SYRENA_APP_ORIGIN: "https://example.invalid",
  SYRENA_ORDER_ACCESS_SECRET: "fixture-secret-more-than-32-characters",
  DATABASE_URL: "fixture-no-network",
  STRIPE_BASE_PRICE_ID: "price_1ULQB8K3yFNUEpTUORrruI7w",
  STRIPE_SHADOW_PRICE_ID: "price_1ULQBOK3yFNUEpTUd79ONEgA",
  SYRENA_GENERATION_ENABLED: "approved-live",
  SYRENA_FULFILLMENT_READY: "approved-live",
  STRIPE_WEBHOOK_SECRET: "fixture",
  SYRENA_WORKER_SECRET: "fixture-worker-more-than-32-characters",
  ANTHROPIC_API_KEY: "fixture",
  SYRENA_READING_MODEL: "fixture",
  ELEVENLABS_API_KEY: "fixture",
  ELEVENLABS_VOICE_ID: "uG1JFy6xppqckhHCs2KG",
  SYRENA_VOICE_APPROVED: "true",
  RESEND_API_KEY: "fixture",
  RESEND_EMAIL_FROM: "fixture@example.invalid",
};
async function withEnv(fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}
const order = (shadow = false) => ({
  id: randomUUID(),
  environment: "live",
  stripeAccountId: account,
  sessionId: "cs_live_fixture",
  priceIds: shadow ? ["price_1ULQB8K3yFNUEpTUORrruI7w", "price_1ULQBOK3yFNUEpTUd79ONEgA"] : ["price_1ULQB8K3yFNUEpTUORrruI7w"],
  amount: shadow ? 3100 : 1900,
  currency: "usd",
  paid: false,
});
const session = (o) => ({
  id: o.sessionId,
  stripeAccountId: account,
  livemode: true,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  client_reference_id: o.id,
  metadata: { order_id: o.id, brand: "syrena", environment: "live" },
  amount_total: o.amount,
  currency: "usd",
  customer_details: { email: "fixture@example.invalid" },
  line_items: {
    has_more: false,
    data: o.priceIds.map((id) => ({ price: { id }, quantity: 1 })),
  },
});
test("configuration fails closed for disabled live, wrong key mode/account, insecure live origin and missing delivery readiness", () =>
  withEnv(async () => {
    assert.equal(paymentConfig().environment, "live");
    assertLiveCheckoutReady();
    for (const [key, value] of [
      ["SYRENA_PAYMENT_MODE", "bad"],
      ["STRIPE_SECRET_KEY", "sk_test_fixture"],
      ["SYRENA_STRIPE_ACCOUNT_ID", "acct_1TttI4DSBWwnXC8b"],
      ["SYRENA_APP_ORIGIN", "http://localhost"],
      ["STRIPE_BASE_PRICE_ID", "price_wrong"],
      ["STRIPE_SHADOW_PRICE_ID", "price_wrong"],
    ]) {
      process.env[key] = value;
      assert.throws(() => paymentConfig());
      process.env[key] = env[key];
    }
    for (const key of [
      "SYRENA_LIVE_CHECKOUT_ENABLED",
      "SYRENA_GENERATION_ENABLED",
      "SYRENA_FULFILLMENT_READY",
      "STRIPE_WEBHOOK_SECRET",
      "SYRENA_WORKER_SECRET",
      "ELEVENLABS_VOICE_ID",
    ]) {
      process.env[key] = "";
      assert.throws(() => assertLiveCheckoutReady());
      process.env[key] = env[key];
    }
    process.env.SYRENA_LIVE_CHECKOUT_ENABLED = "";
    assert.equal(paymentConfig().environment, "live"); // Existing webhook reconciliation remains possible.
    process.env.SYRENA_PAYMENT_MODE = "test";
    process.env.STRIPE_SECRET_KEY = "rk_test_fixture";
    assert.equal(paymentConfig().environment, "test");
    process.env.STRIPE_SECRET_KEY = "rk_live_fixture";
    assert.throws(() => paymentConfig());
  }));
test("live base/bundle creation validates account/prices/metadata and rejects same-priced wrong brands and test prices", () =>
  withEnv(async () => {
    for (const shadow of [false, true]) {
      const o = order(shadow),
        seen = [];
      let patch = {},
        actualAccount = account,
        returnedLive = true;
      const fake = {
        accounts: { retrieveCurrent: async () => ({ id: actualAccount }) },
        prices: {
          retrieve: async (id) => ({
            id,
            livemode: true,
            active: true,
            currency: "usd",
            unit_amount: id === "price_1ULQB8K3yFNUEpTUORrruI7w" ? 1900 : 1200,
            recurring: null,
            metadata: {
              brand: "syrena",
              offer: id === "price_1ULQB8K3yFNUEpTUORrruI7w" ? "origin-reading" : "shadow-origin",
            },
            ...patch,
          }),
        },
        checkout: {
          sessions: {
            create: async (p) => {
              seen.push(p);
              return {
                id: o.sessionId,
                url: "https://checkout.stripe.com/fixture",
                livemode: returnedLive,
              };
            },
            retrieve: async () => session(o),
          },
        },
      };
      const gateway = stripeGateway(paymentConfig(), fake);
      await gateway.create(o);
      assert.deepEqual(
        seen[0].line_items,
        o.priceIds.map((price) => ({ price, quantity: 1 })),
      );
      assert.equal(seen[0].metadata.environment, "live");
      assert.deepEqual(seen[0].metadata, seen[0].payment_intent_data.metadata);
      assert.equal(
        (await gateway.retrieve(o.sessionId)).stripeAccountId,
        account,
      );
      for (const bad of [
        { livemode: false },
        { metadata: { brand: "other", offer: "origin-reading" } },
        { metadata: { brand: "syrena", offer: "wrong" } },
        { currency: "eur" },
        { unit_amount: 1 },
        { active: false },
        { recurring: { interval: "month" } },
      ]) {
        patch = bad;
        await assert.rejects(gateway.create(o));
      }
      patch = {};
      assert.equal(seen.length, 1);
      actualAccount = "acct_wrong";
      await assert.rejects(gateway.create(o));
      await assert.rejects(gateway.retrieve(o.sessionId));
      actualAccount = account;
      await assert.rejects(gateway.create({ ...o, environment: "test" }));
      returnedLive = false;
      await assert.rejects(gateway.create(o));
    }
  }));
test("live paid reconciliation rejects account, mode, price, metadata, amount and order mismatch", () => {
  for (const shadow of [false, true]) {
    const o = order(shadow),
      s = session(o);
    assert.equal(assertPaidSession(o, s), "fixture@example.invalid");
    for (const bad of [
      { stripeAccountId: "acct_wrong" },
      { livemode: false },
      { payment_status: "unpaid" },
      { amount_total: 1 },
      { metadata: { ...s.metadata, brand: "other" } },
      { metadata: { ...s.metadata, environment: "test" } },
      { metadata: { ...s.metadata, order_id: randomUUID() } },
      {
        line_items: {
          has_more: false,
          data: [{ price: { id: "price_other" }, quantity: 1 }],
        },
      },
    ])
      assert.throws(() => assertPaidSession(o, { ...s, ...bad }));
  }
});
test("live webhook queues only verified matching live payment and rejects cross-mode events before retrieval", async () => {
  const o = order(true);
  let writes = 0,
    reads = 0;
  const repo = {
    get: async () => o,
    markPaid: async () => {
      writes++;
    },
  };
  let live = true;
  const gateway = {
    environment: "live",
    verify: () => ({
      type: "checkout.session.completed",
      livemode: live,
      data: { object: { id: o.sessionId } },
    }),
    retrieve: async () => {
      reads++;
      return session(o);
    },
  };
  const req = () =>
    new Request("http://localhost", { method: "POST", body: "fixture" });
  assert.equal((await webhook(req(), repo, gateway)).status, 200);
  assert.equal(writes, 1);
  live = false;
  assert.equal((await webhook(req(), repo, gateway)).status, 400);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});
test("mode change cannot reuse existing checkout; live emails do not claim fictional test profile", async () => {
  const token = "a".repeat(64),
    input = {
      orderId: randomUUID(),
      accessToken: token,
      answers: {
        name: "Fixture",
        birthMonth: 4,
        birthDay: 12,
        belonging: 0,
        intensity: 1,
        nightSky: 2,
        dreams: 1,
        recharge: 0,
        empathy: 1,
        soulAge: 2,
      },
      includeShadow: false,
    };
  let saved;
  const repo = {
    insert: async (o) => {
      saved ??= o;
    },
    get: async () => saved,
    attachSession: async (_id, id, url) => {
      saved.sessionId = id;
      saved.checkoutUrl = url;
    },
  };
  const config = {
    environment: "live",
    accountId: account,
    basePrice: "price_1ULQB8K3yFNUEpTUORrruI7w",
    shadowPrice: "price_1ULQBOK3yFNUEpTUd79ONEgA",
    accessSecret: env.SYRENA_ORDER_ACCESS_SECRET,
  };
  await checkout(
    repo,
    {
      create: async () => ({
        id: "cs_fixture",
        url: "https://example.invalid",
      }),
    },
    input,
    config,
  );
  await assert.rejects(
    checkout(repo, {}, input, { ...config, environment: "test" }),
  );
  const mail = emailFor(
    {
      ...saved,
      paid: true,
      paymentEmail: "fixture@example.invalid",
      reading: { primary: "Fixture reading", shadow: null },
      audioBase64: "fixture",
    },
    "https://example.invalid",
    config.accessSecret,
  );
  assert.equal(mail.subject, "Your Syrena reading");
  assert.doesNotMatch(mail.text, /fictional test profile/);
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import Stripe from "stripe";
import { postgresStore } from "../src/server/orders/store.ts";
import {
  validateSnapshot,
  hashToken,
  promptFor,
  answerKeys,
  answerLabels,
  assertPaidSession,
  emailFor,
  emailToken,
} from "../src/server/orders/domain.ts";
import { checkout } from "../src/server/orders/checkout.ts";
import { confirmPayment, fulfill } from "../src/server/orders/service.ts";
import { readingStatus } from "../src/server/orders/access.ts";
import { webhook, worker, audio } from "../src/server/orders/http.ts";
import { paymentConfig } from "../src/server/orders/config.ts";
import { stripeGateway } from "../src/server/orders/stripe.ts";
const secret = "unit-test-order-secret-only-32-characters";
const token = "a".repeat(64);
const answers = {
  name: "Test Rowan",
  birthMonth: 4,
  birthDay: 12,
  belonging: 0,
  intensity: 1,
  nightSky: 2,
  dreams: 1,
  recharge: 0,
  empathy: 1,
  soulAge: 2,
};
const config = {
  environment: "test",
  accountId: "acct_1SrJtXK3yFNUEpTU",
  basePrice: "price_fixture_base",
  shadowPrice: "price_fixture_shadow",
  accessSecret: secret,
};
let db, repo;
const setup = async () => {
  if (!db) {
    db = new PGlite();
    await db.exec(
      await readFile(
        new URL("../migrations/001_orders.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL("../migrations/002_email_delivery.sql", import.meta.url),
        "utf8",
      ),
    );
    repo = postgresStore(async (q, p) => (await db.query(q, p)).rows);
  }
  return repo;
};
async function order(shadow = false) {
  await setup();
  const o = {
    environment: "test",
    stripeAccountId: config.accountId,
    id: randomUUID(),
    accessHash: hashToken(token),
    snapshot: validateSnapshot({ answers, includeShadow: shadow }),
    createdAt: Date.now(),
    priceIds: shadow
      ? [config.basePrice, config.shadowPrice]
      : [config.basePrice],
    amount: shadow ? 3100 : 1900,
    currency: "usd",
    paid: false,
    stage: "pending",
  };
  await repo.insert(o);
  await repo.attachSession(
    o.id,
    `cs_test_${o.id}`,
    "https://checkout.stripe.com/test-fixture",
  );
  return await repo.get(o.id);
}
function session(o) {
  return {
    id: o.sessionId,
    stripeAccountId: config.accountId,
    livemode: false,
    mode: "payment",
    payment_status: "paid",
    status: "complete",
    client_reference_id: o.id,
    metadata: { order_id: o.id, brand: "syrena", environment: "test" },
    amount_total: o.amount,
    currency: o.currency,
    customer_details: { email: "fixture@example.invalid" },
    line_items: {
      has_more: false,
      data: o.priceIds.map((id) => ({ price: { id }, quantity: 1 })),
    },
  };
}
function providers() {
  const calls = { text: 0, audio: 0, email: 0, prompts: [], emails: [] };
  return {
    calls,
    preflight() {
      return { modelId: "mock-model", voiceId: "mock-voice" };
    },
    async text(o) {
      calls.text++;
      calls.prompts.push(promptFor(o.snapshot));
      return {
        primary:
          "MOCK ONLY — Test Rowan, your answers select time alone in nature and sensing emotions while keeping distance.",
        shadow: o.snapshot.includeShadow
          ? "MOCK ONLY — Optional Shadow reflection for this fictional test profile."
          : null,
      };
    },
    async audio() {
      calls.audio++;
      return Buffer.from("MOCK BYTES — NOT PLAYABLE NARRATION").toString(
        "base64",
      );
    },
    async email(payload, key) {
      calls.email++;
      calls.emails.push({ payload, key });
      return "mock_email_receipt";
    },
  };
}
for (const shadow of [false, true])
  test(`verified ${shadow ? "bundle" : "base"} order persists text/audio/email and replay does not repeat providers`, async () => {
    const o = await order(shadow),
      s = session(o),
      p = providers();
    await confirmPayment(repo, s);
    assert.equal(
      await fulfill(repo, p, o.id, "https://example.invalid", secret),
      "complete",
    );
    const saved = await repo.get(o.id);
    assert.equal(saved.stage, "complete");
    assert.equal(Boolean(saved.reading.shadow), shadow);
    assert.equal(saved.emailPayload.to, "fixture@example.invalid");
    assert.match(saved.emailPayload.text, /Listen to your reading/);
    assert.equal(saved.emailPayload.text.includes("Shadow Origin"), shadow);
    await confirmPayment(repo, s);
    await fulfill(repo, p, o.id, "https://example.invalid", secret);
    assert.deepEqual([p.calls.text, p.calls.audio, p.calls.email], [1, 1, 1]);
    assert.equal(saved.snapshot.result.primaryArchetype, "Earth Angel");
    const input = JSON.parse(p.calls.prompts[0].user);
    assert.deepEqual(Object.keys(input.answers).sort(), [...answerKeys].sort());
    for (const k of answerKeys)
      assert.equal(input.answers[k], answerLabels[k][answers[k]]);
    assert.equal("birthYear" in input, false);
    assert.equal(input.decorativeSunSign, "Aries");
  });
test("unpaid, fabricated, cross-order, live, amount, currency, price and quantity mismatch never fulfill", async () => {
  const o = await order(),
    good = session(o),
    p = providers();
  const invalid = [
    { payment_status: "unpaid" },
    { id: "invented" },
    { client_reference_id: randomUUID() },
    { metadata: { order_id: randomUUID() } },
    { livemode: true },
    { amount_total: 3100 },
    { currency: "eur" },
    { mode: "subscription" },
    { status: "open" },
    {
      line_items: {
        has_more: false,
        data: [{ price: { id: "other_price" }, quantity: 1 }],
      },
    },
    {
      line_items: {
        has_more: false,
        data: [{ price: { id: config.basePrice }, quantity: 2 }],
      },
    },
  ];
  for (const change of invalid)
    assert.throws(() => assertPaidSession(o, { ...good, ...change }));
  assert.equal(
    await fulfill(repo, p, o.id, "https://example.invalid", secret),
    "not_claimed",
  );
  assert.equal(p.calls.text, 0);
});
test("concurrent webhook and worker retries produce one fulfillment", async () => {
  const o = await order(true),
    p = providers();
  await Promise.all([
    confirmPayment(repo, session(o)),
    confirmPayment(repo, session(o)),
  ]);
  await Promise.all(
    Array.from({ length: 6 }, () =>
      fulfill(repo, p, o.id, "https://example.invalid", secret),
    ),
  );
  assert.deepEqual([p.calls.text, p.calls.audio, p.calls.email], [1, 1, 1]);
});
test("configuration failure is safely retryable before provider calls", async () => {
  const o = await order(),
    p = providers();
  await confirmPayment(repo, session(o));
  const preflight = p.preflight;
  p.preflight = () => {
    throw Error("not enabled");
  };
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  assert.equal((await repo.get(o.id)).stage, "queued");
  assert.equal(p.calls.text, 0);
  p.preflight = preflight;
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  assert.equal((await repo.get(o.id)).stage, "complete");
});
test("uncertain generation halts for review, preserving saved text and preventing repeated spend", async () => {
  const o = await order(),
    p = providers();
  await confirmPayment(repo, session(o));
  p.audio = async () => {
    p.calls.audio++;
    throw Error("timeout after possible acceptance");
  };
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  const saved = await repo.get(o.id);
  assert.equal(saved.stage, "review");
  assert.ok(saved.reading);
  assert.deepEqual([p.calls.text, p.calls.audio, p.calls.email], [1, 1, 0]);
});
test("email retry uses identical payload/key without regenerating; expired retry stops", async () => {
  const o = await order(),
    p = providers();
  await confirmPayment(repo, session(o));
  const send = p.email;
  let fail = true;
  p.email = async (payload, key) => {
    await send(payload, key);
    if (fail) throw Error("uncertain send");
    return "receipt";
  };
  const now = Date.now();
  await fulfill(repo, p, o.id, "https://example.invalid", secret, now);
  fail = false;
  await fulfill(
    repo,
    p,
    o.id,
    "https://changed.invalid",
    "changed-secret",
    now + 1000,
  );
  assert.deepEqual(p.calls.emails[0], p.calls.emails[1]);
  assert.deepEqual([p.calls.text, p.calls.audio, p.calls.email], [1, 1, 2]);
  const late = await order(),
    lateP = providers();
  await confirmPayment(repo, session(late));
  lateP.email = async () => {
    throw Error("uncertain");
  };
  await fulfill(repo, lateP, late.id, "https://example.invalid", secret, now);
  await fulfill(
    repo,
    lateP,
    late.id,
    "https://example.invalid",
    secret,
    now + 24 * 3600000,
  );
  assert.equal((await repo.get(late.id)).stage, "review");
});
test("capability required for text and audio; email link can recover paid results without original tab", async () => {
  const o = await order(),
    p = providers();
  await assert.rejects(
    readingStatus(repo, { orderId: o.id, accessToken: "b".repeat(64) }, secret),
  );
  await assert.rejects(
    readingStatus(
      repo,
      { orderId: o.id, accessToken: emailToken(o.id, secret) },
      secret,
    ),
  );
  const unpaid = await readingStatus(
    repo,
    { orderId: o.id, accessToken: token },
    secret,
  );
  assert.equal(unpaid.reading, null);
  await confirmPayment(repo, session(o));
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  const status = await readingStatus(
    repo,
    { orderId: o.id, accessToken: emailToken(o.id, secret) },
    secret,
  );
  assert.equal(status.emailAccepted, true);
  assert.equal(status.emailDelivered, false);
  const bad = await audio(
    new Request("https://example.invalid", {
      method: "POST",
      body: JSON.stringify({ orderId: o.id, accessToken: "b".repeat(64) }),
    }),
    repo,
    secret,
  );
  assert.equal(bad.status, 404);
  const ok = await audio(
    new Request("https://example.invalid", {
      method: "POST",
      body: JSON.stringify({ orderId: o.id, accessToken: token }),
    }),
    repo,
    secret,
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
});
test("checkout retries bind one immutable snapshot and enforce capability; changed answers cannot reuse order", async () => {
  await setup();
  const id = randomUUID(),
    input = { orderId: id, accessToken: token, answers, includeShadow: false };
  let calls = 0;
  const gateway = {
    async create(o) {
      calls++;
      return {
        id: "cs_test_" + o.id,
        url: "https://checkout.stripe.com/fixture",
      };
    },
  };
  await checkout(repo, gateway, input, config);
  await checkout(repo, gateway, input, config);
  assert.equal(calls, 1);
  await assert.rejects(
    checkout(repo, gateway, { ...input, includeShadow: true }, config),
  );
  await assert.rejects(
    checkout(repo, gateway, { ...input, accessToken: "b".repeat(64) }, config),
  );
  const old = await order();
  await db.query(
    "UPDATE syrena_orders SET data=(data - 'sessionId' - 'checkoutUrl') || $2::jsonb WHERE id=$1",
    [old.id, JSON.stringify({ createdAt: Date.now() - 21 * 3600000 })],
  );
  await assert.rejects(
    checkout(repo, gateway, { ...input, orderId: old.id }, config),
  );
});
test("SQL lease survives process-loss boundary; another worker cannot regenerate", async () => {
  const o = await order(),
    p = providers();
  await confirmPayment(repo, session(o));
  const lease = randomUUID();
  assert.ok(await repo.claim(o.id, lease));
  await repo.patch(o.id, lease, { stage: "text_started" });
  assert.equal(
    await fulfill(repo, p, o.id, "https://example.invalid", secret),
    "not_claimed",
  );
  assert.equal(p.calls.text, 0);
});
test("raw Stripe signatures reject forged and changed payload; valid unpaid event waits and async paid queues", async () => {
  const o = await order();
  const stripe = new Stripe("mock-constructor-only");
  const signingSecret = "unit-test-webhook-signing-secret";
  let current = session(o);
  const gateway = {
    environment: "test",
    verify: (raw, sig) =>
      stripe.webhooks.constructEvent(raw, sig, signingSecret),
    retrieve: async () => current,
  };
  function request(type, valid = true) {
    const raw = JSON.stringify({
      type,
      livemode: false,
      data: { object: { id: o.sessionId } },
    });
    const sig = stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: signingSecret,
    });
    return new Request("https://example.invalid", {
      method: "POST",
      headers: { "stripe-signature": valid ? sig : "forged" },
      body: raw,
    });
  }
  assert.equal(
    (await webhook(request("checkout.session.completed", false), repo, gateway))
      .status,
    400,
  );
  assert.equal((await repo.get(o.id)).paid, false);
  const original = request("checkout.session.completed");
  const changed = new Request("https://example.invalid", {
    method: "POST",
    headers: original.headers,
    body: (await original.text()) + " ",
  });
  assert.equal((await webhook(changed, repo, gateway)).status, 400);
  const staleBody = JSON.stringify({
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: o.sessionId } },
  });
  const stale = new Request("https://example.invalid", {
    method: "POST",
    headers: {
      "stripe-signature": stripe.webhooks.generateTestHeaderString({
        payload: staleBody,
        secret: signingSecret,
        timestamp: 1,
      }),
    },
    body: staleBody,
  });
  assert.equal((await webhook(stale, repo, gateway)).status, 400);
  current = { ...session(o), payment_status: "unpaid" };
  assert.equal(
    (
      await webhook(
        request("checkout.session.async_payment_failed"),
        repo,
        gateway,
      )
    ).status,
    200,
  );
  assert.equal((await repo.get(o.id)).paid, false);
  assert.equal(
    (await webhook(request("checkout.session.completed"), repo, gateway))
      .status,
    200,
  );
  assert.equal((await repo.get(o.id)).paid, false);
  current = session(o);
  assert.equal(
    (
      await webhook(
        request("checkout.session.async_payment_succeeded"),
        repo,
        gateway,
      )
    ).status,
    200,
  );
  assert.equal((await repo.get(o.id)).paid, true);
});
test("worker endpoint cannot be invoked without its own secret", async () => {
  await setup();
  const p = providers();
  const r = await worker(
    new Request("https://example.invalid", { method: "POST" }),
    repo,
    p,
    {
      workerSecret: secret,
      origin: "https://example.invalid",
      accessSecret: secret,
    },
  );
  assert.equal(r.status, 401);
  assert.equal(p.calls.text, 0);
});
test("malformed quiz and incomplete Shadow fail closed; email escapes HTML", async () => {
  for (const change of [
    { empathy: 3 },
    { recharge: null },
    { birthMonth: 13 },
    { birthMonth: 2, birthDay: 30 },
  ])
    assert.throws(() =>
      validateSnapshot({
        answers: { ...answers, ...change },
        includeShadow: false,
      }),
    );
  const o = await order(true),
    p = providers();
  await confirmPayment(repo, session(o));
  p.text = async () => ({
    primary: "mock primary with enough characters for validation",
    shadow: null,
  });
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  assert.equal((await repo.get(o.id)).stage, "review");
  const fake = {
    ...o,
    paid: true,
    paymentEmail: "fixture@example.invalid",
    reading: { primary: "<script>alert(1)</script>", shadow: null },
    audioBase64: "mock",
  };
  const email = emailFor(fake, "https://example.invalid", secret);
  assert.ok(!email.html.includes("<script>"));
  assert.match(email.html, /&lt;script&gt;/);
});
test("payment configuration refuses default and live credentials", () => {
  const previous = process.env.SYRENA_PAYMENT_MODE;
  delete process.env.SYRENA_PAYMENT_MODE;
  assert.throws(() => paymentConfig());
  if (previous) process.env.SYRENA_PAYMENT_MODE = previous;
});

after(async () => {
  if (db) await db.close();
});

test("Stripe adapter uses fixed server prices, same creation key and no buyer data in metadata; wrong account rejected", async () => {
  const o = await order(true);
  const seen = [];
  const fake = {
    accounts: {
      retrieveCurrent: async () => ({ id: "acct_1SrJtXK3yFNUEpTU" }),
    },
    prices: {
      retrieve: async (id) => ({
        id,
        livemode: false,
        active: true,
        currency: "usd",
        recurring: null,
        metadata: {
          brand: "syrena",
          offer: id === config.basePrice ? "origin-reading" : "shadow-origin",
        },
        unit_amount: id === config.basePrice ? 1900 : 1200,
      }),
    },
    checkout: {
      sessions: {
        create: async (params, options) => {
          seen.push({ params, options });
          return {
            id: o.sessionId,
            url: "https://checkout.stripe.com/fixture",
            livemode: false,
          };
        },
      },
    },
  };
  const gateway = stripeGateway(
    {
      ...config,
      key: "mock-constructor-only",
      accountId: "acct_1SrJtXK3yFNUEpTU",
      origin: "https://example.invalid",
    },
    fake,
  );
  await gateway.create(o);
  await gateway.create(o);
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(seen[0].options.idempotencyKey, `syrena-checkout/${o.id}/v1`);
  assert.deepEqual(seen[0].params.metadata, {
    order_id: o.id,
    brand: "syrena",
    environment: "test",
  });
  assert.deepEqual(
    seen[0].params.payment_intent_data.metadata,
    seen[0].params.metadata,
  );
  assert.equal("payment_method_types" in seen[0].params, false);
  assert.equal(seen[0].params.cancel_url, "https://example.invalid/quiz?checkout=cancelled");
  assert.match(seen[0].params.integration_identifier, /^syrena-test-[a-z]{8}$/);
  const correctPrice = fake.prices.retrieve;
  fake.prices.retrieve = async (id) => ({
    ...(await correctPrice(id)),
    metadata: { brand: "other-venture", offer: "origin-reading" },
  });
  await assert.rejects(gateway.create(o), /Price mismatch/);
  fake.prices.retrieve = async (id) => ({
    ...(await correctPrice(id)),
    metadata: {},
  });
  await assert.rejects(gateway.create(o), /Price mismatch/);
  fake.prices.retrieve = async (id) => ({
    ...(await correctPrice(id)),
    metadata: { brand: "syrena", offer: "wrong-offer" },
  });
  await assert.rejects(gateway.create(o), /Price mismatch/);
  fake.prices.retrieve = correctPrice;
  fake.accounts.retrieveCurrent = async () => ({ id: "acct_wrong" });
  await assert.rejects(gateway.create(o));
  assert.equal(seen.length, 2);
});
test("generation provider identity is pinned and changed configuration cannot resume", async () => {
  const o = await order(),
    p = providers();
  await confirmPayment(repo, session(o));
  p.email = async () => {
    throw Error("uncertain email");
  };
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  const before = await repo.get(o.id);
  assert.deepEqual(before.providerIdentity, {
    modelId: "mock-model",
    voiceId: "mock-voice",
  });
  p.preflight = () => ({ modelId: "changed", voiceId: "mock-voice" });
  const previous = p.calls.text;
  await fulfill(repo, p, o.id, "https://example.invalid", secret);
  assert.equal(p.calls.text, previous);
  assert.equal((await repo.get(o.id)).emailId, undefined);
});

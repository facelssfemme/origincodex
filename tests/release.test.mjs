import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  sanitizeEvent,
  ingest,
  report,
  reportRange,
} from "../src/server/funnel.ts";
import { deliveryReceipt } from "../src/server/delivery-receipt.ts";
import { readingShare } from "../src/utils/share-reading.ts";
let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function setup() {
  if (db) return;
  db = new PGlite();
  for (const name of ["001_orders.sql", "002_funnel.sql"])
    await db.exec(
      await readFile(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
}
after(async () => {
  if (db) await db.close();
});
const event = (overrides = {}) => ({
  event_id: randomUUID(),
  session_id: randomUUID(),
  name: "quiz_question_complete",
  props: {
    question_number: 2,
    name: "PRIVATE",
    email: "private@example.invalid",
    answers: [1],
  },
  traffic_source: "private@example.invalid",
  device_type: "desktop",
  page: "/thank-you#access=SECRET",
  timestamp: "1900-01-01",
  ...overrides,
});
test("public sharing requires paid reading and discloses only approved archetype/public URL", () => {
  assert.equal(readingShare(false, true, "Orion"), null);
  assert.equal(readingShare(true, false, "Orion"), null);
  assert.equal(readingShare(true, true, "PRIVATE"), null);
  const payload = readingShare(true, true, "Orion");
  assert.equal(payload.url, "https://syrenacodex.com/");
  assert.match(payload.text, /entertainment and self-reflection/);
  assert.deepEqual(Object.keys(payload), ["title", "text", "url"]);
});
test("analytics strips private fields, rejects purchases/malformed UUIDs/questions, assigns server timestamp, deduplicates", async () => {
  await setup();
  const e = event();
  const clean = sanitizeEvent(e);
  assert.equal(clean.source, "other");
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE|private@|SECRET|1900/);
  for (const bad of [
    event({ name: "purchase" }),
    event({ session_id: "email@example.com" }),
    event({ props: { question_number: 10 } }),
    event({ props: { question_number: "2" } }),
  ])
    assert.equal(sanitizeEvent(bad), null);
  assert.equal(await ingest(q, [e, e], "test"), 1);
  assert.equal(await ingest(q, [e], "test"), 0);
  const rows = await q("SELECT * FROM syrena_funnel_events");
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|private@|SECRET|1900/);
  await assert.rejects(() => ingest(q, [event()], ""));
  await assert.rejects(() => ingest(q, Array(21).fill(e), "test"));
});
test("report dates reject invalid/reversed/excessive ranges and use inclusive UTC dates", () => {
  assert.deepEqual(reportRange("2026-09-29", "2026-09-29"), {
    start: "2026-09-29T00:00:00.000Z",
    end: "2026-09-30T00:00:00.000Z",
  });
  for (const dates of [
    ["2026-02-30", "2026-03-01"],
    ["2026-09-30", "2026-09-29"],
    ["2020-01-01", "2026-01-01"],
    ["bad", "2026-09-29"],
  ])
    assert.throws(() => reportRange(...dates));
});
const signingKey = Buffer.from("local-only-delivery-test-key-32bytes");
const secret = "whsec_" + signingKey.toString("base64");
function signed(payload, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload),
    id = "msg_local_fixture",
    signature =
      "v1," +
      createHmac("sha256", signingKey)
        .update(`${id}.${timestamp}.${body}`)
        .digest("base64");
  return new Request("http://localhost/api/email-delivery", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(timestamp),
      "svix-signature": signature,
    },
  });
}
test("delivery rejects unsigned/tampered/stale receipts, stores early valid receipt once without recipient data", async () => {
  await setup();
  const email = randomUUID();
  const payload = {
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      email_id: email,
      to: ["PRIVATE@example.invalid"],
      subject: "PRIVATE",
    },
  };
  assert.equal(
    (
      await deliveryReceipt(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
        q,
        secret,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await deliveryReceipt(
        signed(payload, Math.floor(Date.now() / 1000) - 1000),
        q,
        secret,
      )
    ).status,
    400,
  );
  const req = signed(payload);
  const tampered = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ ...payload, created_at: "2020-01-01" }),
  });
  assert.equal((await deliveryReceipt(tampered, q, secret)).status, 400);
  assert.equal((await deliveryReceipt(signed(payload), q, "")).status, 503);
  assert.equal((await deliveryReceipt(signed(payload), q, secret)).status, 200);
  assert.equal((await deliveryReceipt(signed(payload), q, secret)).status, 200);
  const rows = await q(
    "SELECT * FROM syrena_email_delivery WHERE email_id=$1",
    [email],
  );
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE/);
  assert.equal(
    (
      await deliveryReceipt(
        signed({ ...payload, type: "email.sent" }),
        q,
        secret,
      )
    ).status,
    200,
  );
});
test("verified order cohort excludes unpaid, legacy, other environment and boundary orders; accepted is not delivered; receipt replay cannot inflate counts", async () => {
  await setup();
  const email = randomUUID();
  const make = async (fields = {}, created = "2026-09-29T00:00:00Z") => {
    const id = randomUUID();
    await q(
      "INSERT INTO syrena_orders(id,data,created_at) VALUES($1,$2::jsonb,$3)",
      [
        id,
        JSON.stringify({
          id,
          currency: "usd",
          environment: "test",
          sessionId: "cs_" + id,
          paid: true,
          amount: 1900,
          ...fields,
        }),
        created,
      ],
    );
  };
  await make({
    emailId: email,
    reading: { primary: "fixture" },
    audioBase64: "fixture",
  });
  await make({ emailId: randomUUID(), amount: 3100 });
  await make({ paid: false });
  await make({ environment: "live" });
  await make({ environment: undefined });
  await make({}, "2026-09-30T00:00:00Z");
  let r = await report(q, "2026-09-29", "2026-09-29", "test");
  assert.deepEqual(r.orders, {
    checkout_created: 3,
    paid: 2,
    artifacts_ready: 1,
    email_accepted: 2,
    email_delivered: 0,
    paid_gross_cents: 5000,
  });
  const payload = {
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: email },
  };
  await deliveryReceipt(signed(payload), q, secret);
  await deliveryReceipt(signed(payload), q, secret);
  r = await report(q, "2026-09-29", "2026-09-29", "test");
  assert.equal(r.orders.email_delivered, 1);
  assert.equal(r.orders.paid, 2);
  const zero = await report(q, "2025-01-01", "2025-01-01", "test");
  assert.equal(zero.orders.paid, 0);
  assert.deepEqual(zero.browser, []);
  await assert.rejects(() => report(q, "2026-09-29", "2026-09-29", "invented"));
});
test("question counts count every completed step per session, not only furthest step", async () => {
  await setup();
  await q("DELETE FROM syrena_funnel_events");
  const session = randomUUID();
  await ingest(
    q,
    [
      event({ session_id: session, props: { question_number: 1 } }),
      event({ session_id: session, props: { question_number: 2 } }),
      event({ session_id: session, props: { question_number: 2 } }),
    ],
    "test",
  );
  await q("UPDATE syrena_funnel_events SET received_at='2026-09-29T12:00:00Z'");
  const r = await report(q, "2026-09-29", "2026-09-29", "test");
  assert.deepEqual(r.browser, [
    { name: "quiz_question_complete", question: 1, sessions: 1 },
    { name: "quiz_question_complete", question: 2, sessions: 1 },
  ]);
});

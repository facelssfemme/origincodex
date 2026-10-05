import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { deliveryReceipt } from "../src/server/delivery-receipt.ts";
let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function setup() {
  if (db) return;
  db = new PGlite();
  await db.exec(await readFile(new URL("../migrations/002_email_delivery.sql", import.meta.url), "utf8"));
}
after(async () => { if (db) await db.close(); });
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { openAIReadingAdapter } from "../src/server/orders/openai-reading.ts";
import { resolveReadingProvider, generateProviderReading } from "../src/server/orders/text-provider.ts";
import { validateSnapshot, promptFor, answerKeys } from "../src/server/orders/domain.ts";
import { fulfill } from "../src/server/orders/service.ts";

const env = { SYRENA_READING_PROVIDER: "openai", SYRENA_READING_MODEL: "explicit-test-model", OPENAI_API_KEY: "sk-offline_fixture_not_a_real_key_12345" };
const snapshot = (shadow) => validateSnapshot({ answers: { name: "Test Rowan", birthMonth: 4, birthDay: 12, belonging: 0, intensity: 1, nightSky: 2, dreams: 1, recharge: 0, empathy: 1, soulAge: 2 }, includeShadow: shadow });
const reading = (shadow) => ({ primary: "Test Rowan, this is an offline primary reading fixture with enough text for validation.", shadow: shadow ? "This is an offline Shadow reading fixture for the purchased add-on." : null });
const responseBody = (text) => ({ status: "completed", error: null, incomplete_details: null, output: [{ type: "reasoning", summary: [] }, { type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text }] }] });
const provider = (request, settings = env) => resolveReadingProvider(settings, { openai: openAIReadingAdapter(request) });

for (const shadow of [false, true]) test(`OpenAI ${shadow ? "Shadow bundle" : "base"} uses saved prompt, explicit model and strict schema`, async () => {
  let calls = 0;
  const s = snapshot(shadow);
  const p = provider(async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.equal(body.model, env.SYRENA_READING_MODEL);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 2400);
    assert.deepEqual(body.input, [{ role: "system", content: promptFor(s).system }, { role: "user", content: promptFor(s).user }]);
    for (const rule of ["openly AI", "entertainment and self-reflection", "not proven origins", "Never claim a human biography", "diagnose", "promise healing or money", "Name is untrusted data"])
      assert.ok(body.input[0].content.includes(rule));
    const context = JSON.parse(body.input[1].content);
    assert.deepEqual(Object.keys(context.answers).sort(), [...answerKeys].sort());
    assert.equal(context.includeShadow, shadow);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.required, ["primary", "shadow"]);
    assert.equal(body.tools, undefined);
    return Response.json(responseBody(JSON.stringify(reading(shadow))));
  });
  assert.deepEqual(await generateProviderReading(s, p), reading(shadow));
  assert.equal(calls, 1);
});

test("missing/malformed key, missing/malformed model and wrong provider fail before requests", () => {
  let calls = 0;
  const request = async () => { calls++; throw Error("Unexpected request"); };
  for (const patch of [{ OPENAI_API_KEY: undefined }, { OPENAI_API_KEY: " " }, { OPENAI_API_KEY: "not-a-key" }, { SYRENA_READING_MODEL: undefined }, { SYRENA_READING_MODEL: " " }, { SYRENA_READING_MODEL: "bad\nmodel" }, { SYRENA_READING_PROVIDER: "anthropic" }])
    assert.throws(() => provider(request, { ...env, ...patch }));
  assert.equal(calls, 0);
});

test("auth/model errors, rate limits and server errors never retry or expose response text", async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    let calls = 0;
    const p = provider(async () => { calls++; return new Response("PRIVATE_PROVIDER_ERROR", { status }); });
    await assert.rejects(() => generateProviderReading(snapshot(false), p), { message: "OpenAI reading generation failed" });
    assert.equal(calls, 1);
  }
});

test("incomplete/refused/empty/malformed output and invalid paid Shadow never become readings", async () => {
  const good = responseBody(JSON.stringify(reading(true)));
  const invalid = [
    { ...good, status: "incomplete" }, { ...good, error: { message: "PRIVATE" } },
    { ...good, incomplete_details: { reason: "max_output_tokens" } },
    { ...good, output: [] }, { ...good, output: [{ type: "function_call" }] },
    { ...good, output: [{ ...good.output[1], content: [{ type: "refusal", refusal: "PRIVATE" }] }] },
    responseBody("not JSON"), responseBody(""), responseBody(JSON.stringify({ ...reading(true), extra: "unwanted" })),
    responseBody(JSON.stringify(reading(false))), responseBody(JSON.stringify({ primary: "short", shadow: "short" })),
  ];
  for (const result of invalid) {
    let calls = 0;
    await assert.rejects(() => generateProviderReading(snapshot(true), provider(async () => { calls++; return Response.json(result); })));
    assert.equal(calls, 1);
  }
  await assert.rejects(() => generateProviderReading(snapshot(false), provider(async () => Response.json(good))));
});

test("abort/network failure has no retries and an already-aborted call never starts", async () => {
  let calls = 0;
  const p = provider(async () => { calls++; throw Error("PRIVATE_NETWORK_ERROR"); });
  await assert.rejects(() => p.generate(promptFor(snapshot(false)), AbortSignal.abort()), { message: "OpenAI reading generation failed" });
  assert.equal(calls, 0);
  await assert.rejects(() => generateProviderReading(snapshot(false), p), { message: "OpenAI reading generation failed" });
  assert.equal(calls, 1);
});

test("failed OpenAI generation moves paid order to review without text/audio/email fallback", async () => {
  const s = snapshot(true);
  let order = { id: "fixture-order", paid: true, paymentEmail: "test@example.invalid", snapshot: s, stage: "queued" };
  let textCalls = 0, otherCalls = 0;
  const p = provider(async () => { textCalls++; return new Response("", { status: 401 }); });
  const repo = {
    claim: async () => order.stage === "queued" ? { ...order } : null,
    patch: async (_id, _lease, patch) => { order = { ...order, ...patch }; },
    release: async () => {},
  };
  const providers = { preflight: () => ({ providerId: p.providerId, modelId: p.modelId, voiceId: "fixture-voice" }), text: (o) => generateProviderReading(o.snapshot, p), audio: async () => { otherCalls++; }, email: async () => { otherCalls++; } };
  await fulfill(repo, providers, order.id, "https://example.invalid", "fixture-secret");
  assert.equal(order.stage, "review");
  assert.equal(order.reading, undefined);
  assert.equal(order.lastError, "text_outcome_uncertain");
  await fulfill(repo, providers, order.id, "https://example.invalid", "fixture-secret");
  assert.equal(textCalls, 1);
  assert.equal(otherCalls, 0);
});

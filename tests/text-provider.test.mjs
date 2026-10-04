import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReadingProvider, generateProviderReading } from "../src/server/orders/text-provider.ts";
import { validateSnapshot } from "../src/server/orders/domain.ts";

const snapshot = validateSnapshot({
  answers: { name: "Test Rowan", birthMonth: 4, birthDay: 12, belonging: 0, intensity: 1, nightSky: 2, dreams: 1, recharge: 0, empathy: 1, soulAge: 2 },
  includeShadow: true,
});
test("no inferred/default provider, model or unconfirmed OpenAI adapter", () => {
  for (const env of [{}, { OPENAI_API_KEY: "fixture" },
    { SYRENA_READING_PROVIDER: "openai", SYRENA_READING_MODEL: "unconfirmed" },
    { SYRENA_READING_PROVIDER: "toString", SYRENA_READING_MODEL: "fixture" }])
    assert.throws(() => resolveReadingProvider(env));
});
test("selected adapter validates its credentials and receives saved quiz prompt once", async () => {
  let calls = 0;
  const adapters = { fixture: { configure(model, env) {
    assert.equal(model, "explicit-model");
    if (!env.FIXTURE_KEY) throw Error("Missing credential");
    return { async generate(prompt, signal) {
      calls++;
      assert.match(prompt.user, /Test Rowan/);
      assert.ok(signal instanceof AbortSignal);
      return JSON.stringify({ primary: "Example generated primary reading for the offline fixture.", shadow: "Example generated Shadow reading for the offline fixture." });
    } };
  } } };
  const env = { SYRENA_READING_PROVIDER: "fixture", SYRENA_READING_MODEL: "explicit-model" };
  assert.throws(() => resolveReadingProvider(env, adapters));
  const provider = resolveReadingProvider({ ...env, FIXTURE_KEY: "fixture" }, adapters);
  assert.equal(provider.providerId, "fixture");
  const reading = await generateProviderReading(snapshot, provider);
  assert.match(reading.shadow, /Shadow/);
  assert.equal(calls, 1);
});
test("provider error, invalid JSON and missing purchased Shadow fail without canned fallback or retry", async () => {
  for (const raw of [null, "not JSON", JSON.stringify({ primary: "Example primary reading long enough for validation.", shadow: null })]) {
    let calls = 0;
    await assert.rejects(() => generateProviderReading(snapshot, {
      providerId: "fixture", modelId: "fixture", generate: async () => {
        calls++;
        if (raw === null) throw Error("Provider unavailable");
        return raw;
      },
    }));
    assert.equal(calls, 1);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

test("retired generation, email and unbound session modules export no browser-callable functions", async () => {
  for (const path of ["utils/reading-generation", "utils/email", "server/send-results-email", "utils/quiz-session"]) {
    const module = await import(`../src/${path}.ts`);
    assert.deepEqual(Object.keys(module), []);
  }
});

test("public telemetry rejects forged purchases and verified flags but keeps ordinary observations", async () => {
  const source = await readFile(new URL("../src/server/events.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }, written = [];
  vm.runInNewContext(code, {
    exports: module.exports, module, process: { env: {} }, console,
    require(id) {
      if (id === "@tanstack/react-start") return { createServerFn: () => ({ validator: () => ({ handler: fn => fn }) }) };
      if (id === "node:fs/promises") return { mkdir: async () => {}, appendFile: async (_path, data) => written.push(...data.trim().split("\n").map(JSON.parse)) };
      if (id === "node:path") return { dirname: () => "/unused-mocked-directory" };
      throw Error("Unexpected dependency");
    },
  });
  assert.equal(module.exports.recordVerifiedPurchase, undefined);
  await module.exports.trackEvents({ data: { events: [
    { name: "purchase", props: { verified: true, amount: 999999 } },
    { name: "purchase", props: {} },
    { name: "quiz_start", props: { verified: true } },
    { name: "quiz_start", props: {} },
  ] } });
  assert.equal(written.length, 1);
  assert.equal(written[0].name, "quiz_start");
});

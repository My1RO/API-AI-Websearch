#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertSdkTimeoutHeader, buildSchedule, deepFreeze, readCases, requestHeaders,
  serializeError } = require("./run_production_campaign.js");

const isolatedA = deepFreeze(JSON.parse(JSON.stringify({ providers: [{ npi: "1234567890" }] })));
const isolatedB = deepFreeze(JSON.parse(JSON.stringify({ providers: [{ npi: "1234567890" }] })));
assert.notEqual(isolatedA, isolatedB);
assert.notEqual(isolatedA.providers[0], isolatedB.providers[0]);
assert.throws(() => { isolatedA.providers[0].npi = "mutated"; }, TypeError);

const sdkRequest = new Request("https://foundry-lucie-ai.openai.azure.com/openai/v1/responses", {
  method: "POST", headers: { "x-stainless-timeout": "600", "content-type": "application/json" },
  body: "{}"
});
assert.equal(requestHeaders(sdkRequest).get("x-stainless-timeout"), "600",
  "Request-carried SDK headers must survive instrumentation");
assert.equal(requestHeaders(sdkRequest, { headers: { "x-stainless-timeout": "123" } })
  .get("x-stainless-timeout"), "123", "init headers override Request headers like fetch");
assert.doesNotThrow(() => assertSdkTimeoutHeader(new Headers(), 600000),
  "SDK 5.23.2 may enforce its verified default without advertising a timeout header");
assert.doesNotThrow(() => assertSdkTimeoutHeader(new Headers({ "x-stainless-timeout": "600" }), 600000));
assert.throws(() => assertSdkTimeoutHeader(new Headers({ "x-stainless-timeout": "123" }), 600000),
  /conflicts with the pinned SDK timeout/);

const scheduleA = buildSchedule({ caseIds: ["P001", "P002", "P003"],
  armIds: ["A", "B", "C"], seed: "fixed" });
const scheduleB = buildSchedule({ caseIds: ["P001", "P002", "P003"],
  armIds: ["A", "B", "C"], seed: "fixed" });
assert.deepEqual(scheduleA, scheduleB, "schedule must be deterministic");
assert.equal(scheduleA.length, 9);
assert.equal(new Set(scheduleA.map((row) => `${row.armId}/${row.caseId}`)).size, 9);
for (const caseId of ["P001", "P002", "P003"]) {
  assert.deepEqual(scheduleA.filter((row) => row.caseId === caseId).map((row) => row.withinCasePosition).sort(),
    [0, 1, 2]);
}

const root = new Error("root");
root.code = "UND_ERR_CONNECT_TIMEOUT";
const outer = new Error("outer", { cause: root });
const serialized = serializeError(outer);
assert.equal(serialized.cause.code, "UND_ERR_CONNECT_TIMEOUT");
assert.equal(serialized.cause.message, "root");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "production-campaign-cases-"));
try {
  const jsonl = path.join(fixtureRoot, "cases.jsonl");
  const object = path.join(fixtureRoot, "cases.json");
  const cases = [{ caseId: "P001", request: { npi: "1234567890" } }];
  fs.writeFileSync(jsonl, `${JSON.stringify(cases[0])}\n`);
  fs.writeFileSync(object, JSON.stringify({ cases }));
  assert.deepEqual(readCases(jsonl, "jsonl_rows"), cases);
  assert.deepEqual(readCases(object, "json_object_cases"), cases);

  const makeArm = (name) => {
    const root = path.join(fixtureRoot, name);
    fs.mkdirSync(root);
    childProcess.execFileSync("git", ["init", "-q", root]);
    fs.writeFileSync(path.join(root, "fixture.txt"), `${name}\n`);
    for (const file of [
      "src/services/ai-provider/responses-provider.client.ts",
      "src/services/ai-provider/response-parser.ts",
      "src/services/ai-provider/usage-telemetry.ts"
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "identical non-treatment fixture\n");
    }
    childProcess.execFileSync("git", ["-C", root, "add", "."]);
    childProcess.execFileSync("git", ["-C", root, "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
    return { root, commit: childProcess.execFileSync("git", ["-C", root, "rev-parse", "HEAD"],
      { encoding: "utf8" }).trim() };
  };
  const armA = makeArm("arm-a");
  const armB = makeArm("arm-b");
  const runnerFile = path.join(__dirname, "run_production_campaign.js");
  const runnerRepo = childProcess.execFileSync("git", ["-C", __dirname,
    "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const runnerCommit = childProcess.execFileSync("git", ["-C", runnerRepo, "rev-list", "-1", "HEAD",
    "--", path.relative(runnerRepo, runnerFile)],
    { encoding: "utf8" }).trim();
  const runnerSha256 = crypto.createHash("sha256").update(fs.readFileSync(runnerFile)).digest("hex");
  const identicalSurfaceSha256 = crypto.createHash("sha256")
    .update("identical non-treatment fixture\n").digest("hex");
  const sdkModules = path.join(runnerRepo, "node_modules");
  const openAiEntry = require.resolve("openai", { paths: [sdkModules] });
  const openAiPackageFile = path.join(path.dirname(openAiEntry), "package.json");
  const openAiPackageJsonSha256 = crypto.createHash("sha256")
    .update(fs.readFileSync(openAiPackageFile)).digest("hex");
  const manifestFile = path.join(fixtureRoot, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify({
    schemaVersion: 1, campaignId: "validate-no-call-fixture", datasetRole: "development",
    caseFile: jsonl, caseFileSha256: crypto.createHash("sha256").update(fs.readFileSync(jsonl)).digest("hex"),
    caseFileFormat: "jsonl_rows", outputRoot: path.join(fixtureRoot, "must-not-exist"),
    model: "gpt-5.6-terra", reasoning: "low", concurrency: 2, maxToolCalls: 8, seed: "fixture",
    expectedRunnerCommit: runnerCommit, expectedRunnerSha256: runnerSha256,
    runtime: { nodeVersion: process.version, openaiVersion: "5.23.2", timeoutMs: 600000,
      sdkModules, openaiPackageJsonSha256: openAiPackageJsonSha256,
      responsesUrl: "https://foundry-lucie-ai.openai.azure.com/openai/v1/responses",
      retryPolicy: { initialSdkMaxRetries: 1, semanticRetrySdkMaxRetries: 0,
        maxObservedHttpAttempts: 3 } },
    nonTreatmentSurfaceSha256: {
      "src/services/ai-provider/responses-provider.client.ts": identicalSurfaceSha256,
      "src/services/ai-provider/usage-telemetry.ts": identicalSurfaceSha256
    },
    arms: [
      { armId: "A", name: "A", root: armA.root, commit: armA.commit },
      { armId: "B", name: "B", root: armB.root, commit: armB.commit }
    ]
  }));
  const env = { ...process.env };
  delete env.AZURE_OPENAI_API_KEY;
  const admitted = JSON.parse(childProcess.execFileSync(process.execPath,
    [path.join(__dirname, "run_production_campaign.js"), manifestFile, "validate"],
    { encoding: "utf8", env }));
  assert.equal(admitted.status, "PRODUCTION_CAMPAIGN_ADMITTED");
  assert.equal(admitted.paidCallsMade, 0);
  assert.equal(admitted.networkCallsMade, 0);
  assert.equal(fs.existsSync(path.join(fixtureRoot, "must-not-exist")), false,
    "validate mode must not create an output root");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("production campaign runner tests passed\n");

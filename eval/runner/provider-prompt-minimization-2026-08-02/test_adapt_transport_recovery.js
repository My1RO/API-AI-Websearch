#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const recovery = require("./adapt_transport_recovery.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "transport-recovery-test-"));
try {
  const primaryRoot = path.join(root, "primary");
  const recoveryRoot = path.join(root, "recovery");
  const outputRoot = path.join(root, "adapted");
  const base = (caseId) => ({ armId: "A", armCommit: "a".repeat(40), caseId,
    input: { providers: [{ npi: caseId }] }, cmsBaseline: { caseId }, strata: { entityType: "individual" },
    expectedInitialRequest: { model: "gpt-5.6-terra", input: caseId }, rawResponses: [],
    finalProfiles: [], parserProfiles: [], usage: [] });
  const primaryP001 = { ...base("P001"), error: "failed", sends: [
    { status: null, raw: null, error: "fetch failed" },
    { status: null, raw: null, error: "fetch failed" }
  ] };
  const primaryP002 = { ...base("P002"), error: null, sends: [{ status: 200, raw: { status: "completed" } }],
    rawResponses: [{ status: "completed" }], usage: [{ inputTokens: 10, outputTokens: 2,
      cachedInputTokens: 0, webSearchCalls: 1, totalUsd: 0.1 }] };
  const recoveredP001 = { ...base("P001"), error: null,
    sends: [{ status: 200, raw: { status: "completed" } }], rawResponses: [{ status: "completed" }],
    usage: [{ inputTokens: 20, outputTokens: 3, cachedInputTokens: 4, webSearchCalls: 2, totalUsd: 0.2 }] };
  const writeArtifact = (campaignRoot, artifact) => {
    const dir = path.join(campaignRoot, "cells", "A", artifact.caseId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "artifact.json"), JSON.stringify(artifact));
  };
  writeArtifact(primaryRoot, primaryP001);
  writeArtifact(primaryRoot, primaryP002);
  writeArtifact(recoveryRoot, recoveredP001);
  fs.writeFileSync(path.join(primaryRoot, "summary.json"), JSON.stringify({ rows: 2, successes: 1 }));
  fs.writeFileSync(path.join(primaryRoot, "preregistration.json"), JSON.stringify({ cases: ["P001", "P002"] }));
  const manifest = recovery.adaptTransportRecovery({ primaryRoot, recoveryRoot, outputRoot,
    armId: "A", caseIds: ["P001"] });
  assert.equal(manifest.replacements.length, 1);
  assert.equal(manifest.replacements[0].primaryTransportAttempts, 2);
  const adapted = JSON.parse(fs.readFileSync(path.join(outputRoot, "cells", "A", "P001", "artifact.json")));
  assert.equal(adapted.error, null);
  const summary = JSON.parse(fs.readFileSync(path.join(outputRoot, "summary.json")));
  assert.equal(summary.rows, 2);
  assert.equal(summary.successes, 2);
  assert.equal(summary.arms.A.estimatedCostUsd, 0.30000000000000004);
  assert.equal(fs.existsSync(path.join(outputRoot, "transport-recovery-history",
    "P001-primary-transport-failure.json")), true);
  assert.equal(recovery.isTransportExhaustion(primaryP001), true);
  assert.equal(recovery.isTransportExhaustion(primaryP002), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("transport recovery adapter tests passed\n");

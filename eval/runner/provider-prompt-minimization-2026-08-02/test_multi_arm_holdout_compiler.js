#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeConfig, protocolAnalysis } = require("./compile_corrected_campaign.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "multi-arm-holdout-compiler-"));
try {
  const protocolFile = path.join(root, "protocol.md");
  const batteryFile = path.join(root, "holdout.json");
  fs.writeFileSync(protocolFile, "same fixed categorical rubric\n");
  fs.writeFileSync(batteryFile, JSON.stringify({ cases: [{ caseId: "H001" }, { caseId: "H002" }] }));
  const base = {
    schemaVersion: 1, campaignId: "fixture-holdout", datasetRole: "sealed_holdout",
    auditMode: "preregistered_multi_arm_holdout", caseBatteryFormat: "json_object_cases",
    planNetworkContextPolicy: "exclude_from_evaluator_context",
    protocolFile, protocolSha256: sha256(fs.readFileSync(protocolFile)),
    caseBatteryFile: batteryFile, caseBatterySha256: sha256(fs.readFileSync(batteryFile)),
    productionEndpoint: "https://fixture.openai.azure.com/openai/v1/responses",
    baselineArmId: "A", expectedCasesPerArm: 2, outputRoot: path.join(root, "output"),
    bootstrap: { iterations: 10_000, confidence: 0.95 },
    paths: { packetRoot: "packets", atomicRoot: "atomic", synthesisRoot: "synthesis" },
    arms: [{ armId: "A", name: "baseline", productionRoot: "production-a",
      expectedArmCommit: "a".repeat(40), promptStaticBytes: 100 },
    { armId: "B", name: "candidate", productionRoot: "production-b",
      expectedArmCommit: "b".repeat(40), promptStaticBytes: 50 }]
  };
  const config = normalizeConfig(base, path.join(root, "manifest.json"));
  assert.equal(config.sealedHoldout, true);
  assert.equal(config.arms.length, 2);
  const analysisInput = { rows: [], arms: base.arms, baselineArmId: "A", caseIds: [],
    bootstrap: { iterations: 10_000, seed: "same" } };
  const developmentAnalysis = protocolAnalysis({ ...analysisInput, datasetRole: "development" });
  const holdoutAnalysis = protocolAnalysis({ ...analysisInput, datasetRole: "sealed_holdout" });
  assert.deepEqual({ ...developmentAnalysis, datasetRole: null }, { ...holdoutAnalysis, datasetRole: null },
    "dataset role may label the report but must not change evaluator criteria or gates");
  assert.throws(() => normalizeConfig({ ...base, arms: [base.arms[0]] }, path.join(root, "manifest.json")),
    /at least two arms/);
  assert.throws(() => normalizeConfig({ ...base, auditMode: "single_arm_holdout_reevaluation" },
    path.join(root, "manifest.json")), /preregistered_multi_arm_holdout/);
  assert.throws(() => normalizeConfig({ ...base, caseBatteryFormat: "jsonl_rows" },
    path.join(root, "manifest.json")), /sealed holdout requires preregistered json_object_cases/);
  assert.throws(() => normalizeConfig({ ...base, datasetRole: "development",
    auditMode: "preregistered_multi_arm_holdout" }, path.join(root, "manifest.json")),
  /Development may not use a holdout audit mode/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("multi-arm sealed-holdout compiler tests passed\n");

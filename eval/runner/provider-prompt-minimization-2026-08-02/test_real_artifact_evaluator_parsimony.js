#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const atomic = require("./run_atomic_evaluator.js");

const workspace = path.resolve(process.env.EDE_SHARED_WORKSPACE || "/Users/kui/lucie/EDE");
const cellsRoot = path.join(workspace,
  "test-evidence/provider-prompt-minimization-2026-08-02/runs/" +
  "candidate72-diagnostic-v1-judge-sol-high-v14-reader-v5/cells/CANDIDATE72");
const tokenizerModule = process.env.TOKENIZER_MODULES || path.join(workspace,
  "test-evidence/provider-successor-experiment-2026-07-30/node_modules/js-tiktoken");
const required = path.join(cellsRoot, "H037", "packet.json");
if (!fs.existsSync(required) || !fs.existsSync(tokenizerModule)) {
  if (process.env.REQUIRE_REAL_EVALUATOR_ARTIFACTS === "1") {
    throw new Error("Real evaluator regression artifacts or o200k tokenizer are absent.");
  }
  process.stdout.write("real evaluator artifact parsimony tests skipped (artifacts absent)\n");
  process.exit(0);
}
const { getEncoding } = require(tokenizerModule);
const encoding = getEncoding("o200k_base");
const countTokens = (value) => encoding.encode(value).length;
const expectedLegacyTokens = new Map([
  ["H003", 1_028_876], ["H005", 852_101], ["H035", 468_327],
  ["H037", 4_009_954], ["H038", 1_948_723], ["H057", 1_376_621]
]);
for (const [caseId, legacyTokens] of expectedLegacyTokens) {
  const dir = path.join(cellsRoot, caseId);
  const packet = JSON.parse(fs.readFileSync(path.join(dir, "packet.json"), "utf8"));
  const preflight = JSON.parse(fs.readFileSync(path.join(dir, "preflight.json"), "utf8"));
  assert.equal(preflight.failureCode, "CONTEXT_OVERFLOW");
  assert.equal(preflight.localEncodedTokens, legacyTokens,
    `${caseId} must remain bound to the observed whole-packet overflow`);
  const plan = atomic.buildAtomicPlan(packet, { countTokens });
  assert.equal(plan.contextOverflowCount, 0, `${caseId} atomic requests must fit without truncation`);
  assert(plan.maximumRequestTokens < 224_000);
  assert(plan.invalidNormalizations.length > 0,
    `${caseId} old malformed snapshots must not masquerade as corrected evidence`);
  const represented = new Set(plan.requests.flatMap((request) => request.units.map((unit) => unit.sourceIndex)));
  const invalid = new Set(plan.invalidNormalizations.map((item) => item.sourceIndex));
  assert.equal(new Set([...represented, ...invalid]).size, packet.sources.length,
    `${caseId} every source must be either exhaustively chunked or explicitly invalid`);
  assert.equal(plan.intendedSourceByUniqueFactComparisonCount,
    packet.sources.length * plan.uniqueFactTargetCount,
    `${caseId} intended source by unique-fact semantic matrix must not be pruned`);
  assert.equal(plan.sourceByUniqueFactComparisonMatrixComplete, false,
    `${caseId} malformed legacy normalization must remain an explicit incompleteness`);
  for (const request of plan.requests) {
    assert.equal(request.sectionMetrics.completeRequest.tokens, request.requestTokens);
    assert(request.input.sourceChunks.every((chunk) => !Object.hasOwn(chunk, "sourceTextSha256")
      && !Object.hasOwn(chunk, "absoluteDeliveredRange") && !Object.hasOwn(chunk, "host")));
  }
}
for (const caseId of ["H001", "H002"]) {
  const dir = path.join(cellsRoot, caseId);
  const packet = JSON.parse(fs.readFileSync(path.join(dir, "packet.json"), "utf8"));
  const preflight = JSON.parse(fs.readFileSync(path.join(dir, "preflight.json"), "utf8"));
  assert.equal(preflight.failureCode, null);
  assert(preflight.localEncodedTokens < 224_000);
  const plan = atomic.buildAtomicPlan(packet, { countTokens });
  assert.equal(plan.contextOverflowCount, 0);
  assert.equal(plan.invalidNormalizations.length, 0);
}
process.stdout.write("real evaluator artifact parsimony tests passed\n");

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "holdout-evaluator-diff-"));
try {
  const oldRoot = path.join(root, "old"); const newRoot = path.join(root, "new");
  const outputRoot = path.join(root, "output");
  fs.mkdirSync(oldRoot); fs.mkdirSync(newRoot);
  fs.writeFileSync(path.join(oldRoot, "holdout-validation-results.json"), `${JSON.stringify([{
    caseId: "H001", evaluationStatus: "evaluable", criticalFailures: [],
    categorical: { claimAssessments: [{ claimId: "claim:p0:phone:0", fieldType: "phone",
      exactSupport: "unreadable", citedSourceSupport: "unreadable", reason: "old" }] }
  }])}\n`);
  fs.writeFileSync(path.join(oldRoot, "manual-trace-audit.json"), "{}\n");
  fs.writeFileSync(path.join(newRoot, "summary.json"), `${JSON.stringify({ strata: { automatic: 1 },
    operations: { evaluator: {} } })}\n`);
  fs.writeFileSync(path.join(newRoot, "raw-case-results.tsv"),
    "case_id\tstratum\treviewer_mode\tfacts\nH001\tautomatic\tautomatic_sol_high\t1\n");
  fs.writeFileSync(path.join(newRoot, "raw-claim-assessments.tsv"),
    "case_id\tclaim_id\tfield_type\tvalue_json\texactSupport\tcitedSourceSupport\treason\n"
    + "H001\tclaim:p0:phone:0\tphone\t555-0100\texact\texact\tnew\n");
  fs.writeFileSync(path.join(newRoot, "raw-critical-findings.tsv"),
    "case_id\tfinding_json\n");
  childProcess.execFileSync(process.execPath,
    [path.join(__dirname, "compare_corrected_holdout_evaluators.js")], { env: { ...process.env,
      ALLOW_HISTORICAL_REPRODUCTION: "YES",
      OLD_ANALYSIS_ROOT: oldRoot, NEW_ANALYSIS_ROOT: newRoot, OUTPUT_ROOT: outputRoot } });
  const summary = JSON.parse(fs.readFileSync(path.join(outputRoot, "summary.json"), "utf8"));
  assert.equal(summary.matching.claimsPresentInBoth, 1);
  assert.equal(summary.matching.claimsWithAnyAxisChange, 1);
  assert.equal(summary.matching.axisChangedClaims.exactSupport, 1);
  assert.match(fs.readFileSync(path.join(outputRoot, "claim-differences.tsv"), "utf8"),
    /old_exactSupport\tnew_exactSupport/);
  process.stdout.write("corrected holdout evaluator comparison tests passed\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

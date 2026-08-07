#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const text = fs.readFileSync(path.join(__dirname, "POST_REFETCH_EXECUTION_RUNBOOK.md"), "utf8");
for (const stage of ["evidence-dry", "evidence-live", "materialize", "verify-packets",
  "atomic-dry", "atomic-live", "synthesis-dry", "synthesis-live", "manual-audit",
  "manual-prepare", "manual-seal", "compile"]) assert.match(text, new RegExp(`\\b${stage}\\b`));
assert.match(text, /UNIFIED_EVALUATOR_RUNNER\.md/);
assert.match(text, /Do not invoke component scripts directly/);
assert.doesNotMatch(text, /node (?:run_atomic_evaluator|run_bounded_synthesis|compile_corrected_campaign)\.js/);

process.stdout.write("post-refetch unified-runner documentation tests passed\n");

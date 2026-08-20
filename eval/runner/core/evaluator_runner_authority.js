#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const AUTHORITY_FILES = Object.freeze([
  "evaluator_runner_authority.js",
  "evaluator_runner_guard.js",
  "run_evaluator_campaign.js",
  "collect_evidence.js",
  "resume_evidence.js",
  "evidence_collector.js",
  "public_url_canonicalizer.js",
  "synthesis_protocol.js",
  "source_ingestion.js",
  "verify_campaign.js",
  "run_atomic_evaluator.js",
  "run_bounded_synthesis.js",
  "transport_error_trace.js",
  "manual_review_harness.js",
  "audit_identical_input_consistency.js",
  "evaluator_packet_planner.js",
  "synthesis_judge_schema.js",
  "atomic_judge_schema.js",
  "categorical_judge_schema_v11.js",
  "categorical_judge_schema_v9.js",
  "categorical_judge_schema_v8.js",
  "compile_campaign.js",
  "materialize_packets.js",
  "format_aware_source_normalizer.js",
  "source_format_policy.js",
  "format_aware_workbook.py",
  "usage_accounting.js",
  "run_production_campaign.js"
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const authorityDigest = (files) => {
  const logicalFiles = files.map(({ name, sha256: fileSha256, byteLength }) => ({
    name, sha256: fileSha256, byteLength
  }));
  const core = { schemaVersion: 2, authority: "unified_provider_evaluator", files: logicalFiles };
  return { core, authoritySha256: sha256(JSON.stringify(core)) };
};
const logicalAuthority = (value) => ({
  schemaVersion: value?.schemaVersion,
  authority: value?.authority,
  files: (value?.files || []).map(({ name, sha256: fileSha256, byteLength }) => ({
    name, sha256: fileSha256, byteLength
  })),
  authoritySha256: value?.authoritySha256
});
const sameEvaluatorAuthority = (left, right) => JSON.stringify(logicalAuthority(left))
  === JSON.stringify(logicalAuthority(right));

const evaluatorRunnerAuthority = (root = __dirname, authorityFiles = AUTHORITY_FILES) => {
  const files = authorityFiles.map((name) => {
    const file = path.resolve(root, name);
    if (!fs.existsSync(file)) throw new Error(`Unified evaluator authority file is missing: ${file}`);
    const body = fs.readFileSync(file);
    return { name, path: file, sha256: sha256(body), byteLength: body.length };
  });
  const digest = authorityDigest(files);
  return { schemaVersion: digest.core.schemaVersion, authority: digest.core.authority,
    files, authoritySha256: digest.authoritySha256 };
};

if (require.main === module) process.stdout.write(`${JSON.stringify(evaluatorRunnerAuthority(), null, 2)}\n`);

module.exports = { AUTHORITY_FILES, authorityDigest, evaluatorRunnerAuthority, logicalAuthority,
  sameEvaluatorAuthority };

#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const AUTHORITY_FILES = Object.freeze([
  "evaluator_runner_authority.js",
  "evaluator_runner_guard.js",
  "run_evaluator_campaign.js",
  "collect_format_aware_evidence_v4.js",
  "resume_format_aware_evidence_v4.js",
  "../provider-d-series-2026-07-31/generated/collect_d_evidence_v7.js",
  "../provider-d-series-2026-07-31/generated/public_url_canonicalizer.js",
  "../provider-d-series-2026-07-31/scripts/d_synthesis_protocol.js",
  "../provider-final-experiment-2026-07-30/scripts/full_source_ingestion_v6.js",
  "verify_post_refetch_campaign.js",
  "run_atomic_evaluator.js",
  "run_bounded_synthesis.js",
  "transport_error_trace.js",
  "manual_review_harness.js",
  "audit_identical_input_consistency.js",
  "evaluator_packet_planner.js",
  "categorical_judge_schema_v13_bounded_synthesis_axes.js",
  "../provider-d-series-2026-07-31/frozen-v14/categorical_judge_schema_v12_whole_page_support.js",
  "compile_corrected_campaign.js",
  "materialize_format_aware_packets_v4.js",
  "format_aware_source_normalizer.js",
  "source_format_policy.js",
  "format_aware_workbook.py"
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

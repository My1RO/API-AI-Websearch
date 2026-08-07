#!/usr/bin/env node
"use strict";

// Offline-only compatibility view for a successfully fetched binary whose
// semantic converter is unavailable. This never converts or extracts the
// body and never makes it judge-readable. It preserves the requested URL,
// fetch metadata, raw artifact descriptor/body, and original error while
// changing only the evaluator disposition to metadata-only unavailable.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJsonExclusive = (file, value) => fs.writeFileSync(file,
  `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const writeJsonReplace = (file, value) => fs.writeFileSync(file,
  `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const [sourceBaseArg, targetBaseArg, armId, caseId, sourceId] = process.argv.slice(2);
assert(sourceBaseArg && targetBaseArg && armId && caseId && sourceId,
  "Usage: adapt_unconvertible_binary_evidence.js SOURCE_BASE TARGET_BASE ARM_ID CASE_ID SOURCE_ID");
const sourceBase = path.resolve(sourceBaseArg);
const targetBase = path.resolve(targetBaseArg);
assert(sourceBase !== targetBase, "Compatibility view must use a fresh target base.");
assert(fs.existsSync(sourceBase), "Source evidence base does not exist.");
assert(!fs.existsSync(targetBase), "Compatibility target must be fresh.");

fs.cpSync(sourceBase, targetBase, { recursive: true, force: false, errorOnExist: true,
  mode: fs.constants.COPYFILE_FICLONE });

const armRoot = path.join(targetBase, `${armId}-format-aware-evidence-v4`);
const sourceFile = path.join(armRoot, "cells", armId, caseId, "sources.json");
const summaryFile = path.join(armRoot, "summary.json");
const readinessFile = path.join(armRoot, "NORMALIZATION_READY.json");
assert(fs.existsSync(sourceFile) && fs.existsSync(summaryFile), "Target arm evidence is incomplete.");
assert(!fs.existsSync(readinessFile), "Invalid arm unexpectedly already has a readiness seal.");

const sourceFileBefore = fs.readFileSync(sourceFile);
const summaryBefore = fs.readFileSync(summaryFile);
const cell = JSON.parse(sourceFileBefore.toString("utf8"));
const index = cell.sources.findIndex((row) => row.sourceId === sourceId);
assert(index >= 0, "Requested compatibility source is absent from the bound cell.");
const original = cell.sources[index];
assert(original.outcome === "normalization_error", "Source is not a normalization_error.");
assert(original.httpStatus >= 200 && original.httpStatus < 300, "Binary fetch was not successful.");
assert(original.rawBodyArtifact && !original.normalizedTextArtifact,
  "Compatibility requires retained raw bytes and no normalized text.");
assert(/WORKBOOK_CONVERTER_UNAVAILABLE:\.xls\b/.test(String(original.error || "")),
  "Compatibility source is not the admitted legacy .xls converter-unavailable case.");
const rawFile = path.join(armRoot, original.rawBodyArtifact.path);
const rawBody = fs.readFileSync(rawFile);
assert(rawBody.length === original.rawBodyArtifact.byteLength
  && sha256(rawBody) === original.rawBodyArtifact.sha256,
"Retained raw binary differs from its immutable descriptor.");

const adapted = {
  ...original,
  creditEligible: false,
  semanticExtraction: {
    extractionMode: "metadata_only_binary_unavailable",
    normalizationFormat: "legacy_xls_converter_unavailable",
    evidenceTextChars: 0,
    manualReviewSignals: []
  },
  outcome: "binary_unavailable",
  retentionClass: "metadata_only_binary_unavailable_no_credit",
  compatibilityDisposition: {
    schemaVersion: 1,
    policy: "no_semantic_conversion_or_llm_extraction",
    originalOutcome: original.outcome,
    originalError: original.error,
    rawArtifactPreserved: true,
    normalizedContentDelivered: false,
    creditEligible: false
  }
};
cell.sources[index] = adapted;
writeJsonReplace(sourceFile, cell);

const summary = JSON.parse(summaryBefore.toString("utf8"));
assert(summary.invalidNormalizationCount === 1
  && summary.invalidNormalizations?.length === 1
  && summary.invalidNormalizations[0].sourceId === sourceId,
"Summary does not bind exactly the expected invalid normalization.");
summary.outcomes = { ...summary.outcomes,
  binary_unavailable: (summary.outcomes.binary_unavailable || 0) + 1 };
delete summary.outcomes.normalization_error;
summary.invalidNormalizationCount = 0;
summary.invalidNormalizations = [];
summary.compatibilityAdaptation = {
  schemaVersion: 1,
  type: "unconvertible_binary_metadata_only_no_credit",
  armId,
  caseId,
  sourceId,
  requestedUrl: original.requestedUrl,
  originalOutcome: original.outcome,
  originalError: original.error,
  rawBodyArtifact: original.rawBodyArtifact,
  normalizedTextArtifact: null,
  semanticExtractionAttemptedByAdapter: false,
  paidCallsMade: 0,
  networkCallsMade: 0
};
writeJsonReplace(summaryFile, summary);
writeJsonExclusive(readinessFile, {
  schemaVersion: 1,
  status: "zero_invalid_normalizations",
  summarySha256: sha256(JSON.stringify(summary)),
  producerAuthoritySha256: summary.runnerAuthority.authoritySha256,
  compatibilityAdapter: "unconvertible_binary_metadata_only_no_credit"
});

const sourceFileAfter = fs.readFileSync(sourceFile);
const summaryAfter = fs.readFileSync(summaryFile);
const ledger = {
  schemaVersion: 1,
  status: "OFFLINE_COMPATIBILITY_VIEW_CREATED",
  sourceEvidenceBase: sourceBase,
  targetEvidenceBase: targetBase,
  armId,
  caseId,
  sourceId,
  requestedUrl: original.requestedUrl,
  sourceCellBeforeSha256: sha256(sourceFileBefore),
  sourceCellAfterSha256: sha256(sourceFileAfter),
  summaryBeforeSha256: sha256(summaryBefore),
  summaryAfterSha256: sha256(summaryAfter),
  rawBodyArtifact: original.rawBodyArtifact,
  rawBodyVerifiedSha256: sha256(rawBody),
  originalError: original.error,
  transformation: "normalization_error_to_metadata_only_binary_unavailable_no_credit",
  semanticExtractionAttempted: false,
  manualReviewRequired: true,
  manualReviewReason: "UNCONVERTIBLE_BINARY_NO_CREDIT",
  originalEvidenceModified: false,
  paidCallsMade: 0,
  networkCallsMade: 0
};
writeJsonExclusive(path.join(targetBase, "UNCONVERTIBLE_BINARY_COMPATIBILITY_LEDGER.json"), ledger);
process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);

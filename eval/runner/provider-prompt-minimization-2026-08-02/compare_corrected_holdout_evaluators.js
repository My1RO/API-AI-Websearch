#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const AXES = ["exactSupport", "citedSourceSupport", "identityLink", "locationLink",
  "displaySafety", "recency", "fieldValidity", "sourceEligibility", "crossNpiConflict",
  "requestedNpiResolution", "providerIdentitySpanFidelity", "factSpanFidelity",
  "explicitDateSpanFidelity"];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const tsvCell = (value) => String(value == null ? "" : typeof value === "string" ? value : JSON.stringify(value))
  .replace(/[\t\r\n]+/g, " ");
const readTsv = (file) => {
  const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
  const header = lines.shift().split("\t");
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split("\t")
    .map((value, index) => [header[index], value])));
};
const writeTsv = (file, header, rows) => fs.writeFileSync(file,
  `${[header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\n")}\n`);
const counts = (values) => Object.fromEntries([...new Set(values)].sort()
  .map((value) => [value, values.filter((item) => item === value).length]));
const descriptor = (file) => { const body = fs.readFileSync(file);
  return { path: path.resolve(file), sha256: sha256(body), byteLength: body.length }; };

const main = () => {
  if (process.env.ALLOW_HISTORICAL_REPRODUCTION !== "YES") {
    throw new Error("compare_corrected_holdout_evaluators.js requires ALLOW_HISTORICAL_REPRODUCTION=YES.");
  }
  const oldRoot = path.resolve(process.env.OLD_ANALYSIS_ROOT || "");
  const newRoot = path.resolve(process.env.NEW_ANALYSIS_ROOT || "");
  const outputRoot = path.resolve(process.env.OUTPUT_ROOT || "");
  if (!oldRoot || !newRoot || !outputRoot) throw new Error(
    "OLD_ANALYSIS_ROOT, NEW_ANALYSIS_ROOT, and OUTPUT_ROOT are required.");
  if (fs.existsSync(outputRoot)) throw new Error("OUTPUT_ROOT must be fresh.");
  fs.mkdirSync(outputRoot, { recursive: true });

  const oldResultsFile = path.join(oldRoot, "holdout-validation-results.json");
  const oldAuditFile = path.join(oldRoot, "manual-trace-audit.json");
  const newSummaryFile = path.join(newRoot, "summary.json");
  const newCasesFile = path.join(newRoot, "raw-case-results.tsv");
  const newClaimsFile = path.join(newRoot, "raw-claim-assessments.tsv");
  const newCriticalFile = path.join(newRoot, "raw-critical-findings.tsv");
  const oldRows = readJson(oldResultsFile);
  const oldAudit = readJson(oldAuditFile);
  const newSummary = readJson(newSummaryFile);
  const newCaseRows = readTsv(newCasesFile);
  const newClaimRows = readTsv(newClaimsFile);
  const newCriticalRows = readTsv(newCriticalFile);
  const oldByCase = new Map(oldRows.map((row) => [row.caseId, row]));
  const newByCase = new Map(newCaseRows.map((row) => [row.case_id, row]));
  const oldClaims = oldRows.flatMap((row) => (row.categorical?.claimAssessments || [])
    .map((claim) => ({ ...claim, caseId: row.caseId })));
  const oldClaimMap = new Map(oldClaims.map((claim) => [`${claim.caseId}:${claim.claimId}`, claim]));
  const newClaimMap = new Map(newClaimRows.map((claim) => [`${claim.case_id}:${claim.claim_id}`, claim]));
  const claimKeys = [...new Set([...oldClaimMap.keys(), ...newClaimMap.keys()])].sort();
  const claimDiffRows = claimKeys.map((key) => {
    const oldClaim = oldClaimMap.get(key); const newClaim = newClaimMap.get(key);
    const [caseId, ...claimIdParts] = key.split(":"); const claimId = claimIdParts.join(":");
    const changedAxes = AXES.filter((axis) => (oldClaim?.[axis] || "missing")
      !== (newClaim?.[axis] || "missing"));
    return { caseId, claimId, fieldType: newClaim?.field_type || oldClaim?.fieldType || null,
      value: newClaim?.value_json || null, oldPresent: Boolean(oldClaim), newPresent: Boolean(newClaim),
      changedAxes, oldClaim, newClaim };
  });
  const newCriticalByCase = new Map();
  for (const row of newCriticalRows) {
    if (!newCriticalByCase.has(row.case_id)) newCriticalByCase.set(row.case_id, []);
    newCriticalByCase.get(row.case_id).push(row.finding_json);
  }
  const caseIds = [...new Set([...oldByCase.keys(), ...newByCase.keys()])].sort();
  const caseDiffRows = caseIds.map((caseId) => {
    const oldRow = oldByCase.get(caseId); const newRow = newByCase.get(caseId);
    const changedClaims = claimDiffRows.filter((row) => row.caseId === caseId && row.changedAxes.length);
    const oldCritical = oldRow?.criticalFailures || [];
    const newCritical = newCriticalByCase.get(caseId) || [];
    return { caseId, oldStatus: oldRow?.evaluationStatus || "missing",
      newStratum: newRow?.stratum || "missing", newReviewerMode: newRow?.reviewer_mode || "",
      oldClaimCount: (oldRow?.categorical?.claimAssessments || []).length,
      newClaimCount: Number(newRow?.facts || 0), changedClaimCount: changedClaims.length,
      changedAxes: [...new Set(changedClaims.flatMap((row) => row.changedAxes))].sort(),
      oldCritical, newCritical,
      materialChange: (oldRow?.evaluationStatus || "missing") !== "evaluable"
        || changedClaims.length > 0 || oldCritical.length > 0 || newCritical.length > 0 };
  });
  const oldAxisCounts = Object.fromEntries(AXES.map((axis) => [axis, counts(oldClaims.map((row) => row[axis] || "missing"))]));
  const newAxisCounts = Object.fromEntries(AXES.map((axis) => [axis, counts(newClaimRows.map((row) => row[axis] || "missing"))]));
  const axisChangedClaims = Object.fromEntries(AXES.map((axis) => [axis, claimDiffRows.filter((row) =>
    row.oldPresent && row.newPresent && row.changedAxes.includes(axis)).length]));
  const summary = { schemaVersion: 1, comparison:
    "historical_broken_evaluator_vs_corrected_complete_evaluator_stack",
    caveat: "Production outputs and URL sets are frozen, but the corrected format-aware snapshots were collected after the historical snapshots; changed traces must be checked for page drift.",
    historical: { cases: oldRows.length,
      evaluableCases: oldRows.filter((row) => row.evaluationStatus === "evaluable").length,
      claims: oldClaims.length, axisCounts: oldAxisCounts,
      additiveManualAudit: oldAudit },
    corrected: { cases: newCaseRows.length, claims: newClaimRows.length,
      strata: newSummary.strata, axisCounts: newAxisCounts,
      evaluatorOperations: newSummary.operations?.evaluator || null },
    matching: { unionClaims: claimDiffRows.length,
      claimsPresentInBoth: claimDiffRows.filter((row) => row.oldPresent && row.newPresent).length,
      oldOnlyClaims: claimDiffRows.filter((row) => row.oldPresent && !row.newPresent).length,
      newOnlyClaims: claimDiffRows.filter((row) => !row.oldPresent && row.newPresent).length,
      claimsWithAnyAxisChange: claimDiffRows.filter((row) => row.changedAxes.length).length,
      axisChangedClaims },
    materialChangedCases: caseDiffRows.filter((row) => row.materialChange).map((row) => row.caseId),
    inputs: [oldResultsFile, oldAuditFile, newSummaryFile, newCasesFile, newClaimsFile, newCriticalFile]
      .map(descriptor) };
  fs.writeFileSync(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeTsv(path.join(outputRoot, "case-differences.tsv"), ["case_id", "old_status", "new_stratum",
    "new_reviewer_mode", "old_claims", "new_claims", "changed_claims", "changed_axes_json",
    "old_critical_json", "new_critical_json", "material_change"], caseDiffRows.map((row) => [row.caseId,
    row.oldStatus, row.newStratum, row.newReviewerMode, row.oldClaimCount, row.newClaimCount,
    row.changedClaimCount, row.changedAxes, row.oldCritical, row.newCritical, row.materialChange]));
  writeTsv(path.join(outputRoot, "claim-differences.tsv"), ["case_id", "claim_id", "field_type",
    "value_json", "old_present", "new_present", "changed_axes_json", ...AXES.flatMap((axis) =>
      [`old_${axis}`, `new_${axis}`]), "old_reason", "new_reason"], claimDiffRows.map((row) => [row.caseId,
    row.claimId, row.fieldType, row.value, row.oldPresent, row.newPresent, row.changedAxes,
    ...AXES.flatMap((axis) => [row.oldClaim?.[axis], row.newClaim?.[axis]]),
    row.oldClaim?.reason, row.newClaim?.reason]));
  const outputs = ["summary.json", "case-differences.tsv", "claim-differences.tsv"]
    .map((name) => descriptor(path.join(outputRoot, name)));
  const completion = { schemaVersion: 1, status: "CORRECTED_HOLDOUT_EVALUATOR_COMPARISON_COMPLETE",
    noNetworkOrModelCalls: true, noAggregateScore: true, outputs };
  completion.sealSha256 = sha256(JSON.stringify(completion));
  fs.writeFileSync(path.join(outputRoot, "COMPARISON_COMPLETE.json"), `${JSON.stringify(completion, null, 2)}\n`);
};

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { AXES, counts, readTsv };

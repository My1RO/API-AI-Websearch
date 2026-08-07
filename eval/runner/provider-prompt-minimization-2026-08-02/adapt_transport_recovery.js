#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeExclusive = (file, value) => fs.writeFileSync(file,
  `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const artifactFile = (root, armId, caseId) => path.join(root, "cells", armId, caseId, "artifact.json");
const isTransportExhaustion = (artifact) => Boolean(artifact.error)
  && !(artifact.rawResponses || []).length
  && (artifact.sends || []).length > 0
  && artifact.sends.every((send) => send.status == null && send.raw == null && send.error);
const usageTotals = (rows) => ({
  rows: rows.length,
  profiles: rows.filter((row) => (row.finalProfiles || []).length > 0).length,
  inputTokens: rows.reduce((sum, row) => sum + (row.usage || [])
    .reduce((inner, usage) => inner + (usage.inputTokens || 0), 0), 0),
  cachedInputTokens: rows.reduce((sum, row) => sum + (row.usage || [])
    .reduce((inner, usage) => inner + (usage.cachedInputTokens || 0), 0), 0),
  outputTokens: rows.reduce((sum, row) => sum + (row.usage || [])
    .reduce((inner, usage) => inner + (usage.outputTokens || 0), 0), 0),
  searches: rows.reduce((sum, row) => sum + (row.usage || [])
    .reduce((inner, usage) => inner + (usage.webSearchCalls || 0), 0), 0),
  estimatedCostUsd: rows.reduce((sum, row) => sum + (row.usage || [])
    .reduce((inner, usage) => inner + (usage.totalUsd || 0), 0), 0)
});

const adaptTransportRecovery = ({ primaryRoot, recoveryRoot, outputRoot, armId, caseIds }) => {
  for (const [label, root] of Object.entries({ primaryRoot, recoveryRoot })) {
    if (!path.isAbsolute(root) || !fs.existsSync(root)) throw new Error(`${label} must be an existing absolute path.`);
  }
  if (!path.isAbsolute(outputRoot) || fs.existsSync(outputRoot)) {
    throw new Error("outputRoot must be a fresh absolute path.");
  }
  if (!armId || !caseIds.length || new Set(caseIds).size !== caseIds.length) {
    throw new Error("armId and unique recovery caseIds are required.");
  }
  fs.cpSync(primaryRoot, outputRoot, { recursive: true, errorOnExist: true, force: false });
  const historyRoot = path.join(outputRoot, "transport-recovery-history");
  fs.mkdirSync(historyRoot, { recursive: true, mode: 0o700 });
  const replacements = [];
  for (const caseId of caseIds) {
    const primaryFile = artifactFile(primaryRoot, armId, caseId);
    const recoveryFile = artifactFile(recoveryRoot, armId, caseId);
    const outputFile = artifactFile(outputRoot, armId, caseId);
    if (!fs.existsSync(primaryFile) || !fs.existsSync(recoveryFile) || !fs.existsSync(outputFile)) {
      throw new Error(`Recovery artifact set is incomplete for ${armId}/${caseId}.`);
    }
    const primary = readJson(primaryFile);
    const recovery = readJson(recoveryFile);
    if (!isTransportExhaustion(primary)) throw new Error(`Primary outcome is not transport exhaustion: ${armId}/${caseId}`);
    if (recovery.error || !(recovery.rawResponses || []).length) {
      throw new Error(`Recovery outcome is not a completed response: ${armId}/${caseId}`);
    }
    for (const field of ["armId", "caseId", "armCommit"]) {
      if (primary[field] !== recovery[field]) throw new Error(`Recovery ${field} mismatch: ${armId}/${caseId}`);
    }
    if (stableJson(primary.input) !== stableJson(recovery.input)
      || stableJson(primary.cmsBaseline) !== stableJson(recovery.cmsBaseline)
      || stableJson(primary.strata) !== stableJson(recovery.strata)
      || stableJson(primary.expectedInitialRequest) !== stableJson(recovery.expectedInitialRequest)) {
      throw new Error(`Recovery request/context mismatch: ${armId}/${caseId}`);
    }
    const primaryHistoryFile = path.join(historyRoot, `${caseId}-primary-transport-failure.json`);
    fs.copyFileSync(primaryFile, primaryHistoryFile, fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(recoveryFile, outputFile);
    replacements.push({
      armId, caseId,
      primaryArtifactSha256: sha256(fs.readFileSync(primaryFile)),
      primaryTransportAttempts: primary.sends.length,
      primaryTransportErrors: primary.sends.map((send) => send.error),
      recoveryArtifactSha256: sha256(fs.readFileSync(recoveryFile)),
      recoveryHttpSends: recovery.sends.length,
      outputArtifactSha256: sha256(fs.readFileSync(outputFile)),
      primaryHistoryArtifact: path.relative(outputRoot, primaryHistoryFile)
    });
  }
  const cellRoot = path.join(outputRoot, "cells", armId);
  const rows = fs.readdirSync(cellRoot).sort().map((caseId) => readJson(path.join(cellRoot, caseId, "artifact.json")));
  const summary = {
    rows: rows.length,
    successes: rows.filter((row) => !row.error).length,
    errors: rows.filter((row) => row.error).map(({ armId: rowArmId, caseId, error }) => ({
      armId: rowArmId, caseId, error
    })),
    arms: { [armId]: usageTotals(rows) },
    transportRecovery: { caseIds, replacementCount: replacements.length }
  };
  const originalSummary = path.join(outputRoot, "summary.json");
  const primarySummaryHistory = path.join(historyRoot, "primary-summary.json");
  fs.renameSync(originalSummary, primarySummaryHistory);
  writeExclusive(originalSummary, summary);
  const manifest = {
    schemaVersion: 1,
    status: "TRANSPORT_RECOVERY_ADAPTED",
    policy: "replace_only_trace_proven_transport_exhaustion_with_exact_request_recovery",
    primaryRoot,
    recoveryRoot,
    outputRoot,
    armId,
    caseIds,
    replacements,
    primarySummarySha256: sha256(fs.readFileSync(primarySummaryHistory)),
    adaptedSummarySha256: sha256(fs.readFileSync(originalSummary)),
    outputArtifactSetSha256: sha256(stableJson(rows.map((row) => [row.caseId,
      sha256(fs.readFileSync(artifactFile(outputRoot, armId, row.caseId)))])))
  };
  writeExclusive(path.join(outputRoot, "TRANSPORT_RECOVERY_ADAPTED.json"), manifest);
  return manifest;
};

const main = () => {
  const primaryRoot = path.resolve(process.env.PRIMARY_ROOT || "");
  const recoveryRoot = path.resolve(process.env.RECOVERY_ROOT || "");
  const outputRoot = path.resolve(process.env.OUTPUT_ROOT || "");
  const armId = process.env.ARM_ID || "";
  const caseIds = (process.env.RECOVERY_CASE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const result = adaptTransportRecovery({ primaryRoot, recoveryRoot, outputRoot, armId, caseIds });
  process.stdout.write(`${JSON.stringify({ ...result, replacements: result.replacements.length }, null, 2)}\n`);
};

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { adaptTransportRecovery, isTransportExhaustion, usageTotals };

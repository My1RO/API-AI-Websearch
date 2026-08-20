#!/usr/bin/env node
"use strict";

// Deterministic evaluator-quality audit. It never chooses a semantic category:
// when the fixed judge assigns different own-citation/span categories to
// literally identical claim, source snapshot, and submitted spans, the whole
// provider is routed to the paired blinded-manual protocol.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const AXES = Object.freeze([
  "citedSourceSupport",
  "providerIdentitySpanFidelity",
  "factSpanFidelity",
  "explicitDateSpanFidelity"
]);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableObject = (value) => Array.isArray(value) ? value.map(stableObject)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
    : value;
const stable = (value) => JSON.stringify(stableObject(value));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
};

const discover = (packetRoot) => {
  const cells = [];
  for (const armId of fs.readdirSync(packetRoot).sort()) {
    const armRoot = path.join(packetRoot, armId);
    if (!fs.statSync(armRoot).isDirectory()) continue;
    for (const caseId of fs.readdirSync(armRoot).sort()) {
      const packetFile = path.join(armRoot, caseId, "packet.json");
      if (fs.existsSync(packetFile)) cells.push({ armId, caseId, packetFile });
    }
  }
  return cells;
};

const sourceSnapshotKey = (source) => ({
  bodySha256: source.bodySha256 || source.fullTextSha256
    || sha256(source.deliveredContent || ""),
  hostReadStatus: source.hostReadStatus || null,
  snapshotCoverage: source.snapshotCoverage || null,
  normalizationFormat: source.normalizationFormat || null
});
const normalizedClaimValue = (claim) => {
  const value = claim.value;
  if (claim.fieldType === "phone") return String(value?.value ?? value ?? "").replace(/\D/g, "");
  if (claim.fieldType === "website") return String(value?.value ?? value ?? "").trim().toLowerCase()
    .replace(/^http:/, "https:").replace(/\/$/, "");
  if (value && typeof value === "object") {
    return Object.values(value).map((part) => String(part ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""))
      .join("|");
  }
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
};

const audit = ({ packetRoot, synthesisRoot }) => {
  const cells = discover(packetRoot);
  const armIds = [...new Set(cells.map((cell) => cell.armId))].sort();
  const caseIds = [...new Set(cells.map((cell) => cell.caseId))].sort();
  const groups = new Map();
  for (const cell of cells) {
    const parsedFile = path.join(synthesisRoot, "cells", cell.armId, cell.caseId, "parsed-v14.json");
    if (!fs.existsSync(parsedFile)) continue;
    const packet = JSON.parse(fs.readFileSync(cell.packetFile, "utf8"));
    const parsed = JSON.parse(fs.readFileSync(parsedFile, "utf8"));
    if (packet.claims.length !== parsed.claimAssessments.length) {
      throw new Error(`Claim cardinality differs for ${cell.armId}/${cell.caseId}.`);
    }
    packet.claims.forEach((claim, claimIndex) => {
      const source = packet.sources.find((item) => item.sourceId === claim.sourceId);
      if (!source) throw new Error(`Claim source is missing for ${cell.armId}/${cell.caseId}/${claimIndex}.`);
      const keyObject = {
        caseId: cell.caseId,
        fieldType: claim.fieldType,
        normalizedValue: normalizedClaimValue(claim),
        source: sourceSnapshotKey(source),
        submittedSpans: {
          providerIdentitySpan: claim.modelCitation?.providerIdentitySpan || null,
          factSpan: claim.modelCitation?.factSpan || null,
          explicitFactDateSpan: claim.modelCitation?.explicitFactDateSpan || null
        }
      };
      const key = sha256(stable(keyObject));
      const rows = groups.get(key) || { key, keyObject, readings: [] };
      rows.readings.push({ armId: cell.armId, claimIndex,
        categories: Object.fromEntries(AXES.map((axis) => [axis, parsed.claimAssessments[claimIndex][axis]])) });
      groups.set(key, rows);
    });
  }
  const disagreements = [];
  for (const group of groups.values()) {
    if (group.readings.length < 2) continue;
    const axes = AXES.filter((axis) => new Set(group.readings.map((row) => row.categories[axis])).size > 1);
    if (axes.length) disagreements.push({ groupSha256: group.key, caseId: group.keyObject.caseId,
      fieldType: group.keyObject.fieldType, axes, readings: group.readings });
  }
  disagreements.sort((left, right) => left.caseId.localeCompare(right.caseId)
    || left.groupSha256.localeCompare(right.groupSha256));
  const disagreementCaseIds = [...new Set(disagreements.map((row) => row.caseId))].sort();
  return { schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
    runnerAuthority: evaluatorRunnerAuthority(__dirname),
    disposition: "paired_identical_input_categorical_disagreement",
    policy: "no_semantic_category_selected_identical_fixed_input_disagreement_routes_whole_provider",
    axes: AXES, armIds, caseIds, disagreementCaseIds, disagreements,
    cells: disagreementCaseIds.flatMap((caseId) => armIds.map((armId) => ({
      armId, caseId, reason: "IDENTICAL_INPUT_CATEGORICAL_DISAGREEMENT"
    }))) };
};

const main = () => {
  const packetRoot = process.env.PACKET_ROOT;
  const synthesisRoot = process.env.SYNTHESIS_ROOT;
  const outputFile = process.env.OUTPUT_FILE;
  if (!packetRoot || !synthesisRoot || !outputFile) {
    throw new Error("PACKET_ROOT, SYNTHESIS_ROOT, and OUTPUT_FILE are required.");
  }
  const result = audit({ packetRoot, synthesisRoot });
  writeJson(outputFile, { ...result, caseIds: result.disagreementCaseIds });
  process.stdout.write(`${JSON.stringify({ caseIds: result.disagreementCaseIds,
    disagreementGroups: result.disagreements.length, cells: result.cells.length })}\n`);
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { AXES, audit, normalizedClaimValue, sourceSnapshotKey };

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const planner = require("./evaluator_packet_planner.js");
const { INSTRUCTIONS: FIXED_CATEGORICAL_INSTRUCTIONS } = require("./run_bounded_synthesis.js");
const { evaluatorRunnerAuthority, sameEvaluatorAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const WORKSPACE = process.env.EDE_SHARED_WORKSPACE || "/Users/kui/lucie/EDE";
const SCHEMA_FILE = path.join(__dirname,
  "categorical_judge_schema_v13_bounded_synthesis_axes.js");
const TRIGGER_CODES = new Set([
  "NO_EXACT_REQUESTED_NPI_IN_RECOGNIZED_NPI_COLUMN",
  "REQUESTED_NPI_OUTSIDE_RECOGNIZED_TABLE_REGION",
  "MULTIPLE_DISTINCT_NPI_IDENTITY_MATCHES",
  "BOUNDED_SYNTHESIS_CONTEXT_OVERFLOW",
  "AMBIGUOUS_WORKBOOK_RECORD_BOUNDARY",
  "MERGED_CELL_RECORD_BOUNDARY",
  "CONTINUATION_ROW_RECORD_BOUNDARY",
  "UNMODELED_DISPLAY_FORMAT_NEEDED",
  "HYPERLINK_OR_COMMENT_NEEDED",
  "ENCRYPTED_CORRUPT_OR_IMAGE_ONLY_SOURCE",
  "ATOMIC_ASSESSMENT_ROW_BUDGET_EXCEEDED",
  "OVERSIZED_JSON_LD_REQUIRES_MANUAL_REVIEW",
  "EVALUATOR_MAX_OUTPUT_TOKENS",
  "EVALUATOR_CONTENT_FILTER",
  "EVALUATOR_INCOMPLETE_RESPONSE",
  "EVALUATOR_REFUSAL",
  "EVALUATOR_MALFORMED_OUTPUT",
  "EVALUATOR_TRANSPORT_FAILURE",
  "IDENTICAL_INPUT_CATEGORICAL_DISAGREEMENT"
]);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeExclusive = (file, value, mode = 0o600) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode });
};
const hmac = (seed, value, length = 16) => crypto.createHmac("sha256", seed)
  .update(value).digest("hex").slice(0, length);
const fileAudit = (file) => ({ path: file, sha256: sha256(fs.readFileSync(file)),
  byteLength: fs.statSync(file).size });
const resolveWithin = (root, relative, label) => {
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, relative || "");
  if (!file.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(file)) {
    throw new Error(`${label} is missing or escapes its review unit.`);
  }
  return file;
};

const discover = (root) => {
  const cells = [];
  for (const armId of fs.readdirSync(root).sort()) {
    const armRoot = path.join(root, armId);
    if (!fs.statSync(armRoot).isDirectory()) continue;
    for (const caseId of fs.readdirSync(armRoot).sort()) {
      const file = path.join(armRoot, caseId, "packet.json");
      if (fs.existsSync(file)) cells.push({ armId, caseId, file, packet: readJson(file) });
    }
  }
  return cells;
};

const assertCombinedCampaign = (cells, expectedArms, expectedCasesPerArm) => {
  const arms = [...new Set(cells.map((cell) => cell.armId))].sort();
  const sortedExpected = [...expectedArms].sort();
  if (stableJson(arms) !== stableJson(sortedExpected)) throw new Error("Combined campaign arm set mismatch.");
  const referenceCases = [...new Set(cells.filter((cell) => cell.armId === sortedExpected[0])
    .map((cell) => cell.caseId))].sort();
  if (referenceCases.length !== expectedCasesPerArm) throw new Error("Combined campaign case cardinality mismatch.");
  for (const armId of sortedExpected) {
    const cases = cells.filter((cell) => cell.armId === armId).map((cell) => cell.caseId).sort();
    if (stableJson(cases) !== stableJson(referenceCases)) {
      throw new Error(`Arm ${armId} does not have the exact common case set.`);
    }
  }
  return referenceCases.map((caseId) => {
    const requests = cells.filter((cell) => cell.caseId === caseId)
      .map((cell) => ({ armId: cell.armId, request: cell.packet.identityContext?.request,
        requestSha256: sha256(stableJson(cell.packet.identityContext?.request)),
        fixedContextSha256: sha256(stableJson(cell.packet.identityContext)) }));
    if (new Set(requests.map((row) => row.requestSha256)).size !== 1) {
      throw new Error(`Compared arms do not share the exact request payload for ${caseId}.`);
    }
    if (new Set(requests.map((row) => row.fixedContextSha256)).size !== 1) {
      throw new Error(`Compared arms do not share fixed CMS/NPPES identity context for ${caseId}.`);
    }
    return { caseId, requestSha256: requests[0].requestSha256,
      fixedContextSha256: requests[0].fixedContextSha256 };
  });
};

const triggerCases = (triggerFiles, cells) => {
  const knownCases = new Set(cells.map((cell) => cell.caseId));
  const triggers = new Map();
  for (const file of triggerFiles) {
    const artifact = readJson(file);
    for (const entry of artifact.cells || []) {
      const reasons = entry.reasons || [entry.reason];
      for (const reasonEntry of reasons.filter(Boolean)) {
        const code = typeof reasonEntry === "string" ? reasonEntry : reasonEntry.reason;
        if (!TRIGGER_CODES.has(code)) throw new Error(`Unknown manual trigger code: ${code}`);
        if (!knownCases.has(entry.caseId)) throw new Error(`Trigger names unknown case: ${entry.caseId}`);
        if (!triggers.has(entry.caseId)) triggers.set(entry.caseId, new Set());
        triggers.get(entry.caseId).add(code);
      }
    }
    for (const caseId of artifact.caseIds || []) {
      if (!knownCases.has(caseId)) throw new Error(`Trigger names unknown case: ${caseId}`);
      if (!triggers.has(caseId)) throw new Error(`Case ${caseId} lacks a deterministic trigger code.`);
    }
  }
  return new Map([...triggers].map(([caseId, codes]) => [caseId, [...codes].sort()]));
};

const prepareSource = (packet, source, sourceIndex, unitRoot, packetCellRoot) => {
  const projected = planner.planWorkbookProjection(source, packet);
  const content = source.deliveredContent || "";
  const file = `source-${String(sourceIndex).padStart(4, "0")}.txt`;
  fs.writeFileSync(path.join(unitRoot, file), content, { flag: "wx", mode: 0o600 });
  let locatorArtifact = null;
  if (projected.applied) {
    const locator = projected.source.deliveredContent || "";
    const locatorFile = `source-${String(sourceIndex).padStart(4, "0")}-workbook-index.txt`;
    fs.writeFileSync(path.join(unitRoot, locatorFile), locator, { flag: "wx", mode: 0o600 });
    locatorArtifact = { path: locatorFile, sha256: sha256(locator),
      byteLength: Buffer.byteLength(locator), complete: true };
  }
  const manualReviewArtifacts = (source.manualReviewArtifacts || []).map((artifact, artifactIndex) => {
    const sourceFile = resolveWithin(packetCellRoot, artifact.path, "Manual source artifact");
    const body = fs.readFileSync(sourceFile);
    if (artifact.complete !== true || body.length !== artifact.byteLength || sha256(body) !== artifact.sha256) {
      throw new Error("Manual source artifact descriptor mismatch.");
    }
    const relative = `source-${String(sourceIndex).padStart(4, "0")}-manual-${String(artifactIndex).padStart(2, "0")}.body`;
    fs.writeFileSync(path.join(unitRoot, relative), body, { flag: "wx", mode: 0o600 });
    return { ...artifact, path: relative };
  });
  return {
    sourceIndex,
    sourceId: source.sourceId,
    url: source.url || null,
    finalUrl: source.finalUrl || null,
    hostReadStatus: source.hostReadStatus,
    snapshotCoverage: source.snapshotCoverage,
    normalizationFormat: source.normalizationFormat || source.normalization?.normalizationFormat || null,
    contentArtifact: { path: file, sha256: sha256(content), byteLength: Buffer.byteLength(content), complete: true },
    locatorArtifact,
    manualReviewArtifacts,
    workbookLocatorAudit: projected.audit ? {
      scannedSheets: projected.audit.scannedSheets,
      scannedRows: projected.audit.scannedRows,
      scannedCells: projected.audit.scannedCells,
      npiColumnsBySheet: projected.audit.npiColumnsBySheet,
      exactRequestedNpiColumnMatches: projected.audit.exactRequestedNpiColumnMatches,
      exactMatches: projected.audit.exactMatches,
      selectedRecords: projected.audit.selectedRecords,
      triggerCode: projected.audit.manualReviewReason,
      fullSourceTextSha256: projected.audit.fullSourceTextSha256,
      exhaustiveExactEqualityScan: projected.audit.exhaustiveExactEqualityScan
    } : null
  };
};

const prepare = ({ packetRoot, outputRoot, sealedRoot, expectedArms, expectedCasesPerArm, triggerFiles, seed }) => {
  if (fs.existsSync(outputRoot)) throw new Error("Manual campaign output must be a fresh directory.");
  if (fs.existsSync(sealedRoot)) throw new Error("Manual sealed output must be a fresh directory.");
  const relativeSeal = path.relative(path.resolve(outputRoot), path.resolve(sealedRoot));
  if (!relativeSeal.startsWith("..") || path.isAbsolute(relativeSeal)) {
    throw new Error("SEALED_ROOT must be outside the reviewer-visible OUTPUT_ROOT.");
  }
  const cells = discover(packetRoot);
  const allCases = assertCombinedCampaign(cells, expectedArms, expectedCasesPerArm);
  const triggers = triggerCases(triggerFiles, cells);
  const schemaAudit = fileAudit(SCHEMA_FILE);
  const harnessAudit = fileAudit(__filename);
  const runnerAuthority = evaluatorRunnerAuthority(__dirname);
  const rubric = `${FIXED_CATEGORICAL_INSTRUCTIONS}\nManual transport: inspect only this blinded arm's complete source artifacts. `
    + "Workbook index artifacts are locators only; the complete workbook text remains authoritative.";
  const seedBuffer = seed ? Buffer.from(seed, "hex") : crypto.randomBytes(32);
  if (seedBuffer.length < 16) throw new Error("Blinding seed must contain at least 16 bytes.");
  const mappings = [];
  const units = [];
  for (const [caseId, codes] of [...triggers].sort(([a], [b]) => a.localeCompare(b))) {
    const blindCaseId = `case_${hmac(seedBuffer, `case\0${caseId}`)}`;
    for (const armId of expectedArms) {
      const cell = cells.find((item) => item.caseId === caseId && item.armId === armId);
      if (!cell) throw new Error(`Missing paired manual cell ${armId}/${caseId}.`);
      const blindArmId = `arm_${hmac(seedBuffer, `arm\0${caseId}\0${armId}`)}`;
      const unitId = `${blindCaseId}/${blindArmId}`;
      const unitRoot = path.join(outputRoot, "review-units", blindCaseId, blindArmId);
      fs.mkdirSync(unitRoot, { recursive: true, mode: 0o700 });
      const sources = (cell.packet.sources || []).map((source, index) =>
        prepareSource(cell.packet, source, index, unitRoot, path.dirname(cell.file)));
      const reviewInput = {
        schemaVersion: 1, unitId, blindCaseId, blindArmId, triggerCodes: codes,
        rubric: { schemaPolicyVersion: require(SCHEMA_FILE).SCHEMA_POLICY_VERSION,
          schemaSha256: schemaAudit.sha256, instructionsSha256: sha256(rubric),
          instructions: rubric, automaticEvaluatorModel: "gpt-5.6-sol", automaticReasoning: "high",
          exceptionReviewerType: "codex_harness_manual",
          harnessSha256: harnessAudit.sha256 },
        fixedCase: {
          identityContext: cell.packet.identityContext,
          evaluationGate: cell.packet.evaluationGate || null,
          evaluationGuidance: cell.packet.evaluationGuidance || null,
          finalSanitizedProfiles: cell.packet.finalSanitizedProfiles || [],
          rawStructuredProfiles: cell.packet.rawStructuredProfiles || [],
          claims: cell.packet.claims || [],
          preSanitizerCandidates: cell.packet.preSanitizerCandidates || [],
          expectedFields: cell.packet.expectedFields || []
        },
        sources
      };
      writeExclusive(path.join(unitRoot, "review-input.json"), reviewInput);
      const inputSha256 = sha256(fs.readFileSync(path.join(unitRoot, "review-input.json")));
      mappings.push({ caseId, armId, blindCaseId, blindArmId, unitId, inputSha256 });
      units.push({ unitId, blindCaseId, blindArmId, triggerCodes: codes,
        input: path.relative(outputRoot, path.join(unitRoot, "review-input.json")), inputSha256,
        presentationOrderKey: hmac(seedBuffer, `order\0${caseId}\0${armId}`, 64) });
    }
  }
  units.sort((a, b) => a.presentationOrderKey.localeCompare(b.presentationOrderKey));
  units.forEach((unit, index) => { unit.presentationIndex = index; delete unit.presentationOrderKey; });
  const sealedMap = { schemaVersion: 1, seedHex: seedBuffer.toString("hex"), expectedArms,
    expectedCasesPerArm, allCases, allCasesSha256: sha256(stableJson(allCases)), mappings };
  const publicManifest = { schemaVersion: 1, status: "MANUAL_REVIEW_READY",
    campaignPolicy: "combined_exact_arm_set_independent_blinded_units_paired_censor_on_incomplete",
    expectedArmCount: expectedArms.length, expectedCasesPerArm,
    manualCaseCount: triggers.size, expectedCompletedUnitCount: triggers.size * expectedArms.length,
    seedCommitment: sha256(seedBuffer), schemaAudit, runnerAuthority,
    triggerCodes: [...TRIGGER_CODES].sort(), units,
    sealedMapSha256: sha256(stableJson(sealedMap)) };
  writeExclusive(path.join(sealedRoot, "sealed-map.json"), sealedMap, 0o600);
  writeExclusive(path.join(outputRoot, "campaign-manifest.json"), publicManifest, 0o644);
  return publicManifest;
};

const validateReviewerProvenance = (reviewer) => {
  const reviewMode = reviewer?.reviewMode;
  const honestReviewer = reviewMode === "automated_sol_api"
    ? reviewer.model === "gpt-5.6-sol" && reviewer.reasoning === "high" && Boolean(reviewer.apiResponseId)
    : reviewMode === "codex_harness_manual" ? Boolean(reviewer.runtimeIdentity) : false;
  if (!honestReviewer || !reviewer.id || !reviewer.sessionId || !reviewer.protocolVersion) {
    throw new Error("Manual output requires honest review-mode provenance and reviewer/session metadata.");
  }
  return true;
};

const verifyManualOutput = ({ wrapper, reviewInput }) => {
  const { CategoricalJudgeSchema } = require(SCHEMA_FILE);
  const reviewMode = wrapper.reviewer?.reviewMode;
  validateReviewerProvenance(wrapper.reviewer);
  if (!wrapper.startedAt || !wrapper.completedAt
    || !Number.isFinite(wrapper.durationMs) || wrapper.durationMs < 0 || !wrapper.rawReviewTraceArtifact
    || !wrapper.categoricalOutput) {
    throw new Error("Manual output requires honest review-mode provenance, reviewer/session metadata, timing, raw trace, and categoricalOutput.");
  }
  if (!Number.isFinite(Date.parse(wrapper.startedAt)) || !Number.isFinite(Date.parse(wrapper.completedAt))) {
    throw new Error("Manual review timestamps are invalid.");
  }
  const unitRoot = path.dirname(reviewInput.__file);
  for (const [sourceIndex, source] of (reviewInput.sources || []).entries()) {
    for (const artifact of source.manualReviewArtifacts || []) {
      const artifactFile = resolveWithin(unitRoot, artifact.path, `Manual source artifact ${sourceIndex}`);
      const body = fs.readFileSync(artifactFile);
      if (artifact.complete !== true || body.length !== artifact.byteLength || sha256(body) !== artifact.sha256) {
        throw new Error(`Manual source artifact ${sourceIndex} mismatch.`);
      }
    }
  }
  const traceFile = resolveWithin(unitRoot, wrapper.rawReviewTraceArtifact.path, "Manual raw review trace");
  const trace = fs.readFileSync(traceFile);
  if (wrapper.rawReviewTraceArtifact.complete !== true || trace.length !== wrapper.rawReviewTraceArtifact.byteLength
    || sha256(trace) !== wrapper.rawReviewTraceArtifact.sha256) throw new Error("Manual raw review trace mismatch.");
  const parsed = CategoricalJudgeSchema.parse(wrapper.categoricalOutput);
  const exact = (rows, field, count, label) => {
    const observed = rows.map((row) => row[field]);
    const expected = Array.from({ length: count }, (_, index) => index);
    if (stableJson(observed) !== stableJson(expected)) throw new Error(`${label} cardinality/index mismatch.`);
  };
  exact(parsed.sourceAssessments, "sourceIndex", reviewInput.sources.length, "source assessments");
  exact(parsed.claimAssessments, "claimIndex", reviewInput.fixedCase.claims.length, "claim assessments");
  exact(parsed.candidateDecisionAssessments, "candidateIndex",
    reviewInput.fixedCase.preSanitizerCandidates.length, "candidate assessments");
  exact(parsed.fieldAssessments, "fieldIndex", reviewInput.fixedCase.expectedFields.length, "field assessments");
  const expectedFieldNames = reviewInput.fixedCase.expectedFields.map((field) =>
    typeof field === "string" ? field : field.fieldType);
  const ratingIndex = expectedFieldNames.indexOf("rating");
  if (ratingIndex >= 0) {
    const row = parsed.fieldAssessments[ratingIndex];
    if (row.topFactDisposition !== "indeterminate" || row.armFoundBestEligibleClass !== "indeterminate"
      || row.topSelectedClass !== "none" || row.hierarchyOpportunity !== "indeterminate"
      || row.cmsHierarchyConditionalOutcome !== "not_applicable" || row.recencyOpportunity !== "indeterminate"
      || row.contractFidelity !== "not_applicable" || row.directoryComparison !== "not_comparable") {
      throw new Error("Manual V14 rating compatibility row must remain non-penalizing.");
    }
  }
  if (parsed.cmsRoleAssessment.ratingSourceNeutrality !== "not_applicable") {
    throw new Error("Manual out-of-scope ratingSourceNeutrality must be not_applicable.");
  }
  const sourceBodies = reviewInput.sources.map((source) => {
    const file = resolveWithin(unitRoot, source.contentArtifact.path, "Manual source artifact");
    const body = fs.readFileSync(file, "utf8");
    if (sha256(body) !== source.contentArtifact.sha256 || Buffer.byteLength(body) !== source.contentArtifact.byteLength
      || source.contentArtifact.complete !== true) throw new Error("Manual source descriptor mismatch.");
    const newline = body.indexOf("\n");
    return /^\[CHAR_RANGE [^\]]+\]$/.test(body.slice(0, newline)) ? body.slice(newline + 1) : body;
  });
  const spans = [parsed.identityAssessment.evidenceSpans,
    ...parsed.claimAssessments.map((row) => row.evidenceSpans),
    ...parsed.candidateDecisionAssessments.map((row) => row.evidenceSpans)].flat();
  const verifiedEvidence = [];
  for (const span of spans) {
    const body = sourceBodies[span.sourceIndex];
    if (body == null || !span.quote || !body.includes(span.quote) || !span.locatorHint) {
      throw new Error("Manual evidence span is not verbatim with a nonempty locator.");
    }
    let offset = body.indexOf(span.quote);
    const occurrences = [];
    while (offset >= 0) {
      occurrences.push({ start: offset, end: offset + span.quote.length });
      offset = body.indexOf(span.quote, offset + Math.max(1, span.quote.length));
    }
    verifiedEvidence.push({ ...span, occurrences });
  }
  const verifyRefs = (refs, label) => {
    const limits = { source: reviewInput.sources.length, claim: reviewInput.fixedCase.claims.length,
      candidate: reviewInput.fixedCase.preSanitizerCandidates.length };
    for (const ref of refs || []) if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= limits[ref.kind]) {
      throw new Error(`${label} evidence reference is out of range.`);
    }
  };
  for (const row of parsed.fieldAssessments) verifyRefs(row.evidenceRefs, `field ${row.fieldIndex}`);
  verifyRefs(parsed.cmsRoleAssessment.evidenceRefs, "CMS role assessment");
  verifyRefs(parsed.casePolicyAssessment.evidenceRefs, "case policy assessment");
  if (Object.hasOwn(parsed, "score")) throw new Error("Manual aggregate score is forbidden.");
  return { parsed, verifiedEvidence };
};

const seal = ({ campaignRoot, sealedRoot, sealFileName = "final-unblinded-seal.json" }) => {
  if (!/^final-unblinded-seal(?:-v\d+)?\.json$/.test(sealFileName)) {
    throw new Error("Manual review seal filename is invalid.");
  }
  const manifestFile = path.join(campaignRoot, "campaign-manifest.json");
  const mapFile = path.join(sealedRoot, "sealed-map.json");
  const manifest = readJson(manifestFile);
  const sealedMap = readJson(mapFile);
  if (manifest.sealedMapSha256 !== sha256(stableJson(sealedMap))) throw new Error("Sealed blinding map mismatch.");
  if (manifest.schemaAudit.sha256 !== fileAudit(SCHEMA_FILE).sha256) throw new Error("Fixed V14 schema drifted.");
  if (!sameEvaluatorAuthority(manifest.runnerAuthority, evaluatorRunnerAuthority(__dirname))) {
    throw new Error("Manual review runner authority differs from the current evaluator bundle.");
  }
  const decisions = [];
  const censoredCases = [];
  for (const blindCaseId of [...new Set(manifest.units.map((unit) => unit.blindCaseId))]) {
    const caseUnits = manifest.units.filter((unit) => unit.blindCaseId === blindCaseId);
    const complete = caseUnits.every((unit) => fs.existsSync(path.join(campaignRoot,
      "review-units", unit.blindCaseId, unit.blindArmId, "review-output.json")));
    if (!complete) {
      censoredCases.push({ blindCaseId, status: "PAIRED_MANUAL_CENSOR", reason: "one_or_more_arm_outputs_missing",
        unitIds: caseUnits.map((unit) => unit.unitId) });
      continue;
    }
    let pairedReviewerProtocol = null;
    for (const unit of caseUnits) {
      const unitRoot = path.join(campaignRoot, "review-units", unit.blindCaseId, unit.blindArmId);
      const reviewInput = readJson(path.join(unitRoot, "review-input.json"));
      reviewInput.__file = path.join(unitRoot, "review-input.json");
      if (sha256(fs.readFileSync(reviewInput.__file)) !== unit.inputSha256) {
        throw new Error("Manual review input changed after campaign preparation.");
      }
      const wrapper = readJson(path.join(unitRoot, "review-output.json"));
      const verified = verifyManualOutput({ wrapper, reviewInput });
      const reviewerProtocol = sha256(stableJson({ reviewMode: wrapper.reviewer.reviewMode,
        reviewerId: wrapper.reviewer.id,
        model: wrapper.reviewer.model ?? null, reasoning: wrapper.reviewer.reasoning ?? null,
        runtimeIdentity: wrapper.reviewer.runtimeIdentity ?? null,
        protocolVersion: wrapper.reviewer.protocolVersion }));
      pairedReviewerProtocol ||= reviewerProtocol;
      if (pairedReviewerProtocol !== reviewerProtocol) {
        throw new Error("All paired arms must use one identical manual reviewer protocol.");
      }
      const mapping = sealedMap.mappings.find((row) => row.unitId === unit.unitId);
      if (!mapping || mapping.inputSha256 !== unit.inputSha256) throw new Error("Manual unit mapping mismatch.");
      decisions.push({ caseId: mapping.caseId, armId: mapping.armId, blindCaseId, blindArmId: unit.blindArmId,
        resultClass: wrapper.reviewer.reviewMode === "codex_harness_manual"
          ? "codex_harness_manual_separate_from_automatic_sol" : "automated_sol_api_exception",
        reviewer: wrapper.reviewer, reviewerProtocolSha256: reviewerProtocol,
        startedAt: wrapper.startedAt, completedAt: wrapper.completedAt,
        durationMs: wrapper.durationMs, rawReviewTraceSha256: wrapper.rawReviewTraceArtifact.sha256,
        outputSha256: sha256(stableJson(verified.parsed)),
        verifiedEvidenceSha256: sha256(stableJson(verified.verifiedEvidence)),
        categoricalOutput: verified.parsed });
    }
  }
  const expectedCompleted = manifest.expectedCompletedUnitCount
    - censoredCases.reduce((sum, row) => sum + row.unitIds.length, 0);
  if (decisions.length !== expectedCompleted) throw new Error("Final manual decision cardinality mismatch.");
  const result = { schemaVersion: 1, status: "MANUAL_REVIEW_SEALED",
    manifestSha256: sha256(fs.readFileSync(manifestFile)), mapSha256: sha256(fs.readFileSync(mapFile)),
    evaluatorAuthoritySha256: manifest.runnerAuthority.authoritySha256,
    expectedArmCount: manifest.expectedArmCount, manualCaseCount: manifest.manualCaseCount,
    completedUnits: decisions.length, censoredCases, decisions };
  result.unblindedCardinalitySealSha256 = sha256(stableJson({
    expectedArmCount: result.expectedArmCount, manualCaseCount: result.manualCaseCount,
    completed: decisions.map((row) => [row.caseId, row.armId]).sort(), censoredCases
  }));
  writeExclusive(path.join(campaignRoot, sealFileName), result, 0o600);
  return result;
};

const main = () => {
  const command = process.argv[2];
  if (command === "prepare") {
    const packetRoot = path.resolve(process.env.PACKET_ROOT || "");
    const outputRoot = path.resolve(process.env.OUTPUT_ROOT || "");
    const sealedRoot = path.resolve(process.env.SEALED_ROOT || "");
    const expectedArms = (process.env.EXPECTED_ARMS || "").split(",").filter(Boolean);
    const triggerFiles = parsePathList(process.env.TRIGGER_FILES || "");
    const minimumArms = process.env.SINGLE_ARM_AUDIT === "1" ? 1 : 2;
    if (!packetRoot || !outputRoot || !sealedRoot || expectedArms.length < minimumArms || !triggerFiles.length) {
      throw new Error("prepare requires PACKET_ROOT, OUTPUT_ROOT, SEALED_ROOT, EXPECTED_ARMS, and TRIGGER_FILES.");
    }
    prepare({ packetRoot, outputRoot, sealedRoot, expectedArms,
      expectedCasesPerArm: Number(process.env.EXPECTED_CASES_PER_ARM || 60), triggerFiles,
      seed: process.env.BLINDING_SEED_HEX || null });
  } else if (command === "seal") {
    seal({ campaignRoot: path.resolve(process.env.CAMPAIGN_ROOT || ""),
      sealedRoot: path.resolve(process.env.SEALED_ROOT || ""),
      sealFileName: process.env.FINAL_SEAL_FILE_NAME || "final-unblinded-seal.json" });
  } else throw new Error("Usage: manual_review_harness.js prepare|seal");
};

function parsePathList(value) {
  return String(value || "").split(path.delimiter).filter(Boolean).map((file) => path.resolve(file));
}

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { TRIGGER_CODES, assertCombinedCampaign, discover, parsePathList, prepare, seal, triggerCases,
  validateReviewerProvenance, verifyManualOutput };

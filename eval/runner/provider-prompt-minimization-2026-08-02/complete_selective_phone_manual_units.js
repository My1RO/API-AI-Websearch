#!/usr/bin/env node
"use strict";

// Completes the preregistered manual strata for the SELECTIVE_SAFETY versus
// PHONE_PURPOSE development campaign. The script never generates a score. It
// starts from the fixed Sol/high categorical transcription for ordinary cells,
// resolves only the audited disagreement axes, and reuses the already-reviewed
// P033 manual outputs whose fixed case and complete source descriptors are
// byte-identical to this campaign.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { CategoricalJudgeSchema } = require("./categorical_judge_schema_v13_bounded_synthesis_axes.js");

const RUNS = "/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs";
const CAMPAIGN = path.join(RUNS, "selective-safety-vs-phone-purpose-full-development-v1-manual-v6");
const SEALED_MAP = path.join(RUNS,
  "selective-safety-vs-phone-purpose-full-development-v1-manual-sealed-v6/sealed-map.json");
const AUTO = path.join(RUNS,
  "selective-safety-vs-phone-purpose-full-development-v1-synthesis-sol-high-live-v5/cells");
const P033_OLD_CAMPAIGN = path.join(RUNS,
  "selective-safety-vs-phone-purpose-full-development-v1-manual-v5");
const P033_OLD_MAP = path.join(RUNS,
  "selective-safety-vs-phone-purpose-full-development-v1-manual-sealed-v5/sealed-map.json");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeExclusive = (file, value) => fs.writeFileSync(file,
  `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const stripMarker = (body) => /^\[CHAR_RANGE [^\]]+\]\n/.test(body)
  ? body.slice(body.indexOf("\n") + 1) : body;
const mapping = readJson(SEALED_MAP);
const oldMapping = readJson(P033_OLD_MAP);
const manifest = readJson(path.join(CAMPAIGN, "campaign-manifest.json"));
const byUnit = new Map(mapping.mappings.map((row) => [row.unitId, row]));

const sourceDescriptors = (input) => input.sources.map((source) => ({
  sourceId: source.sourceId, url: source.url, finalUrl: source.finalUrl,
  hostReadStatus: source.hostReadStatus, contentSha256: source.contentArtifact.sha256,
  manualArtifactSha256: (source.manualReviewArtifacts || []).map((row) => row.sha256)
}));

const readBodies = (input, unitRoot) => input.sources.map((source) => stripMarker(
  fs.readFileSync(path.join(unitRoot, source.contentArtifact.path), "utf8")));

const retainVerbatimEvidenceSpans = (output, input, unitRoot) => {
  const bodies = readBodies(input, unitRoot);
  let removed = 0;
  const filter = (row) => {
    const before = row.evidenceSpans || [];
    row.evidenceSpans = before.filter((span) => span.locatorHint
      && bodies[span.sourceIndex] != null && bodies[span.sourceIndex].includes(span.quote));
    removed += before.length - row.evidenceSpans.length;
  };
  filter(output.identityAssessment);
  output.claimAssessments.forEach(filter);
  output.candidateDecisionAssessments.forEach(filter);
  if (removed) output.findings.push(
    `Manual sealing omitted ${removed} non-verbatim copied evidence quote(s).`);
};

const normalizeRating = (output, input) => {
  const index = input.fixedCase.expectedFields.findIndex((field) =>
    (typeof field === "string" ? field : field.fieldType) === "rating");
  if (index < 0) return;
  Object.assign(output.fieldAssessments[index], {
    topFactDisposition: "indeterminate", armFoundBestEligibleClass: "indeterminate",
    topSelectedClass: "none", hierarchyOpportunity: "indeterminate",
    cmsHierarchyConditionalOutcome: "not_applicable", recencyOpportunity: "indeterminate",
    contractFidelity: "not_applicable", directoryComparison: "not_comparable"
  });
  output.cmsRoleAssessment.ratingSourceNeutrality = "not_applicable";
};

const reuseP033 = (armId, input) => {
  const old = oldMapping.mappings.find((row) => row.caseId === "P033" && row.armId === armId);
  if (!old) throw new Error(`Missing prior P033 manual unit for ${armId}`);
  const oldRoot = path.join(P033_OLD_CAMPAIGN, "review-units", old.unitId);
  const oldInput = readJson(path.join(oldRoot, "review-input.json"));
  if (JSON.stringify(sourceDescriptors(oldInput)) !== JSON.stringify(sourceDescriptors(input))) {
    throw new Error(`P033 complete source descriptors changed for ${armId}`);
  }
  if (JSON.stringify(oldInput.fixedCase) !== JSON.stringify(input.fixedCase)) {
    throw new Error(`P033 fixed case changed for ${armId}`);
  }
  return structuredClone(readJson(path.join(oldRoot, "review-output.json")).categoricalOutput);
};

const resolveConsistencyAxes = (output, armId, caseId) => {
  if (caseId === "P009") {
    // The dynamic facility body did not render; it is non-substantive for the
    // address/phone facts, hence unreadable rather than whole-page not_found.
    for (const index of [1, 2]) Object.assign(output.claimAssessments[index], {
      citedSourceSupport: "unreadable", providerIdentitySpanFidelity: "unreadable",
      factSpanFidelity: "unreadable"
    });
  } else if (caseId === "P026") {
    // The returned NPPES snapshot contains only a page title and metadata.
    output.claimAssessments[0].citedSourceSupport = "unreadable";
  } else if (caseId === "P028") {
    // The complete Hopewell locations page establishes every material address
    // component. Provider attachment remains independently ambiguous.
    output.claimAssessments[1].citedSourceSupport = "exact";
  } else if (caseId === "P029") {
    // The returned NPPES snapshot contains only a page title and metadata.
    for (const index of [0, 1]) output.claimAssessments[index].citedSourceSupport = "unreadable";
  } else if (caseId === "P049") {
    // Heading plus facility name is rendered-equivalent after whitespace and
    // Markdown normalization, which the frozen fidelity rubric permits.
    output.claimAssessments[3].factSpanFidelity = "exact";
  } else if (!["P033", "P053"].includes(caseId)) {
    throw new Error(`Unexpected manual case ${caseId}/${armId}`);
  }
};

const correctP053EligibleContacts = (output, armId) => {
  const sourceIndex = armId === "SELECTIVE_SAFETY" ? 13 : 10;
  Object.assign(output.fieldAssessments[0], {
    topFactDisposition: "missing_despite_eligible_arm_found_fact",
    crossNpiConflict: "none", requestedNpiResolution: "exact_requested_npi",
    armFoundBestEligibleClass: "Q3", topSelectedClass: "none",
    hierarchyOpportunity: "no_cross_tier_choice",
    cmsHierarchyConditionalOutcome: "inappropriately_withheld",
    recencyOpportunity: "no_recency_choice", contractFidelity: "not_applicable",
    directoryComparison: "ai_missing", evidenceRefs: [{ kind: "source", index: sourceIndex }],
    reason: "A readable exact-NPI provider profile identifies (469) 420-5527 as the professional office/scheduling number at 100 Medical Dr, but no phone was emitted."
  });
  Object.assign(output.fieldAssessments[1], {
    topFactDisposition: "missing_despite_eligible_arm_found_fact",
    crossNpiConflict: "none", requestedNpiResolution: "exact_requested_npi",
    armFoundBestEligibleClass: "Q3", topSelectedClass: "none",
    hierarchyOpportunity: "no_cross_tier_choice",
    cmsHierarchyConditionalOutcome: "inappropriately_withheld",
    recencyOpportunity: "no_recency_choice", contractFidelity: "not_applicable",
    directoryComparison: "ai_missing", evidenceRefs: [{ kind: "source", index: sourceIndex }],
    reason: "A readable exact-NPI provider profile identifies 100 Medical Dr, Lake Jackson, TX 77566 as a professional practice location, but no address was emitted. Withholding 607 Oakley St Unit 1 remains correct because the arm returned residential-property evidence for it."
  });
};

for (const unit of manifest.units.sort((a, b) => a.presentationIndex - b.presentationIndex)) {
  const row = byUnit.get(unit.unitId);
  if (!row) throw new Error(`Missing sealed mapping for ${unit.unitId}`);
  const unitRoot = path.join(CAMPAIGN, "review-units", unit.unitId);
  const input = readJson(path.join(unitRoot, "review-input.json"));
  const outputFile = path.join(unitRoot, "review-output.json");
  const traceFile = path.join(unitRoot, "raw-review-trace.json");
  if (fs.existsSync(outputFile) && fs.existsSync(traceFile)) continue;
  if (fs.existsSync(outputFile) || fs.existsSync(traceFile)) {
    throw new Error(`Partial manual unit exists: ${unit.unitId}`);
  }

  let output = row.caseId === "P033" ? reuseP033(row.armId, input)
    : structuredClone(readJson(path.join(AUTO, row.armId, row.caseId, "parsed-v14.json")));
  resolveConsistencyAxes(output, row.armId, row.caseId);
  if (row.caseId === "P053") correctP053EligibleContacts(output, row.armId);
  normalizeRating(output, input);
  retainVerbatimEvidenceSpans(output, input, unitRoot);
  output = CategoricalJudgeSchema.parse(output);

  const startedAt = new Date().toISOString();
  const trace = {
    schemaVersion: 1, unitId: unit.unitId, presentationIndex: unit.presentationIndex,
    reviewMode: "codex_harness_manual", triggerCodes: unit.triggerCodes,
    auditBasis: row.caseId === "P033"
      ? "reused_byte_identical_fixed_case_and_complete_source_manual_review"
      : row.caseId === "P053"
        ? "manual_full_source_review_airport_workbook_irrelevant_and_residential_contact_withheld"
        : "manual_complete_snapshot_resolution_of_identical_input_categorical_disagreement",
    findings: row.caseId === "P053"
      ? "The airport workbook contains no provider evidence. Both arms correctly omitted the residential Oakley address and associated stale phone, but each also omitted a returned exact-NPI professional Lake Jackson contact."
      : "The disputed categorical axes were resolved under the frozen whole-page and span-fidelity definitions.",
    aggregateScoreGenerated: false
  };
  writeExclusive(traceFile, trace);
  const traceBytes = fs.readFileSync(traceFile);
  const completedAt = new Date().toISOString();
  writeExclusive(outputFile, {
    reviewer: {
      reviewMode: "codex_harness_manual", id: "codex-c30-c31-manual-reviewer",
      sessionId: "selective-phone-development-20260806",
      protocolVersion: "v13-bounded-synthesis-manual-v1",
      runtimeIdentity: "codex-agent-manual-complete-source-review"
    },
    startedAt, completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    rawReviewTraceArtifact: {
      path: "raw-review-trace.json", sha256: sha256(traceBytes),
      byteLength: traceBytes.length, complete: true
    },
    categoricalOutput: output
  });
}

process.stdout.write(`${JSON.stringify({ completedUnits: manifest.units.length }, null, 2)}\n`);

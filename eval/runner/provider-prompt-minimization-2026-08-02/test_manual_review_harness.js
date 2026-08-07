#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const harness = require("./manual_review_harness.js");
const correctedSchema = require("./categorical_judge_schema_v13_bounded_synthesis_axes.js");

assert.deepEqual(harness.parsePathList(["relative-one", "relative-two"].join(path.delimiter)),
  [path.resolve("relative-one"), path.resolve("relative-two")]);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-review-harness-"));
try {
  const packetRoot = path.join(root, "packets");
  const outputRoot = path.join(root, "review-visible");
  const sealedRoot = path.join(root, "sealed-authority");
  const request = { providerId: "1234567890", npi: "1234567890", name: "Jane Doe" };
  const identityContext = { request, cmsBaseline: { providerId: "1234567890" },
    nppesIdentity: { npi: "1234567890", entityType: "individual" } };
  const manualBody = Buffer.from('<html><script type="application/ld+json">omitted</script></html>');
  const manualBodySha256 = crypto.createHash("sha256").update(manualBody).digest("hex");
  const packet = (caseId) => ({ caseId, identityContext, finalSanitizedProfiles: [],
    rawStructuredProfiles: [], claims: [], preSanitizerCandidates: [],
    expectedFields: ["phone", "address", "website", "rating", "specialty"],
    sources: [{ sourceId: "s0", url: "https://example.test/jane", hostReadStatus: "read",
      snapshotCoverage: "full_normalized_snapshot", normalizationFormat: "rendered_semantic_markdown_v4",
      deliveredContent: "[CHAR_RANGE 0:20; complete]\nJane Doe professional",
      manualReviewArtifacts: [{ kind: "complete_raw_source_body_containing_omitted_json_ld",
        path: "manual-source-artifacts/raw.body", sha256: manualBodySha256,
        byteLength: manualBody.length, complete: true }] }] });
  for (const armId of ["A", "B", "C"]) for (const caseId of ["H001", "H002"]) {
    const dir = path.join(packetRoot, armId, caseId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, "manual-source-artifacts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "manual-source-artifacts", "raw.body"), manualBody);
    fs.writeFileSync(path.join(dir, "packet.json"), JSON.stringify(packet(caseId)));
  }
  const triggerFile = path.join(root, "triggers.json");
  fs.writeFileSync(triggerFile, JSON.stringify({ cells: [{ armId: "A", caseId: "H001",
    reasons: [{ reason: "NO_EXACT_REQUESTED_NPI_IN_RECOGNIZED_NPI_COLUMN" }] }], caseIds: ["H001"] }));
  const secondTriggerFile = path.join(root, "runtime-triggers.json");
  fs.writeFileSync(secondTriggerFile, JSON.stringify({ cells: [{ armId: "B", caseId: "H002",
    reasons: [{ reason: "EVALUATOR_TRANSPORT_FAILURE" }] }], caseIds: ["H002"] }));
  const unionOutput = path.join(root, "union-visible");
  const unionSealed = path.join(root, "union-sealed");
  const unionManifest = harness.prepare({ packetRoot, outputRoot: unionOutput, sealedRoot: unionSealed,
    expectedArms: ["A", "B", "C"], expectedCasesPerArm: 2,
    triggerFiles: [triggerFile, secondTriggerFile], seed: "10".repeat(32) });
  assert.equal(unionManifest.manualCaseCount, 2);
  assert.equal(unionManifest.units.length, 6,
    "every case implicated by any trigger artifact must be paired across every arm");
  const manifest = harness.prepare({ packetRoot, outputRoot, sealedRoot,
    expectedArms: ["A", "B", "C"], expectedCasesPerArm: 2, triggerFiles: [triggerFile],
    seed: "11".repeat(32) });
  assert.equal(manifest.expectedCompletedUnitCount, 3);
  assert.equal(manifest.units.length, 3);
  assert.equal(fs.existsSync(path.join(outputRoot, "sealed-map.json")), false);
  assert.equal(fs.existsSync(path.join(sealedRoot, "sealed-map.json")), true);
  const firstInput = JSON.parse(fs.readFileSync(path.join(outputRoot, manifest.units[0].input), "utf8"));
  assert.equal(firstInput.sources[0].sourceId, "s0");
  assert.equal(firstInput.sources[0].manualReviewArtifacts[0].kind,
    "complete_raw_source_body_containing_omitted_json_ld");
  assert.equal(fs.readFileSync(path.join(path.dirname(path.join(outputRoot, manifest.units[0].input)),
    firstInput.sources[0].manualReviewArtifacts[0].path)).toString(), manualBody.toString());
  assert.match(firstInput.rubric.instructions, /fixed whole-case categorical synthesizer/);
  assert.equal(firstInput.rubric.schemaPolicyVersion, correctedSchema.SCHEMA_POLICY_VERSION);
  assert.match(firstInput.rubric.instructions,
    /exactSupport assesses all eligible readable evidence returned by this arm/);
  assert(manifest.triggerCodes.includes("IDENTICAL_INPUT_CATEGORICAL_DISAGREEMENT"));
  const evidenceSpan = { sourceIndex: 0, quote: "Jane Doe", polarity: "supports", locatorHint: "provider heading" };
  const categoricalOutput = {
    sourceAssessments: [{ sourceIndex: 0, sourceClass: "Q1_exact_provider_first_party",
      identityAttachment: "exact_npi", crossNpiConflict: "none", requestedNpiResolution: "exact_requested_npi",
      professionalPurpose: "professional", dateStatus: "undated", providerIdentitySupported: true,
      prohibitedForDisplay: false, declaredDates: [], notes: "manual" }],
    identityAssessment: { npiEntity: "exact", nameMatch: "exact", requestedLocationMatch: "not_established",
      evidenceSpans: [evidenceSpan], reason: "manual" },
    claimAssessments: [], candidateDecisionAssessments: [],
    fieldAssessments: ["phone", "address", "website", "rating", "specialty"].map((_, fieldIndex) => ({
      fieldIndex, topFactDisposition: fieldIndex === 3 ? "indeterminate" : "missing_no_eligible_arm_found_fact",
      crossNpiConflict: "none", requestedNpiResolution: "none",
      armFoundBestEligibleClass: fieldIndex === 3 ? "indeterminate" : "none", topSelectedClass: "none",
      hierarchyOpportunity: fieldIndex === 3 ? "indeterminate" : "no_cross_tier_choice",
      cmsHierarchyConditionalOutcome: "not_applicable",
      recencyOpportunity: fieldIndex === 3 ? "indeterminate" : "no_recency_choice",
      contractFidelity: "not_applicable", directoryComparison: "not_comparable", evidenceRefs: [], reason: "missing" })),
    cmsRoleAssessment: { nppesIdentityTaxonomyUse: "appropriate", directoryAuthorityTreatment: "not_applicable",
      contactConflictTreatment: "no_conflict", ratingSourceNeutrality: "not_applicable", reasons: [], evidenceRefs: [] },
    casePolicyAssessment: { listedValueTreatment: "not_applicable", evidenceRefs: [], reason: "manual" },
    criticalFindings: [], findings: []
  };
  const writeReview = (unit, { reviewerId = "same-reviewer", tracePath = "raw-review-trace.json" } = {}) => {
    const unitRoot = path.dirname(path.join(outputRoot, unit.input));
    const trace = Buffer.from(JSON.stringify({ unitId: unit.unitId, complete: true }));
    fs.writeFileSync(path.join(unitRoot, tracePath), trace);
    fs.writeFileSync(path.join(unitRoot, "review-output.json"), JSON.stringify({
      reviewer: { reviewMode: "codex_harness_manual", id: reviewerId, sessionId: `session-${unit.blindArmId}`,
        protocolVersion: "v1", runtimeIdentity: "codex-desktop" },
      startedAt: "2026-08-03T12:00:00Z", completedAt: "2026-08-03T12:00:01Z", durationMs: 1000,
      rawReviewTraceArtifact: { path: tracePath, sha256: require("node:crypto").createHash("sha256").update(trace).digest("hex"),
        byteLength: trace.length, complete: true }, categoricalOutput
    }));
  };
  manifest.units.forEach((unit) => writeReview(unit));
  const sealed = harness.seal({ campaignRoot: outputRoot, sealedRoot });
  assert.equal(sealed.completedUnits, 3);
  assert.equal(sealed.censoredCases.length, 0);
  const sealedV2 = harness.seal({ campaignRoot: outputRoot, sealedRoot,
    sealFileName: "final-unblinded-seal-v2.json" });
  assert.equal(sealedV2.completedUnits, 3);
  assert.equal(fs.existsSync(path.join(outputRoot, "final-unblinded-seal-v2.json")), true);
  assert.throws(() => harness.seal({ campaignRoot: outputRoot, sealedRoot,
    sealFileName: "unsafe.json" }), /seal filename is invalid/);
  assert.equal(harness.validateReviewerProvenance({ reviewMode: "codex_harness_manual", id: "reviewer",
    sessionId: "session", protocolVersion: "v1", runtimeIdentity: "codex-desktop" }), true);
  assert.equal(harness.validateReviewerProvenance({ reviewMode: "automated_sol_api", id: "reviewer",
    sessionId: "session", protocolVersion: "v1", model: "gpt-5.6-sol", reasoning: "high",
    apiResponseId: "resp_1" }), true);
  assert.throws(() => harness.validateReviewerProvenance({ reviewMode: "codex_harness_manual",
    id: "reviewer", sessionId: "session", protocolVersion: "v1" }), /honest review-mode provenance/);
  assert.throws(() => harness.validateReviewerProvenance({ reviewMode: "automated_sol_api",
    id: "reviewer", sessionId: "session", protocolVersion: "v1", model: "gpt-5.6-sol",
    reasoning: "medium", apiResponseId: "resp_1" }), /honest review-mode provenance/);

  const censorOutput = path.join(root, "censor-visible");
  const censorSealed = path.join(root, "censor-sealed");
  const censorManifest = harness.prepare({ packetRoot, outputRoot: censorOutput, sealedRoot: censorSealed,
    expectedArms: ["A", "B", "C"], expectedCasesPerArm: 2, triggerFiles: [triggerFile], seed: "22".repeat(32) });
  const censored = harness.seal({ campaignRoot: censorOutput, sealedRoot: censorSealed });
  assert.equal(censored.completedUnits, 0);
  assert.equal(censored.censoredCases[0].unitIds.length, censorManifest.units.length);

  const mismatchOutput = path.join(root, "mismatch-visible");
  const mismatchSealed = path.join(root, "mismatch-sealed");
  const mismatch = harness.prepare({ packetRoot, outputRoot: mismatchOutput, sealedRoot: mismatchSealed,
    expectedArms: ["A", "B", "C"], expectedCasesPerArm: 2, triggerFiles: [triggerFile], seed: "33".repeat(32) });
  const originalOutputRoot = outputRoot;
  for (const [index, unit] of mismatch.units.entries()) {
    const unitRoot = path.dirname(path.join(mismatchOutput, unit.input));
    const trace = Buffer.from("{}");
    fs.writeFileSync(path.join(unitRoot, "raw-review-trace.json"), trace);
    fs.writeFileSync(path.join(unitRoot, "review-output.json"), JSON.stringify({
      reviewer: { reviewMode: "codex_harness_manual", id: index ? "same-reviewer" : "different-reviewer",
        sessionId: `session-${index}`, protocolVersion: "v1", runtimeIdentity: "codex-desktop" },
      startedAt: "2026-08-03T12:00:00Z", completedAt: "2026-08-03T12:00:01Z", durationMs: 1000,
      rawReviewTraceArtifact: { path: "raw-review-trace.json",
        sha256: require("node:crypto").createHash("sha256").update(trace).digest("hex"),
        byteLength: trace.length, complete: true }, categoricalOutput
    }));
  }
  assert.throws(() => harness.seal({ campaignRoot: mismatchOutput, sealedRoot: mismatchSealed }),
    /identical manual reviewer protocol/);

  const escapeInput = { ...firstInput, __file: path.join(outputRoot, manifest.units[0].input) };
  const escapeWrapper = JSON.parse(fs.readFileSync(path.join(path.dirname(escapeInput.__file), "review-output.json"), "utf8"));
  escapeWrapper.rawReviewTraceArtifact.path = "../../../../outside.json";
  assert.throws(() => harness.verifyManualOutput({ wrapper: escapeWrapper, reviewInput: escapeInput }),
    /escapes its review unit/);
  const tamperedInput = { ...firstInput, __file: path.join(outputRoot, manifest.units[0].input) };
  const tamperedWrapper = JSON.parse(fs.readFileSync(path.join(path.dirname(tamperedInput.__file),
    "review-output.json"), "utf8"));
  fs.appendFileSync(path.join(path.dirname(tamperedInput.__file),
    tamperedInput.sources[0].manualReviewArtifacts[0].path), "tampered");
  assert.throws(() => harness.verifyManualOutput({ wrapper: tamperedWrapper, reviewInput: tamperedInput }),
    /Manual source artifact 0 mismatch/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("manual review harness tests passed\n");

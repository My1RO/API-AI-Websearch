#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const atomic = require("./run_atomic_evaluator.js");
assert.match(atomic.runtimeManifest.toString(), /runnerAuthority/);
const planner = require("./evaluator_packet_planner.js");

const discoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-discovery-"));
fs.writeFileSync(path.join(discoveryRoot, "POST_REFETCH_CAMPAIGN_READY.json"), "{}\n");
fs.mkdirSync(path.join(discoveryRoot, "ARM", "H001"), { recursive: true });
fs.writeFileSync(path.join(discoveryRoot, "ARM", "H001", "packet.json"), "{}\n");
assert.deepEqual(atomic.discoverPackets(discoveryRoot).map(({ armId, caseId }) => ({ armId, caseId })),
  [{ armId: "ARM", caseId: "H001" }]);
fs.rmSync(discoveryRoot, { recursive: true, force: true });

const text = "# Jane Doe\nPhone 555-0100\n";
const source = { sourceId: "s1", url: "https://example.test/jane", deliveredContent:
  `[CHAR_RANGE 0:${text.length}; complete_semantic_markdown]\n${text}`,
hostReadStatus: "read", snapshotCoverage: "full_normalized_snapshot", originalChars: text.length,
deliveredChars: text.length, silentlyTruncated: false, omittedRanges: [], fullTextSha256: planner.sha256(text) };
const packet = { identityContext: { request: { npi: "1234567890", name: "Jane Doe" } },
  sources: [source], claims: [{ sourceId: "s1", fieldType: "phone", value: "555-0100", modelCitation: {} }],
  preSanitizerCandidates: [], actionTrace: { calls: [{ type: "search", sourceIds: ["s1"] }], annotations: [] } };
const plan = atomic.buildAtomicPlan(packet, { countTokens: (value) => value.length, maximumChunkTokens: 10_000 });
assert.equal(plan.contextOverflowCount, 0);
assert.equal(plan.invalidNormalizations.length, 0);
assert.equal(plan.requestCount, 1);
assert.equal(plan.requests[0].input.sourceChunks[0].canonicalUrl, "https://example.test/jane");
assert.deepEqual(plan.requests[0].input.sourceChunks[0].roles, ["fact_cited", "consulted_search_source"]);
assert.equal(plan.requests[0].input.sourceChunks[0].text, text);
assert.deepEqual(plan.requests[0].input.factTargets, [{ targetIndex: 0, fieldType: "phone",
  value: "555-0100", citedSourceIndex: 0, modelCitation: {} }]);
assert.deepEqual(plan.requests[0].input.claims, [{ claimIndex: 0, targetIndex: 0 }]);
assert.equal(plan.requests[0].sectionMetrics.completeRequest.tokens, plan.requests[0].requestTokens);
assert.equal(plan.uniqueFactTargetCount, 1);
assert.equal(plan.intendedSourceByUniqueFactComparisonCount, 1);
assert.equal(plan.plannedSourceByUniqueFactComparisonCount, 1);
assert.equal(plan.sourceByUniqueFactComparisonMatrixComplete, true);
const parsed = { sourceChunkAssessments: [{ chunkIndex: 0, sourceClass: "Q1_exact_provider_first_party",
  identityAttachment: "strong_name_location", crossNpiConflict: "none",
  requestedNpiResolution: "name_location_only", professionalPurpose: "professional", dateStatus: "undated",
  providerIdentitySupported: true, prohibitedForDisplay: false, declaredDates: [],
  evidenceQuotes: ["# Jane Doe"], notes: "supported" }],
claimChunkAssessments: [{ chunkIndex: 0, claimIndex: 0, support: "exact", sourceEligibility: "eligible",
  identityLink: "strong_name_location", locationLink: "not_applicable", displaySafety: "professional",
  recency: "undated", fieldValidity: "valid", crossNpiConflict: "none",
  requestedNpiResolution: "name_location_only", evidenceQuotes: ["Phone 555-0100"], reason: "verbatim" }],
candidateChunkAssessments: [] };
assert.equal(atomic.validateAtomicOutput(parsed, plan.requests[0], 1), true);
const completed = [{ plannedRequest: plan.requests[0], parsed }];
const merged = atomic.mergeAtomicOutputs(packet, plan, completed);
assert.equal(merged.hostInventedSemanticCategories, false);
assert.equal(merged.evidence.length, 2);
assert.equal(merged.quoteAttributionAudit.rejectedQuoteCount, 0);
assert.deepEqual(merged.claimSourceAssessments[0].observedSupportCategories, ["exact"]);
assert.equal(atomic.assertAtomicCompletion(packet, plan, completed), true);
assert.throws(() => atomic.assertAtomicCompletion(packet, plan, []), /completion cardinality mismatch/);
assert.throws(() => atomic.assertAtomicCompletion(packet, plan, [...completed, ...completed]),
  /completion cardinality mismatch/);
assert.deepEqual(atomic.quoteOccurrences(plan.requests[0].units[0], "# Jane Doe"), [{
  absoluteStart: 0, absoluteEnd: "# Jane Doe".length, verificationMode: "byte_exact"
}]);
assert.equal(atomic.quoteOccurrences(plan.requests[0].units[0], "# Jane Doe Phone 555-0100")[0]
  .verificationMode, "whitespace_normalized");
const linkedUnit = { deliveredStart: 0,
  deliveredContent: "[SOURCE s; ABS_CHAR_RANGE 0:64; CORE 0:64; SHA256 fixture]\nProvider Type\nSurgery (https://example.test/surgery)\n208600000X" };
assert.equal(atomic.quoteOccurrences(linkedUnit, "Provider Type Surgery 208600000X")[0]
  .verificationMode, "rendered_link_target_normalized");
const linkedPunctuationUnit = { deliveredStart: 0,
  deliveredContent: "[SOURCE]\nPrimary taxonomy is Behavioral Analyst (103K00000X) (https://example.test/taxonomy)." };
assert.equal(atomic.quoteOccurrences(linkedPunctuationUnit,
  "Primary taxonomy is Behavioral Analyst (103K00000X).")[0]
  .verificationMode, "rendered_link_target_normalized");
assert.deepEqual(atomic.quoteOccurrences(linkedUnit, "Provider practices at another address"), []);
const inventedQuote = { ...parsed,
  claimChunkAssessments: [{ ...parsed.claimChunkAssessments[0], evidenceQuotes: ["invented"] }] };
assert.equal(atomic.validateAtomicOutput(inventedQuote, plan.requests[0], 1), true,
  "an unattributed audit excerpt must not discard the categorical judgment");
assert.equal(atomic.auditAtomicEvidenceQuotes(inventedQuote, plan.requests[0]).rejectedQuoteCount, 1);

const duplicateCandidatePacket = { ...packet, preSanitizerCandidates: [{ ...packet.claims[0],
  modelCitation: { z: null, a: null }, sanitizerActionObserved: "kept", sanitizerReasonCode: null }],
  claims: [{ ...packet.claims[0], modelCitation: { a: null, z: null } }] };
const duplicateCandidatePlan = atomic.buildAtomicPlan(duplicateCandidatePacket, {
  countTokens: (value) => value.length, maximumChunkTokens: 10_000
});
assert.equal(duplicateCandidatePlan.uniqueFactTargetCount, 1,
  "an identical claim/candidate evidence target must be transported once");
assert.deepEqual(duplicateCandidatePlan.requests[0].input.candidates,
  [{ candidateIndex: 0, targetIndex: 0 }]);
assert.equal(duplicateCandidatePlan.intendedSourceByUniqueFactComparisonCount, 1,
  "deduplication must preserve every source by unique semantic fact comparison");
assert.equal(duplicateCandidatePlan.requests[0].assessmentRows, 3,
  "the frozen output schema still returns separate claim and candidate rows");
assert.throws(() => atomic.buildAtomicPlan({ ...packet, claims: [{ ...packet.claims[0], sourceId: "missing" }] },
  { countTokens: (value) => value.length, maximumChunkTokens: 10_000 }), /unknown packet source/);

const metadataOnly = { ...source, sourceId: "s2", url: "https://example.test/unreadable",
  snapshotCoverage: "metadata_only_unavailable", hostReadStatus: "unavailable",
  originalChars: 0, deliveredChars: 0, deliveredContent: "", fullTextSha256: null };
const twoSourcePacket = { ...packet, sources: [source, metadataOnly], actionTrace: {
  calls: [{ type: "search", sourceIds: ["s1", "s2"] }], annotations: []
} };
const twoSourcePlan = atomic.buildAtomicPlan(twoSourcePacket, {
  countTokens: (value) => value.length, maximumChunkTokens: 10_000
});
assert.equal(twoSourcePlan.unitCount, 2);
assert.deepEqual(twoSourcePlan.requests.flatMap((request) => request.units.map((unit) => unit.sourceId)).sort(), ["s1", "s2"]);
assert(twoSourcePlan.requests.every((request) => request.input.claims.length === packet.claims.length));
const rowBounded = atomic.buildAtomicPlan(twoSourcePacket, {
  countTokens: (value) => value.length, maximumChunkTokens: 10_000, maximumAssessmentRows: 2
});
assert.equal(rowBounded.requestCount, 2);
assert(rowBounded.requests.every((request) => request.assessmentRows <= 2));
assert(rowBounded.requests.every((request) => request.request.max_output_tokens === 48_000));
const rowInadmissible = atomic.buildAtomicPlan(packet, {
  countTokens: (value) => value.length, maximumChunkTokens: 10_000, maximumAssessmentRows: 1
});
assert(rowInadmissible.manualReviewReasons.some((item) =>
  item.reason === "ATOMIC_ASSESSMENT_ROW_BUDGET_EXCEEDED"));
assert.equal(atomic.assertEvaluatorAdmission([{ armId: "A", caseId: "P001", plan }]), true);
assert.throws(() => atomic.assertEvaluatorAdmission([{ armId: "A", caseId: "P002", plan: {
  ...plan, invalidNormalizations: [{ sourceId: "bad" }]
} }]), /EVALUATOR_ADMISSION_FAILED.*invalid_normalization_cells=1/);
assert.throws(() => atomic.assertEvaluatorAdmission([{ armId: "A", caseId: "P003", plan: {
  ...plan, contextOverflowCount: 1
} }]), /EVALUATOR_ADMISSION_FAILED.*context_overflow_cells=1/);
assert.equal(atomic.estimateCost({ input_tokens: 1000, input_tokens_details: { cached_tokens: 200 },
  output_tokens: 100 }).estimatedUsd, 0.0071);

const rootGuardParent = fs.mkdtempSync(path.join(os.tmpdir(), "evaluator-output-guard-"));
try {
  const freshRoot = path.join(rootGuardParent, "fresh");
  assert.equal(atomic.assertFreshOutputRoot(freshRoot), freshRoot);
  fs.writeFileSync(path.join(freshRoot, "existing.json"), "{}");
  assert.throws(() => atomic.assertFreshOutputRoot(freshRoot), /must be absent or empty/);
  const seal = atomic.makeCampaignPlanSeal("fixture", { requestSha256: "abc", schemaSha256: "def" });
  const sealFile = path.join(rootGuardParent, "dry-seal.json");
  fs.writeFileSync(sealFile, JSON.stringify(seal));
  assert.equal(atomic.verifyExpectedPlanSeal(sealFile, seal), true);
  const drifted = atomic.makeCampaignPlanSeal("fixture", { requestSha256: "changed", schemaSha256: "def" });
  assert.throws(() => atomic.verifyExpectedPlanSeal(sealFile, drifted), /differs from dry admission seal/);
  const sourceAuthority = "a".repeat(64);
  const resumeSeal = atomic.makeCampaignPlanSeal("provider_atomic_evaluator", {
    runtimeManifest: { runnerAuthority: { authoritySha256: sourceAuthority } }, requests: ["fixed"]
  });
  const resumeSealFile = path.join(rootGuardParent, "resume-dry-seal.json");
  fs.writeFileSync(resumeSealFile, JSON.stringify(resumeSeal));
  assert.equal(atomic.verifyResumePlanSeal({ expectedDryPlanSealFile: resumeSealFile,
    existingLivePlanSeal: resumeSeal, recomputedPlanSeal: resumeSeal,
    sourceEvaluatorAuthoritySha256: sourceAuthority }), true);
  assert.throws(() => atomic.verifyResumePlanSeal({ expectedDryPlanSealFile: resumeSealFile,
    existingLivePlanSeal: resumeSeal, recomputedPlanSeal: resumeSeal,
    sourceEvaluatorAuthoritySha256: "b".repeat(64) }), /source authority differs/);

  const sourceRunnerAuthority = { schemaVersion: 2, authority: "unified_provider_evaluator",
    authoritySha256: sourceAuthority, files: [
    { name: "run_atomic_evaluator.js", sha256: "1".repeat(64), byteLength: 100 },
    { name: "compile_corrected_campaign.js", sha256: "5".repeat(64), byteLength: 300 },
    { name: "run_evaluator_campaign.js", sha256: "2".repeat(64), byteLength: 200 }
  ] };
  const resumeRunnerAuthority = { schemaVersion: 2, authority: "unified_provider_evaluator",
    authoritySha256: "c".repeat(64), files: [
    { name: "run_atomic_evaluator.js", sha256: "3".repeat(64), byteLength: 120 },
    { name: "compile_corrected_campaign.js", sha256: "6".repeat(64), byteLength: 320 },
    { name: "run_evaluator_campaign.js", sha256: "2".repeat(64), byteLength: 200 }
  ] };
  const sourceTransitionSeal = atomic.makeCampaignPlanSeal("provider_atomic_evaluator", {
    runtimeManifest: { evaluatorScript: { path: "/fixed/run_atomic_evaluator.js", sha256: "1".repeat(64) },
      runnerAuthority: sourceRunnerAuthority, model: "gpt-5.6-sol", reasoning: "high" },
    requests: ["fixed"]
  });
  const resumeTransitionSeal = atomic.makeCampaignPlanSeal("provider_atomic_evaluator", {
    runtimeManifest: { evaluatorScript: { path: "/fixed/run_atomic_evaluator.js", sha256: "3".repeat(64) },
      runnerAuthority: resumeRunnerAuthority, model: "gpt-5.6-sol", reasoning: "high" },
    requests: ["fixed"]
  });
  const sourceTransitionFile = path.join(rootGuardParent, "source-transition-seal.json");
  fs.writeFileSync(sourceTransitionFile, JSON.stringify(sourceTransitionSeal));
  assert.equal(atomic.verifyResumePlanSeal({ expectedDryPlanSealFile: sourceTransitionFile,
    existingLivePlanSeal: sourceTransitionSeal, recomputedPlanSeal: resumeTransitionSeal,
    sourceEvaluatorAuthoritySha256: sourceAuthority }), true,
  "resume may change only the atomic runner and compiler authority while preserving the sealed plan");
  const disallowedTransitionSeal = atomic.makeCampaignPlanSeal("provider_atomic_evaluator", {
    runtimeManifest: { evaluatorScript: { path: "/fixed/run_atomic_evaluator.js", sha256: "3".repeat(64) },
      runnerAuthority: { ...resumeRunnerAuthority, files: [resumeRunnerAuthority.files[0],
        resumeRunnerAuthority.files[1],
        { name: "run_evaluator_campaign.js", sha256: "4".repeat(64), byteLength: 201 }] },
      model: "gpt-5.6-sol", reasoning: "high" },
    requests: ["fixed"]
  });
  assert.throws(() => atomic.verifyResumePlanSeal({ expectedDryPlanSealFile: sourceTransitionFile,
    existingLivePlanSeal: sourceTransitionSeal, recomputedPlanSeal: disallowedTransitionSeal,
    sourceEvaluatorAuthoritySha256: sourceAuthority }), /changes disallowed files: run_evaluator_campaign\.js/);
} finally {
  fs.rmSync(rootGuardParent, { recursive: true, force: true });
}

const realShapedFilter = JSON.parse(fs.readFileSync(path.join(__dirname,
  "fixtures/atomic_incomplete_content_filter_h010.json"), "utf8"));
assert.equal(atomic.classifyEvaluatorInsufficiency(realShapedFilter).reason, "EVALUATOR_CONTENT_FILTER");
assert.equal(atomic.classifyEvaluatorInsufficiency({ status: "incomplete",
  incomplete_details: { reason: "max_output_tokens" } }).reason, "EVALUATOR_MAX_OUTPUT_TOKENS");
assert.equal(atomic.classifyEvaluatorInsufficiency({ status: "completed", output: [{ type: "message",
  content: [{ type: "refusal", refusal: "cannot comply" }] }] }).reason, "EVALUATOR_REFUSAL");
assert.deepEqual([...atomic.pairedOperationalCensorCaseIds([
  { caseId: "P006", packet: { evaluationGate: { productionOutcome: "operational_censor_content_filter" } } },
  { caseId: "P006", packet: { evaluationGate: null } },
  { caseId: "P007", packet: { evaluationGate: null } }
])], ["P006"]);

const resumeArtifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-resume-artifacts-"));
try {
  assert.throws(() => atomic.assertResumeOutputRoot(resumeArtifactRoot), /missing summary.json/);
  for (const name of ["summary.json", "CAMPAIGN_PLAN_SEAL.json", "manual-review-required.json"])
    fs.writeFileSync(path.join(resumeArtifactRoot, name), "{}\n");
  assert.equal(atomic.assertResumeOutputRoot(resumeArtifactRoot), resumeArtifactRoot);
  const resumeCell = { dir: resumeArtifactRoot, packet };
  const raw = { id: "resp_preserved", status: "completed", output_text: JSON.stringify(parsed),
    usage: { input_tokens: 10, output_tokens: 5 } };
  fs.writeFileSync(path.join(resumeArtifactRoot, "raw-0-semantic-01.json"), JSON.stringify(raw));
  fs.writeFileSync(path.join(resumeArtifactRoot, "parsed-0.json"), JSON.stringify(parsed));
  fs.writeFileSync(path.join(resumeArtifactRoot, "result-0.json"), JSON.stringify({
    schemaVersion: 1, status: "completed", requestIndex: 0, responseId: raw.id,
    attempts: [{ rawFile: "raw-0-semantic-01.json", responseId: raw.id, usage: raw.usage }]
  }));
  const preserved = atomic.inspectAtomicResumeItem({ cell: resumeCell, plannedRequest: plan.requests[0] });
  assert.equal(preserved.disposition, "completed");
  assert.equal(preserved.output.parsed.claimChunkAssessments[0].support, "exact");

  fs.rmSync(path.join(resumeArtifactRoot, "result-0.json"));
  fs.rmSync(path.join(resumeArtifactRoot, "parsed-0.json"));
  const inspectedRecovery = atomic.inspectAtomicResumeItem(
    { cell: resumeCell, plannedRequest: plan.requests[0] }, { readOnly: true });
  assert.equal(inspectedRecovery.disposition, "completed");
  assert.equal(inspectedRecovery.recoveredWithoutPaidCall, true);
  assert.equal(fs.existsSync(path.join(resumeArtifactRoot, "result-0.json")), false,
    "read-only resume inspection must not materialize a recovered result");
  assert.equal(fs.existsSync(path.join(resumeArtifactRoot, "parsed-0.json")), false,
    "read-only resume inspection must not materialize a recovered parsed artifact");
  const recovered = atomic.inspectAtomicResumeItem({ cell: resumeCell, plannedRequest: plan.requests[0] });
  assert.equal(recovered.disposition, "completed");
  assert.equal(recovered.recoveredWithoutPaidCall, true,
    "an orphaned successful raw response must be recovered without another paid call");
  assert.equal(JSON.parse(fs.readFileSync(path.join(resumeArtifactRoot, "result-0.json"), "utf8"))
    .recoveredFromOrphanedSuccessfulArtifacts, true);

  fs.rmSync(path.join(resumeArtifactRoot, "result-0.json"));
  fs.rmSync(path.join(resumeArtifactRoot, "parsed-0.json"));
  fs.rmSync(path.join(resumeArtifactRoot, "raw-0-semantic-01.json"));
  const missing = atomic.inspectAtomicResumeItem({ cell: resumeCell, plannedRequest: plan.requests[0] });
  assert.equal(missing.disposition, "retry");
  assert.equal(missing.reason, "MISSING_PLANNED_RESULT");

  fs.writeFileSync(path.join(resumeArtifactRoot, "transport-error-0.json"), JSON.stringify({
    status: "transport_error_after_native_retries", error: { message: "offline" }
  }));
  fs.writeFileSync(path.join(resumeArtifactRoot, "result-0.json"), JSON.stringify({
    schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", requestIndex: 0,
    reason: "EVALUATOR_TRANSPORT_FAILURE", attempts: [{ semanticAttempt: null,
      rawFile: "transport-error-0.json", responseId: null, usage: null }]
  }));
  const transport = atomic.inspectAtomicResumeItem({ cell: resumeCell, plannedRequest: plan.requests[0] });
  assert.equal(transport.disposition, "retry");
  const transportBackup = atomic.preservePreResumeResult(transport);
  assert.equal(fs.existsSync(transportBackup.path), true);
  assert.equal(fs.existsSync(transportBackup.priorAttempts[0].path), true);
  assert.equal(fs.existsSync(path.join(resumeArtifactRoot, "result-0.json")), false);
  assert.equal(fs.existsSync(path.join(resumeArtifactRoot, "transport-error-0.json")), true,
    "the original transport trace remains addressable while its immutable backup prevents overwrite loss");

  const enospcFixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    "fixtures/atomic_resume_enospc_response_artifact_loss_p044.json"), "utf8"));
  const enospcRoot = path.join(resumeArtifactRoot, "real-enospc-p044");
  fs.mkdirSync(enospcRoot);
  for (const artifact of enospcFixture.semanticRawArtifacts) {
    fs.writeFileSync(path.join(enospcRoot, artifact.fileName), Buffer.alloc(artifact.byteLength));
  }
  fs.writeFileSync(path.join(enospcRoot, "transport-error-4.json"),
    JSON.stringify(enospcFixture.transportError));
  fs.writeFileSync(path.join(enospcRoot, "result-4.json"), JSON.stringify(enospcFixture.result));
  const enospc = atomic.inspectAtomicResumeItem({ cell: { dir: enospcRoot, packet },
    plannedRequest: { ...plan.requests[0], requestIndex: enospcFixture.requestIndex } });
  assert.equal(enospc.disposition, "retry");
  assert.equal(enospc.reason, "EVALUATOR_RESPONSE_ARTIFACT_LOSS");
  assert.equal(enospc.retryClass, "explicit_single_artifact_loss_recovery");
  assert.equal(enospc.responseBearingArtifactLoss, true);
  assert.deepEqual(enospc.responseArtifacts.map(({ fileName, byteLength, readableJson }) =>
    ({ fileName, byteLength, readableJson })), [{ fileName: "raw-4-semantic-01.json",
    byteLength: 0, readableJson: false }]);

  assert.throws(() => atomic.assertDiskHeadroom(enospcRoot, { minimumFreeBytes: 1024,
    statfsSync: () => ({ bavail: 1, bsize: 512 }) }),
  (error) => error.code === "EVALUATOR_ARTIFACT_LOSS_DISK_HEADROOM_INSUFFICIENT");
  const diskHeadroom = atomic.assertDiskHeadroom(enospcRoot, { minimumFreeBytes: 1024,
    statfsSync: () => ({ bavail: 4, bsize: 512 }) });
  assert.equal(diskHeadroom.observedFreeBytes, 2048);

  const recoveryRow = { task: { cell: { dir: enospcRoot, packet,
    armId: enospcFixture.armId, caseId: enospcFixture.caseId },
  plannedRequest: { ...plan.requests[0], requestIndex: enospcFixture.requestIndex } }, inspection: enospc };
  const archived = atomic.preservePreResumeResult(enospc);
  assert.equal(fs.existsSync(archived.path), true);
  assert.equal(archived.responseArtifacts.length, 1);
  assert.equal(fs.existsSync(archived.responseArtifacts[0].path), true);
  const journal = atomic.prepareArtifactLossRecovery({ row: recoveryRow, priorResult: archived,
    diskHeadroom });
  assert.equal(journal.journal.originalAttempt.billingDisposition, "possibly_billed_unknown_cost");
  assert.equal(journal.journal.recoveryLimit, 1);

  fs.writeFileSync(path.join(enospcRoot, "raw-4-semantic-01.json"), JSON.stringify(raw));
  fs.writeFileSync(path.join(enospcRoot, "parsed-4.json"), JSON.stringify(parsed));
  fs.writeFileSync(path.join(enospcRoot, "result-4.json"), JSON.stringify({
    schemaVersion: 1, status: "completed", requestIndex: 4, responseId: raw.id,
    totalEstimatedUsd: 0.03, attempts: [{ semanticAttempt: 1, rawFile: "raw-4-semantic-01.json",
      responseId: raw.id, usage: raw.usage, estimatedCost: { estimatedUsd: 0.03 } }]
  }));
  atomic.attachArtifactLossRecoveryLineage({ row: recoveryRow, recoveryJournal: journal });
  const recoveredArtifactLoss = JSON.parse(fs.readFileSync(path.join(enospcRoot, "result-4.json"), "utf8"));
  assert.equal(recoveredArtifactLoss.attempts.length, 2);
  assert.equal(recoveredArtifactLoss.attempts[0].billingDisposition, "possibly_billed_unknown_cost");
  assert.equal(recoveredArtifactLoss.attempts[0].usage, null);
  assert.equal(recoveredArtifactLoss.totalEstimatedUsd, 0.03);
  assert.equal(recoveredArtifactLoss.artifactLossRecovery.knownReplacementEstimatedUsd, 0.03);
  assert.equal(recoveredArtifactLoss.artifactLossRecovery.totalCostDisposition,
    "known_replacement_plus_unknown_original");

  fs.rmSync(path.join(enospcRoot, "result-4.json"));
  fs.rmSync(path.join(enospcRoot, "parsed-4.json"));
  fs.writeFileSync(path.join(enospcRoot, "raw-4-semantic-01.json"), Buffer.alloc(0));
  const exhausted = atomic.inspectAtomicResumeItem({ cell: recoveryRow.task.cell,
    plannedRequest: recoveryRow.task.plannedRequest });
  assert.equal(exhausted.disposition, "manual");
  assert.equal(exhausted.reason, "EVALUATOR_RESPONSE_ARTIFACT_LOSS_RECOVERY_EXHAUSTED");

  const orphanedRoot = path.join(resumeArtifactRoot, "orphaned-enospc");
  fs.mkdirSync(orphanedRoot);
  fs.writeFileSync(path.join(orphanedRoot, "raw-4-semantic-01.json"), Buffer.alloc(0));
  const orphanedTask = { cell: { dir: orphanedRoot, packet, armId: enospcFixture.armId,
    caseId: enospcFixture.caseId }, plannedRequest: recoveryRow.task.plannedRequest };
  const orphanedEnospc = atomic.inspectAtomicResumeItem(orphanedTask);
  assert.equal(orphanedEnospc.disposition, "retry");
  assert.equal(orphanedEnospc.reason, "EVALUATOR_RESPONSE_ARTIFACT_LOSS");
  const orphanedArchived = atomic.preservePreResumeResult(orphanedEnospc);
  atomic.prepareArtifactLossRecovery({ row: { task: orphanedTask, inspection: orphanedEnospc },
    priorResult: orphanedArchived, diskHeadroom });
  const orphanedExhausted = atomic.inspectAtomicResumeItem(orphanedTask);
  assert.equal(orphanedExhausted.disposition, "manual");
  assert.equal(orphanedExhausted.reason, "EVALUATOR_RESPONSE_ARTIFACT_LOSS_RECOVERY_EXHAUSTED");

  const timeoutFixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    "fixtures/atomic_resume_preresponse_timeout_p043.json"), "utf8"));
  const timeoutRoot = path.join(resumeArtifactRoot, "real-timeout-p043");
  fs.mkdirSync(timeoutRoot);
  fs.writeFileSync(path.join(timeoutRoot, "transport-error-5.json"),
    JSON.stringify(timeoutFixture.transportError));
  fs.writeFileSync(path.join(timeoutRoot, "result-5.json"), JSON.stringify(timeoutFixture.result));
  const timeout = atomic.inspectAtomicResumeItem({ cell: { dir: timeoutRoot, packet },
    plannedRequest: { ...plan.requests[0], requestIndex: timeoutFixture.requestIndex } });
  assert.equal(timeout.disposition, "retry");
  assert.equal(timeout.reason, "EVALUATOR_TRANSPORT_FAILURE");
} finally {
  fs.rmSync(resumeArtifactRoot, { recursive: true, force: true });
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-semantic-attempts-"));
  try {
    const cell = { dir: directory, packet };
    const exhaustedClient = { responses: { create: async () => structuredClone(realShapedFilter) } };
    const exhausted = await atomic.executeAtomicSemanticAttempts({ client: exhaustedClient, cell,
      plannedRequest: plan.requests[0] });
    assert.equal(exhausted.status, "manual_review_required");
    assert.equal(exhausted.attempts.length, 2);
    assert.equal(fs.existsSync(path.join(directory, "raw-0-semantic-01.json")), true);
    assert.equal(fs.existsSync(path.join(directory, "raw-0-semantic-02.json")), true);
    const exhaustedResult = JSON.parse(fs.readFileSync(path.join(directory, "result-0.json"), "utf8"));
    assert.equal(exhaustedResult.retryPolicy.semanticAttemptsUsed, 2);
    assert.equal(exhaustedResult.disposition, "evaluator_sufficiency_exception_not_arm_failure");

    const maxOutputClient = { responses: { create: async () => ({ status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 2, output_tokens: 48_000 } }) } };
    const maxOutput = await atomic.executeAtomicSemanticAttempts({ client: maxOutputClient,
      cell: { ...cell, dir: path.join(directory, "max-output") }, plannedRequest: plan.requests[0] });
    assert.equal(maxOutput.status, "manual_review_required");
    assert.equal(maxOutput.attempts.length, 1, "an identical max-output request must not be retried");

    const firstFiltered = structuredClone(realShapedFilter);
    firstFiltered.usage = { input_tokens: 2, output_tokens: 3 };
    const responses = [firstFiltered, { id: "resp_success", status: "completed",
      output_text: JSON.stringify(parsed), usage: { input_tokens: 1, output_tokens: 1 } }];
    const retryClient = { responses: { create: async () => responses.shift() } };
    const recovered = await atomic.executeAtomicSemanticAttempts({ client: retryClient,
      cell: { ...cell, dir: path.join(directory, "recovered") }, plannedRequest: plan.requests[0] });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.attempts.length, 2);
    const recoveredResult = JSON.parse(fs.readFileSync(path.join(directory, "recovered", "result-0.json"), "utf8"));
    const expectedCost = atomic.estimateCost({ input_tokens: 2, output_tokens: 3 }).estimatedUsd
      + atomic.estimateCost({ input_tokens: 1, output_tokens: 1 }).estimatedUsd;
    assert.equal(recoveredResult.totalEstimatedUsd, expectedCost);

    const malformedClient = { responses: { create: async () => ({ status: "completed", output_text: "not-json" }) } };
    const malformed = await atomic.executeAtomicSemanticAttempts({ client: malformedClient,
      cell: { ...cell, dir: path.join(directory, "malformed") }, plannedRequest: plan.requests[0] });
    assert.equal(malformed.status, "manual_review_required");
    assert.equal(malformed.reason, "EVALUATOR_MALFORMED_OUTPUT");
    assert.equal(malformed.attempts.length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  process.stdout.write("atomic evaluator tests passed\n");
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

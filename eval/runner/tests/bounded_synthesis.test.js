#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const synthesis = require("../core/run_bounded_synthesis.js");
assert.match(synthesis.INSTRUCTIONS, /registry-record.*does not date a displayed fact/i);

const discoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "synthesis-discovery-"));
fs.writeFileSync(path.join(discoveryRoot, "POST_REFETCH_CAMPAIGN_READY.json"), "{}\n");
fs.mkdirSync(path.join(discoveryRoot, "ARM", "H001"), { recursive: true });
fs.writeFileSync(path.join(discoveryRoot, "ARM", "H001", "packet.json"), "{}\n");
assert.deepEqual(synthesis.discoverPackets(discoveryRoot).map(({ armId, caseId }) => ({ armId, caseId })),
  [{ armId: "ARM", caseId: "H001" }]);
fs.rmSync(discoveryRoot, { recursive: true, force: true });

const packet = {
  caseId: "P001",
  identityContext: { request: { npi: "1234567890", name: "Jane Doe" } },
  evaluationGate: null,
  evaluationGuidance: null,
  claims: [{ claimId: "c0", fieldType: "phone", value: "555-0100", sourceId: "s0", modelCitation: {} }],
  preSanitizerCandidates: [{ candidateFactId: "p0", fieldType: "phone", value: "555-0100",
    sourceId: "s0", modelCitation: {}, sanitizerActionObserved: "kept" }],
  expectedFields: ["phone", "address", "website", "rating", "specialty"],
  actionTrace: { calls: [], annotations: [] },
  sources: [{ sourceId: "s0", url: "https://example.test/jane", hostReadStatus: "read",
    snapshotCoverage: "full_normalized_snapshot", deliveredContent: "THIS MUST NOT ENTER SYNTHESIS" }]
};
const sourceRow = (chunkIndex, sourceClass) => ({ chunkIndex, sourceClass,
  identityAttachment: "exact_npi", crossNpiConflict: "none", requestedNpiResolution: "exact_requested_npi",
  professionalPurpose: "professional", dateStatus: "undated", providerIdentitySupported: true,
  prohibitedForDisplay: false, declaredDates: [], evidenceQuotes: ["Phone 555-0100"], notes: "atomic" });
const factRow = (indexName, index, chunkIndex, support) => ({ chunkIndex, [indexName]: index, support,
  identityLink: "exact_npi", locationLink: "not_applicable", displaySafety: "professional",
  recency: "undated", fieldValidity: "valid", sourceEligibility: "eligible", crossNpiConflict: "none",
  requestedNpiResolution: "exact_requested_npi", evidenceQuotes: ["Phone 555-0100"], reason: "atomic" });
const merged = {
  status: "atomic_read_complete",
  invalidNormalizations: [],
  sourceCoverage: [{ sourceIndex: 0, sourceId: "s0", mode: "complete_source_chunks",
    fullOriginalSourceModelRead: true, workbookRetrievalAudit: null }],
  sourceAssessments: [{ sourceId: "s0", chunkAssessments: [sourceRow(0, "Q1_exact_provider_first_party"),
    sourceRow(1, "Q2_exact_provider_government")] }],
  claimSourceAssessments: [{ claimIndex: 0, sourceId: "s0",
    chunkAssessments: [factRow("claimIndex", 0, 0, "exact"), factRow("claimIndex", 0, 1, "not_found")] }],
  candidateSourceAssessments: [{ candidateIndex: 0, sourceId: "s0",
    chunkAssessments: [factRow("candidateIndex", 0, 0, "exact"), factRow("candidateIndex", 0, 1, "exact")] }],
  evidence: [{ sourceId: "s0", absoluteStart: 10, absoluteEnd: 24, quote: "Phone 555-0100" }]
};

const compact = synthesis.compactAtomicInput(packet, merged);
assert.doesNotMatch(JSON.stringify(compact), /THIS MUST NOT ENTER SYNTHESIS/);
assert.equal(compact.atomicSourceReadings[0].groups.length, 2,
  "conflicting atomic categories must survive for Sol synthesis");
assert.equal(compact.atomicCandidateReadings[0].sourceReadings[0].groups[0].count, 2,
  "identical atomic categories are losslessly grouped by count and chunk indices");
assert.deepEqual(compact.atomicClaimReadings[0].sourceReadings[0].groups[0].evidenceIndices, [0],
  "every grouped categorical reading retains its verified evidence binding");
assert.equal(compact.completeness.everyOriginalSourceFullyModelRead, true);
assert.equal(compact.sources[0].canonicalUrl, "https://example.test/jane");
assert.equal(compact.sources[0].host, "example.test");
assert.deepEqual(compact.sources[0].roles, ["fact_cited"]);
const plan = synthesis.buildSynthesisPlan(packet, merged, {
  countTokens: (value) => value.length,
  textFormat: () => ({ type: "json_schema", name: "fixture", strict: true, schema: { type: "object" } })
});
assert.equal(plan.status, "ready");
assert.match(plan.request.instructions, /exactSupport assesses all eligible readable evidence returned by this arm/);
assert.match(plan.request.instructions, /Q1 exact-provider first-party evidence precedes Q2/);
assert.match(plan.request.instructions, /registry-record.*does not date a displayed fact/);
assert.match(plan.request.instructions, /verified quote ties a date.*to that exact value and fact/);
assert.match(plan.request.instructions, /clinical specialty and an NPPES taxonomy do not contradict each other merely/);
assert.match(plan.request.instructions,
  /OFFICIAL_WEBSITE_MISREPRESENTATION requires at least one emitted website whose fieldValidity is invalid/);
const clarifiedSchema = require("../core/synthesis_judge_schema.js")
  .CategoricalJudgeSchema;
assert.match(clarifiedSchema.shape.claimAssessments.element.shape.exactSupport.description,
  /Whole-packet semantic support/);
assert.match(clarifiedSchema.shape.candidateDecisionAssessments.element.shape.exactSupport.description,
  /Whole-packet semantic support/);
assert(plan.requestTokens < plan.maximumInputTokens);
assert.equal(synthesis.estimateCost({ input_tokens: 1000, input_tokens_details: { cached_tokens: 200 },
  output_tokens: 100 }).estimatedUsd, 0.0071);
const manualRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bounded-synthesis-manual-"));
try {
  fs.writeFileSync(path.join(manualRoot, "manual-review-required.json"), JSON.stringify({
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", caseIds: ["P003"]
  }));
  fs.writeFileSync(path.join(manualRoot, "manual-review-required-runtime.json"), JSON.stringify({
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", caseIds: ["P010"]
  }));
  fs.writeFileSync(path.join(manualRoot, "operational-censor-cases.json"), JSON.stringify({
    status: "PAIRED_OPERATIONAL_CENSOR",
    disposition: "content_filter_exhaustion_not_arm_quality_failure",
    caseIds: ["P006", "P016"]
  }));
  assert.deepEqual([...synthesis.atomicManualCaseIds(manualRoot)].sort(), ["P003", "P010"]);
  assert.deepEqual([...synthesis.atomicOperationalCensorCaseIds(manualRoot)].sort(), ["P006", "P016"]);
} finally {
  fs.rmSync(manualRoot, { recursive: true, force: true });
}
const asymmetricPlans = [
  { armId: "A", caseId: "H001", plan: { status: "EVALUATOR_MANUAL_REVIEW_REQUIRED" } },
  { armId: "B", caseId: "H001", plan: { status: "ready" } },
  { armId: "C", caseId: "H001", plan: { status: "ready" } },
  { armId: "A", caseId: "H002", plan: { status: "ready" } },
  { armId: "B", caseId: "H002", plan: { status: "ready" } },
  { armId: "C", caseId: "H002", plan: { status: "ready" } }
];
const asymmetricDisposition = synthesis.summarizeSynthesisPlans(asymmetricPlans);
assert.deepEqual([...asymmetricDisposition.manualCaseIds], ["H001"]);
assert.equal(asymmetricDisposition.plannedReadyCells, 5);
assert.equal(asymmetricDisposition.executableReadyCells, 3,
  "ready sibling arms of an overflow case must be excluded from executable readiness");
assert.equal(asymmetricDisposition.executableReadyCells + 3 * asymmetricDisposition.manualCaseIds.size,
  asymmetricPlans.length);

const evidenceSpan = { sourceIndex: 0, quote: "Phone 555-0100", polarity: "supports", locatorHint: "phone" };
const factual = { exactSupport: "exact", identityLink: "exact_npi", locationLink: "not_applicable",
  displaySafety: "professional", recency: "undated", fieldValidity: "valid", sourceEligibility: "eligible",
  crossNpiConflict: "none", requestedNpiResolution: "exact_requested_npi" };
const output = {
  sourceAssessments: [{ sourceIndex: 0, sourceClass: "Q1_exact_provider_first_party",
    identityAttachment: "exact_npi", crossNpiConflict: "none", requestedNpiResolution: "exact_requested_npi",
    professionalPurpose: "professional", dateStatus: "undated", providerIdentitySupported: true,
    prohibitedForDisplay: false, declaredDates: [], notes: "synthesized" }],
  identityAssessment: { npiEntity: "exact", nameMatch: "exact", requestedLocationMatch: "not_established",
    evidenceSpans: [evidenceSpan], reason: "exact NPI" },
  claimAssessments: [{ claimIndex: 0, citedSourceSupport: "exact", providerIdentitySpanFidelity: "not_supplied",
    factSpanFidelity: "not_supplied", explicitDateSpanFidelity: "not_supplied", ...factual,
    evidenceSpans: [evidenceSpan], reason: "supported" }],
  candidateDecisionAssessments: [{ candidateIndex: 0, providerIdentitySpanFidelity: "not_supplied",
    factSpanFidelity: "not_supplied", explicitDateSpanFidelity: "not_supplied", ...factual,
    actionFidelity: "conforms", evidenceSpans: [evidenceSpan], reason: "kept supported candidate" }],
  fieldAssessments: packet.expectedFields.map((_, fieldIndex) => ({ fieldIndex,
    topFactDisposition: fieldIndex === 0 ? "supported_but_undated" : fieldIndex === 3
      ? "indeterminate" : "missing_no_eligible_arm_found_fact",
    crossNpiConflict: "none", requestedNpiResolution: fieldIndex === 0 ? "exact_requested_npi" : "none",
    armFoundBestEligibleClass: fieldIndex === 0 ? "Q1" : fieldIndex === 3 ? "indeterminate" : "none",
    topSelectedClass: fieldIndex === 0 ? "Q1" : "none",
    hierarchyOpportunity: fieldIndex === 3 ? "indeterminate" : "no_cross_tier_choice",
    cmsHierarchyConditionalOutcome: fieldIndex === 0 ? "highest_eligible_arm_found_tier_selected" : "not_applicable",
    recencyOpportunity: fieldIndex === 3 ? "indeterminate" : "no_recency_choice",
    contractFidelity: fieldIndex === 0 ? "conforms" : "not_applicable",
    directoryComparison: "not_comparable", evidenceRefs: fieldIndex === 0 ? [{ kind: "claim", index: 0 }] : [],
    reason: fieldIndex === 0 ? "supported" : "missing" })),
  cmsRoleAssessment: { nppesIdentityTaxonomyUse: "appropriate", directoryAuthorityTreatment: "not_applicable",
    contactConflictTreatment: "no_conflict", ratingSourceNeutrality: "not_applicable", reasons: [], evidenceRefs: [] },
  casePolicyAssessment: { listedValueTreatment: "not_applicable", evidenceRefs: [], reason: "no gate" },
  criticalFindings: [], findings: []
};
assert.equal(synthesis.validateSynthesisOutput(output, packet, compact).claimAssessments.length, 1);
const websitePacket = { ...packet,
  claims: [{ ...packet.claims[0], fieldType: "website", value: "https://example.test/jane" }] };
const websiteUnreadableFixture = JSON.parse(fs.readFileSync(path.join(__dirname,
  "fixtures/synthesis_website_unreadable.json"), "utf8"));
assert.equal(websiteUnreadableFixture.fixtureKind, "synthetic_unreadable_website_assessment");
const partialUnreadableWebsite = { ...output,
  claimAssessments: [{ ...output.claimAssessments[0], citedSourceSupport: "unreadable",
    providerIdentitySpanFidelity: "unreadable", factSpanFidelity: "unreadable",
    exactSupport: "partial", fieldValidity: "partial" }],
  criticalFindings: websiteUnreadableFixture.observed.criticalFindings };
assert.deepEqual(synthesis.validateSynthesisOutput(partialUnreadableWebsite,
  websitePacket, compact).criticalFindings, websiteUnreadableFixture.expectedCriticalFindings,
"an unreadable own website citation with only partial value validity is not a website misrepresentation");
const invalidWebsite = { ...partialUnreadableWebsite,
  claimAssessments: [{ ...partialUnreadableWebsite.claimAssessments[0],
    exactSupport: "contradicted", fieldValidity: "invalid" }] };
assert.deepEqual(synthesis.validateSynthesisOutput(invalidWebsite,
  websitePacket, compact).criticalFindings, ["OFFICIAL_WEBSITE_MISREPRESENTATION"],
"affirmatively invalid website values retain the critical finding");
assert.throws(() => synthesis.validateSynthesisOutput({
  ...output,
  claimAssessments: [{ ...output.claimAssessments[0], exactSupport: "unreadable" }]
}, packet, compact), /own-citation-only/);
assert.throws(() => synthesis.validateSynthesisOutput({
  ...output,
  candidateDecisionAssessments: [{ ...output.candidateDecisionAssessments[0], exactSupport: "unreadable" }]
}, packet, compact), /own-citation-only/);
const mixedSupportFixture = JSON.parse(fs.readFileSync(path.join(__dirname,
  "fixtures/synthesis_whole_packet_axis.json"), "utf8"));
assert.equal(mixedSupportFixture.fixtureKind, "synthetic_mixed_atomic_support_groups");
const mixedSupportCompact = { ...compact, atomicClaimReadings: [{ claimIndex: 0,
  sourceReadings: [{ sourceIndex: 0, groups: mixedSupportFixture.atomicGroups }] }] };
assert.throws(() => synthesis.validateSynthesisOutput({
  ...output,
  claimAssessments: [{ ...output.claimAssessments[0], ...mixedSupportFixture.observedInvalidSynthesis }]
}, packet, mixedSupportCompact), /own-citation-only/);
const otherVerifiedSpan = { ...evidenceSpan, quote: "other exact verified evidence" };
const compactWithOtherVerified = { ...compact,
  verifiedEvidence: [...compact.verifiedEvidence, { evidenceIndex: 1, ...otherVerifiedSpan }] };
const outputWithSynthesizerAssignedSpan = { ...output,
  claimAssessments: [{ ...output.claimAssessments[0], evidenceSpans: [otherVerifiedSpan] }] };
assert.equal(synthesis.validateSynthesisOutput(outputWithSynthesizerAssignedSpan,
  packet, compactWithOtherVerified).claimAssessments.length, 1);
assert.equal(synthesis.synthesisEvidenceBindingAudit(outputWithSynthesizerAssignedSpan,
  compactWithOtherVerified).warningCount, 1);
assert.throws(() => synthesis.validateSynthesisOutput({
  ...output,
  identityAssessment: { ...output.identityAssessment,
    evidenceSpans: [{ ...evidenceSpan, quote: "invented" }] }
}, packet, compact), /outside verified atomic evidence/);

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synthesis-semantic-attempts-"));
  try {
    const item = { armId: "A", caseId: "P010", dir: directory, packet,
      plan: { request: { fixture: true }, input: compact } };
    const contentFilterFixture = JSON.parse(fs.readFileSync(path.join(__dirname,
      "fixtures/atomic_incomplete_content_filter.json"), "utf8"));
    const filteredClient = { responses: { create: async () => structuredClone(contentFilterFixture) } };
    const filtered = await synthesis.executeSynthesisSemanticAttempts({ client: filteredClient, item });
    assert.equal(filtered.status, "manual_review_required");
    assert.equal(filtered.attempts.length, 2);
    assert.equal(fs.existsSync(path.join(directory, "raw-response-semantic-01.json")), true);
    assert.equal(fs.existsSync(path.join(directory, "raw-response-semantic-02.json")), true);

    const maxOutput = await synthesis.executeSynthesisSemanticAttempts({
      client: { responses: { create: async () => ({ status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 2, output_tokens: 48_000 } }) } },
      item: { ...item, dir: path.join(directory, "max-output") }
    });
    assert.equal(maxOutput.status, "manual_review_required");
    assert.equal(maxOutput.attempts.length, 1);

    const firstFiltered = structuredClone(contentFilterFixture);
    firstFiltered.usage = { input_tokens: 2, output_tokens: 3 };
    const responses = [firstFiltered, { id: "resp_success", status: "completed", output_parsed: output,
      usage: { input_tokens: 1, output_tokens: 1 } }];
    const recovered = await synthesis.executeSynthesisSemanticAttempts({
      client: { responses: { create: async () => responses.shift() } },
      item: { ...item, dir: path.join(directory, "recovered") }
    });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.attempts.length, 2);
    const recoveredResult = JSON.parse(fs.readFileSync(path.join(directory, "recovered", "result.json"), "utf8"));
    const recoveredParsed = fs.readFileSync(path.join(directory, "recovered", "parsed-v14.json"));
    assert.equal(recoveredResult.parsedArtifact.file, "parsed-v14.json");
    assert.equal(recoveredResult.parsedArtifact.sha256,
      require("node:crypto").createHash("sha256").update(recoveredParsed).digest("hex"));
    assert.equal(recoveredResult.parsedArtifact.byteLength, recoveredParsed.length);
    assert.equal(recoveredResult.totalEstimatedUsd,
      synthesis.estimateCost({ input_tokens: 2, output_tokens: 3 }).estimatedUsd
      + synthesis.estimateCost({ input_tokens: 1, output_tokens: 1 }).estimatedUsd);

    const malformed = await synthesis.executeSynthesisSemanticAttempts({
      client: { responses: { create: async () => ({ status: "completed", output_text: "not-json" }) } },
      item: { ...item, dir: path.join(directory, "malformed") }
    });
    assert.equal(malformed.status, "manual_review_required");
    assert.equal(malformed.reason, "EVALUATOR_MALFORMED_OUTPUT");
    assert.equal(malformed.attempts.length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  process.stdout.write("bounded synthesis tests passed\n");
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const compiler = require("../core/compile_campaign.js");
const { authorityDigest, evaluatorRunnerAuthority } = require("../core/evaluator_runner_authority.js");
assert.equal(compiler.passesNoninferiority(-0.050000000000000044), true);
assert.equal(compiler.passesNoninferiority(-0.0500001), false);
assert.equal(compiler.passesNoninferiority(null), null);
assert.deepEqual(compiler.evaluatorCostBreakdown({ totalEstimatedUsd: 0.03, attempts: [
  { usage: null }, { usage: { input_tokens: 10, output_tokens: 5 } }
]}), { costUsd: null, knownCostUsd: 0.03, unknownCostAttempts: 1 });

const aggregateMetrics = compiler.productionMetrics({ durationMs: 1000, usage: {
  pricingVersion: "azure-public-list-2026-07-30", responseBearingAttemptCount: 1,
  usageMissingAttemptCount: 0, webSearchCalls: 1, totalUsd: 0.018,
  capturedKnownCostUsd: 0.018
}, sends: [{ status: 200, latencyMs: 900, rawResponse: { usage: {
  input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 100,
  output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 1100
}, output: [{ type: "web_search_call" }] } }] }, "fixture aggregate");
assert.equal(aggregateMetrics.costUsd, 0.018);
assert.equal(aggregateMetrics.webSearches, 1);
assert.equal(aggregateMetrics.attempts[0].reasoningOutputTokens, 10);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const transitionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "compiler-authority-transition-"));
try {
  const first = path.join(transitionRoot, "first.js"); const second = path.join(transitionRoot, "second.js");
  fs.writeFileSync(first, "source first\n"); fs.writeFileSync(second, "source second\n");
  const describe = (name, file) => { const body = fs.readFileSync(file); return {
    name, path: file, sha256: sha256(body), byteLength: body.length
  }; };
  const authority = (files) => { const digest = authorityDigest(files); return {
    ...digest.core, files, authoritySha256: digest.authoritySha256
  }; };
  const sourceAuthority = authority([describe("first.js", first), describe("second.js", second)]);
  fs.writeFileSync(second, "current second\n");
  const currentAuthority = authority([describe("first.js", first), describe("second.js", second)]);
  assert.throws(() => compiler.verifyCompilerAuthorityTransition({ sealedAuthority: sourceAuthority,
    currentAuthority, reader: compiler.createAuditedReader() }), /explicit source authority is required/);
  assert.throws(() => compiler.verifyCompilerAuthorityTransition({ sealedAuthority: sourceAuthority,
    currentAuthority, reader: compiler.createAuditedReader(), expectedSourceAuthoritySha256: "0".repeat(64) }),
  /differs from the sealed source/);
  const transition = compiler.verifyCompilerAuthorityTransition({ sealedAuthority: sourceAuthority,
    currentAuthority, reader: compiler.createAuditedReader(),
    expectedSourceAuthoritySha256: sourceAuthority.authoritySha256 });
  assert.equal(transition.mode, "explicit_compile_only_transition");
  assert.equal(transition.sourceEvaluatorAuthoritySha256, sourceAuthority.authoritySha256);
  assert.equal(transition.currentCompilerAuthoritySha256, currentAuthority.authoritySha256);
  assert.deepEqual(transition.transitionedFiles.map((item) => item.name), ["second.js"]);
  fs.writeFileSync(second, "unauthorized third state\n");
  assert.throws(() => compiler.verifyCompilerAuthorityTransition({ sealedAuthority: sourceAuthority,
    currentAuthority, reader: compiler.createAuditedReader(),
    expectedSourceAuthoritySha256: sourceAuthority.authoritySha256 }), /matches neither source nor current bytes/);
} finally {
  fs.rmSync(transitionRoot, { recursive: true, force: true });
}

const singleArmRoot = fs.mkdtempSync(path.join(os.tmpdir(), "corrected-single-arm-config-"));
const singleProtocol = path.join(singleArmRoot, "PROTOCOL.md");
const singleBattery = path.join(singleArmRoot, "battery.json");
fs.writeFileSync(singleProtocol, "sealed holdout protocol\n");
fs.writeFileSync(singleBattery, "{}\n");
const singleConfigFile = path.join(singleArmRoot, "manifest.json");
const singleConfigInput = { schemaVersion: 1,
  campaignId: "single-arm-fixture", datasetRole: "sealed_holdout",
  auditMode: "single_arm_holdout_reevaluation",
  caseBatteryFormat: "json_object_cases",
  planNetworkContextPolicy: "exclude_from_evaluator_context",
  protocolFile: singleProtocol, protocolSha256: sha256(fs.readFileSync(singleProtocol)),
  caseBatteryFile: singleBattery, caseBatterySha256: sha256(fs.readFileSync(singleBattery)),
  productionEndpoint: "https://fixture.openai.azure.com/openai/v1/responses",
  baselineArmId: "A", arms: [{ armId: "A", name: "frozen full prompt",
    productionRoot: path.join(singleArmRoot, "production"),
    expectedArmCommit: "a".repeat(40), promptStaticBytes: 1000 }],
  paths: { packetRoot: path.join(singleArmRoot, "packets"),
    atomicRoot: path.join(singleArmRoot, "atomic"), synthesisRoot: path.join(singleArmRoot, "synthesis") },
  outputRoot: path.join(singleArmRoot, "output")
};
assert.throws(() => compiler.normalizeConfig(singleConfigInput, singleConfigFile),
  /preregistered_multi_arm_holdout|at least two arms/);
const excludedPlanConfig = { planNetworkContextPolicy: "exclude_from_evaluator_context" };
assert.doesNotThrow(() => compiler.assertPlanNetworkIsolation(excludedPlanConfig,
  { identityContext: {} }, { planNetworkEvidence: { networkPlanIds: ["PLAN"] } }, "A/H001"));
assert.throws(() => compiler.assertPlanNetworkIsolation(excludedPlanConfig,
  { identityContext: { planNetworkEvidence: { networkPlanIds: ["PLAN"] } } },
  { planNetworkEvidence: { networkPlanIds: ["PLAN"] } }, "A/H001"),
/excluded from Provider AI evaluation context/);
fs.rmSync(singleArmRoot, { recursive: true, force: true });
const descriptor = (file) => ({ path: path.resolve(file), sha256: sha256(fs.readFileSync(file)),
  byteLength: fs.statSync(file).size });
const SCHEMA_FILE = path.join(__dirname, "../core/atomic_judge_schema.js");
const stableObject = (value) => Array.isArray(value) ? value.map(stableObject)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])])) : value;
const stable = (value) => JSON.stringify(stableObject(value));
const sealed = (kind, payload) => {
  const unsigned = { schemaVersion: 1, kind, ...payload };
  return { ...unsigned, sealSha256: sha256(JSON.stringify(unsigned)) };
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const subsetBatteryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "corrected-subset-battery-"));
try {
  const subsetBattery = path.join(subsetBatteryRoot, "cases.jsonl");
  fs.writeFileSync(subsetBattery, ["P001", "P016", "P031"].map((caseId) => JSON.stringify({
    caseId, request: { npi: caseId, name: `Provider ${caseId}` }
  })).join("\n") + "\n");
  const subsetConfig = { caseBatteryFile: subsetBattery, caseBatteryFormat: "jsonl_rows",
    expectedCasesPerArm: 2, packetVerification: { expectedCaseIds: ["P016", "P031"] } };
  assert.deepEqual([...compiler.loadCaseBattery(subsetConfig, compiler.createAuditedReader()).keys()],
    ["P016", "P031"]);
  assert.throws(() => compiler.loadCaseBattery({ ...subsetConfig,
    packetVerification: { expectedCaseIds: ["P016", "P999"] } }, compiler.createAuditedReader()),
  /missing expected case P999/);
} finally {
  fs.rmSync(subsetBatteryRoot, { recursive: true, force: true });
}
const judgment = ({ cited = "exact", lowerTier = false, critical = false } = {}) => ({
  sourceAssessments: [], identityAssessment: { npiEntity: "exact", nameMatch: "exact",
    requestedLocationMatch: "not_established", evidenceSpans: [], reason: "fixture" },
  claimAssessments: [{ claimIndex: 0, citedSourceSupport: cited,
    providerIdentitySpanFidelity: "exact", factSpanFidelity: "exact",
    explicitDateSpanFidelity: "no_date_claimed", exactSupport: "exact", identityLink: "exact_npi",
    locationLink: "requested_location", displaySafety: "professional", recency: "undated",
    fieldValidity: "valid", sourceEligibility: "eligible", crossNpiConflict: "none",
    requestedNpiResolution: "exact_requested_npi", evidenceSpans: [], reason: "fixture" }],
  candidateDecisionAssessments: [],
  fieldAssessments: ["phone", "address", "website", "rating", "specialty"].map((fieldType, fieldIndex) => ({
    fieldIndex, topFactDisposition: fieldType === "phone" ? "supported_but_undated"
      : fieldType === "rating" ? "indeterminate" : "missing_no_eligible_arm_found_fact",
    crossNpiConflict: "none", requestedNpiResolution: fieldType === "phone" ? "exact_requested_npi" : "none",
    armFoundBestEligibleClass: fieldType === "phone" ? "Q1" : fieldType === "rating" ? "indeterminate" : "none",
    topSelectedClass: fieldType === "phone" ? lowerTier ? "Q3" : "Q1" : "none",
    hierarchyOpportunity: fieldType === "phone" ? lowerTier ? "higher_tier_same_value_corroboration"
      : "no_cross_tier_choice" : fieldType === "rating" ? "indeterminate" : "no_cross_tier_choice",
    cmsHierarchyConditionalOutcome: fieldType === "phone" ? lowerTier ? "lower_tier_selected"
      : "highest_eligible_arm_found_tier_selected" : "not_applicable",
    recencyOpportunity: fieldType === "rating" ? "indeterminate" : "no_recency_choice",
    contractFidelity: fieldType === "phone" ? "conforms" : "not_applicable",
    directoryComparison: "not_comparable", evidenceRefs: [], reason: "fixture" })),
  cmsRoleAssessment: { nppesIdentityTaxonomyUse: "appropriate", directoryAuthorityTreatment: "not_applicable",
    contactConflictTreatment: "no_conflict", ratingSourceNeutrality: "not_applicable", reasons: [], evidenceRefs: [] },
  casePolicyAssessment: { listedValueTreatment: "not_applicable", evidenceRefs: [], reason: "fixture" },
  criticalFindings: critical ? ["WRONG_PROVIDER"] : [], findings: []
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "corrected-campaign-compiler-"));
try {
  const productionEndpoint = "https://fixture.openai.azure.com/openai/v1/responses";
  const arms = [{ armId: "A", name: "baseline", promptStaticBytes: 1000, expectedArmCommit: "a".repeat(40) },
    { armId: "B", name: "half", promptStaticBytes: 500, expectedArmCommit: "b".repeat(40) },
    { armId: "C", name: "quarter", promptStaticBytes: 250, expectedArmCommit: "c".repeat(40) }];
  const cases = ["P001", "P002", "P003", "P004"];
  const packetRoot = path.join(root, "packets"); const atomicRoot = path.join(root, "atomic");
  const synthesisRoot = path.join(root, "synthesis");
  const runnerAuthority = evaluatorRunnerAuthority(path.join(__dirname, "../core"));
  const identityContext = { request: { npi: "1234567890", name: "Jane Doe" },
    cmsBaseline: { npi: "1234567890" }, nppesIdentity: { npi: "1234567890" } };
  const frozenStrata = { entityType: "individual", region: "fixture" };
  for (const arm of arms) for (const caseId of cases) {
    const packetFile = path.join(packetRoot, arm.armId, caseId, "packet.json");
    write(packetFile, { caseId, identityContext,
      claims: [{ claimId: "claim:p0:phone:0", fieldType: "phone", value: "555-0100" }],
      preSanitizerCandidates: [], expectedFields: ["phone", "address", "website", "rating", "specialty"] });
    write(path.join(packetRoot, arm.armId, caseId, "binding-seal.json"), {
      producerAuthoritySha256: runnerAuthority.authoritySha256,
      materializerAuthoritySha256: runnerAuthority.authoritySha256,
      materializedPacketSha256: sha256(fs.readFileSync(packetFile))
    });
    const contentFilter = caseId === "P004" && arm.armId === "B";
    const profile = { phoneNumbers: [{ value: "555-0100" }], locations: [], websites: [], specialties: [] };
    const canonical = [{ providerId: "<providerId>", npi: "1234567890", name: "<name>",
      specialty: "<specialty>", city: "<city>", state: "NY", zip: "12345" }];
    const inputPrefix = "Providers: ";
    const canonicalInput = `${inputPrefix}${JSON.stringify(canonical)}`;
    const schema = { type: "object" };
    const instructionBytes = arm.promptStaticBytes - Buffer.byteLength(canonicalInput) - Buffer.byteLength(JSON.stringify(schema));
    assert(instructionBytes > 0);
    const runtimeRequest = { model: "gpt-5.6-terra", instructions: "x".repeat(instructionBytes),
      input: `${inputPrefix}${JSON.stringify([identityContext.request])}`, tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      tool_choice: "required", max_tool_calls: 8, parallel_tool_calls: true, store: false,
      reasoning: { effort: "low" }, text: { format: { type: "json_schema", strict: true, schema } } };
    const productionArtifact = {
      armId: arm.armId, armCommit: arm.expectedArmCommit, caseId,
      finalProfiles: contentFilter ? [] : [profile], parserProfiles: contentFilter ? [] : [profile],
      cmsBaseline: identityContext.cmsBaseline, strata: frozenStrata,
      input: { lineOfCoverage: "Medical", providers: [identityContext.request] }, expectedInitialRequest: runtimeRequest,
      error: contentFilter ? { code: "content_filter", innererror: { code: "ResponsibleAIPolicyViolation" } } : null,
      durationMs: 1000 + arms.indexOf(arm) * 100,
      sends: [{ request: runtimeRequest, url: productionEndpoint }],
      usage: [{ inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5,
        webSearchCalls: 2, latencyMs: 900, totalUsd: 0.1, pricingVersion: "fixture" }] };
    if (arm.armId === "C" && caseId === "P001") {
      productionArtifact.expectedRequests = { initial: productionArtifact.expectedInitialRequest };
      delete productionArtifact.expectedInitialRequest;
      const body = productionArtifact.sends[0].request;
      const serialized = JSON.stringify(body);
      productionArtifact.sends[0] = { request: { method: "POST", url: productionEndpoint,
        headers: { "content-type": "application/json" }, body,
        bodyBytes: Buffer.byteLength(serialized), bodySha256: sha256(serialized) } };
    }
    write(path.join(root, `production-${arm.armId}`, "cells", arm.armId, caseId, "artifact.json"),
      productionArtifact);
    if (caseId !== "P004") {
      const atomicCell = path.join(atomicRoot, "cells", arm.armId, caseId);
      write(path.join(atomicCell, "raw-0-semantic-01.json"), { id: `atomic-${arm.armId}-${caseId}` });
      write(path.join(atomicCell, "result-0.json"), { status: "completed", durationMs: 200,
        totalEstimatedUsd: 0.02, attempts: [{ rawFile: "raw-0-semantic-01.json", usage: { input_tokens: 1,
          output_tokens: 1 } }] });
    }
    if (caseId === "P001") {
      const parsedFile = path.join(synthesisRoot, "cells", arm.armId, caseId, "parsed-v14.json");
      write(parsedFile, judgment({ cited: arm.armId === "C" ? "not_found" : "exact" }));
      const parsedBody = fs.readFileSync(parsedFile);
      write(path.join(synthesisRoot, "cells", arm.armId, caseId, "raw-response-semantic-01.json"),
        { id: `synthesis-${arm.armId}-${caseId}` });
      write(path.join(synthesisRoot, "cells", arm.armId, caseId, "result.json"), {
        status: "completed", durationMs: 300, totalEstimatedUsd: 0.03,
        attempts: [{ rawFile: "raw-response-semantic-01.json", usage: { input_tokens: 1, output_tokens: 1 } }],
        parsedArtifact: { file: "parsed-v14.json", path: parsedFile, sha256: sha256(parsedBody),
          byteLength: parsedBody.length } });
    } else if (["P002", "P003"].includes(caseId)) {
      write(path.join(synthesisRoot, "cells", arm.armId, caseId, "raw-response-semantic-01.json"),
        { id: `synthesis-${arm.armId}-${caseId}` });
      write(path.join(synthesisRoot, "cells", arm.armId, caseId, "result.json"), {
        status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", reason: "EVALUATOR_MAX_OUTPUT_TOKENS",
        durationMs: 300, totalEstimatedUsd: 0.03,
        attempts: [{ rawFile: "raw-response-semantic-01.json", usage: { input_tokens: 1, output_tokens: 1 } }] });
    }
  }
  const triggerCells = ["P002", "P003"].flatMap((caseId) => arms.map((arm) => ({ armId: arm.armId, caseId,
    reasons: [{ reason: "EVALUATOR_MAX_OUTPUT_TOKENS" }] })));
  write(path.join(synthesisRoot, "manual-review-required.json"), {
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", caseIds: ["P002", "P003"], cells: triggerCells });
  const manualMappings = ["P002", "P003"].flatMap((caseId) => arms.map((arm) => ({ caseId,
    armId: arm.armId, blindCaseId: `blind-${caseId.toLowerCase()}`, blindArmId: `blind-${arm.armId}`,
    unitId: `${caseId}-${arm.armId}` })));
  const manualUnits = manualMappings.map((mapping) => {
    const inputFile = path.join(root, "review-units", mapping.blindCaseId, mapping.blindArmId, "review-input.json");
    write(inputFile, { schemaVersion: 1, unitId: mapping.unitId, fixedCase: { caseId: mapping.caseId } });
    mapping.inputSha256 = sha256(fs.readFileSync(inputFile));
    return { unitId: mapping.unitId, blindCaseId: mapping.blindCaseId, blindArmId: mapping.blindArmId,
      inputSha256: mapping.inputSha256 };
  });
  const manualAllCases = cases.map((caseId) => ({ caseId,
    requestSha256: sha256(JSON.stringify(identityContext.request)),
    fixedContextSha256: sha256(JSON.stringify(identityContext)) }));
  const manualMap = { expectedArms: arms.map((arm) => arm.armId), expectedCasesPerArm: cases.length,
    allCases: manualAllCases, allCasesSha256: sha256(JSON.stringify(manualAllCases)), mappings: manualMappings };
  const mapFile = path.join(root, "manual-map.json"); write(mapFile, manualMap);
  const mapHash = sha256(fs.readFileSync(mapFile));
  const manualManifest = { status: "MANUAL_REVIEW_READY", expectedArmCount: arms.length,
    manualCaseCount: 2, expectedCompletedUnitCount: manualMappings.length, schemaAudit: descriptor(SCHEMA_FILE),
    runnerAuthority, units: manualUnits, sealedMapSha256: sha256(JSON.stringify(manualMap)) };
  const manualManifestFile = path.join(root, "campaign-manifest.json"); write(manualManifestFile, manualManifest);
  const censoredCases = [{ blindCaseId: "blind-p003", reason: "one_or_more_arm_outputs_missing" }];
  const decisions = arms.map((arm) => {
    const mapping = manualMappings.find((row) => row.caseId === "P002" && row.armId === arm.armId);
    const categoricalOutput = judgment({ lowerTier: arm.armId === "B" });
    const unitRoot = path.join(root, "review-units", mapping.blindCaseId, mapping.blindArmId);
    const traceFile = path.join(unitRoot, "raw-review-trace.json"); write(traceFile, { fixture: true });
    const trace = descriptor(traceFile);
    write(path.join(unitRoot, "review-output.json"), { startedAt: "2000-01-01T00:00:00.000Z",
      completedAt: "2000-01-01T00:00:00.400Z", durationMs: 400,
      reviewer: { reviewMode: "codex_harness_manual", id: "fixture", sessionId: "fixture",
        protocolVersion: "fixture", runtimeIdentity: "fixture" },
      rawReviewTraceArtifact: { path: "raw-review-trace.json", sha256: trace.sha256,
        byteLength: trace.byteLength, complete: true }, categoricalOutput });
    return { caseId: "P002", armId: arm.armId, blindCaseId: mapping.blindCaseId,
      blindArmId: mapping.blindArmId, resultClass: "codex_harness_manual_separate_from_automatic_sol",
      durationMs: 400, rawReviewTraceSha256: trace.sha256,
      outputSha256: sha256(JSON.stringify(categoricalOutput)), categoricalOutput };
  });
  const manualSeal = { status: "MANUAL_REVIEW_SEALED", manifestSha256: sha256(fs.readFileSync(manualManifestFile)),
    mapSha256: mapHash,
    evaluatorAuthoritySha256: runnerAuthority.authoritySha256,
    expectedArmCount: arms.length, manualCaseCount: 2, completedUnits: decisions.length,
    censoredCases, decisions };
  manualSeal.unblindedCardinalitySealSha256 = sha256(JSON.stringify({ expectedArmCount: arms.length,
    manualCaseCount: 2, completed: decisions.map((row) => [row.caseId, row.armId]).sort(), censoredCases }));
  const sealFile = path.join(root, "manual-seal.json"); write(sealFile, manualSeal);
  const outputRoot = path.join(root, "compiled");
  const protocolFile = path.join(root, "PROTOCOL.md");
  fs.writeFileSync(protocolFile, "frozen fixture protocol\n");
  const protocolSha256 = sha256(fs.readFileSync(protocolFile));
  const caseBatteryFile = path.join(root, "cases.jsonl");
  fs.writeFileSync(caseBatteryFile, `${cases.map((caseId) => JSON.stringify({ caseId,
    request: identityContext.request, cmsBaseline: identityContext.cmsBaseline, strata: frozenStrata,
    gold: { identity: identityContext.nppesIdentity } })).join("\n")}\n`);
  const caseBatterySha256 = sha256(fs.readFileSync(caseBatteryFile));
  const atomicCells = [];
  for (const arm of arms) for (const caseId of cases) {
    const request = { model: "gpt-5.6-sol", input: `${arm.armId}:${caseId}` };
    write(path.join(atomicRoot, "cells", arm.armId, caseId, "request-0.json"), request);
    atomicCells.push({ armId: arm.armId, caseId,
      packetSha256: sha256(JSON.stringify(JSON.parse(fs.readFileSync(path.join(packetRoot, arm.armId,
        caseId, "packet.json"), "utf8")))), invalidNormalizations: [], manualReviewReasons: [],
      requests: [{ requestIndex: 0, requestSha256: sha256(JSON.stringify(request)), requestTokens: 10,
        assessmentRows: 1, maximumOutputTokens: 48000 }] });
  }
  assert(runnerAuthority.files.some((file) => file.name === "evaluator_runner_authority.js"),
    "Unified runner authority must seal its own implementation.");
  const atomicRuntime = { model: "gpt-5.6-sol", reasoning: "high", runnerAuthority };
  write(path.join(atomicRoot, "CAMPAIGN_PLAN_SEAL.json"), sealed("provider_atomic_evaluator", {
    model: "gpt-5.6-sol", reasoning: "high", runtimeManifest: atomicRuntime, packetRoot,
    cells: atomicCells, manualCaseIds: [], operationalCensorCaseIds: ["P004"] }));
  write(path.join(atomicRoot, "summary.json"), { dryRun: false, model: "gpt-5.6-sol", reasoning: "high",
    runtimeManifest: atomicRuntime, cells: atomicCells.length, totalRequests: atomicCells.length,
    rows: atomicCells.map((cell) => ({ armId: cell.armId, caseId: cell.caseId })) });
  const synthesisCells = [];
  for (const arm of arms) for (const caseId of cases.filter((value) => value !== "P004")) {
    const request = { model: "gpt-5.6-sol", input: `${arm.armId}:${caseId}:synthesis` };
    write(path.join(synthesisRoot, "cells", arm.armId, caseId, "request.json"), request);
    synthesisCells.push({ armId: arm.armId, caseId, status: "ready", reason: null, requestTokens: 10,
    inputSha256: sha256(`${arm.armId}:${caseId}`), requestSha256: sha256(JSON.stringify(request)) });
  }
  const synthesisRuntime = { model: "gpt-5.6-sol", reasoning: "high", runnerAuthority,
    schemaScript: descriptor(SCHEMA_FILE) };
  write(path.join(synthesisRoot, "CAMPAIGN_PLAN_SEAL.json"), sealed("provider_bounded_synthesis", {
    model: "gpt-5.6-sol", reasoning: "high", runtimeManifest: synthesisRuntime,
    packetRoot, atomicRoot, preSynthesisManualCaseIds: [],
    preSynthesisOperationalCensorCaseIds: ["P004"], cells: synthesisCells,
    manualCaseIds: [] }));
  write(path.join(synthesisRoot, "summary.json"), { dryRun: false, model: "gpt-5.6-sol", reasoning: "high",
    runtimeManifest: synthesisRuntime, packetCells: arms.length * cases.length, cells: synthesisCells.length,
    preSynthesisManualCaseIds: [], preSynthesisOperationalCensorCaseIds: ["P004"],
    manualCaseIds: [], runtimeManualCaseIds: ["P002", "P003"] });
  const manifestFile = path.join(root, "manifest.json");
  write(manifestFile, { schemaVersion: 1, campaignId: "fixture-nine-shape", datasetRole: "development",
    caseBatteryFormat: "jsonl_rows", planNetworkContextPolicy: "preserve_frozen_audit_context",
    protocolFile, protocolSha256, caseBatteryFile, caseBatterySha256, productionEndpoint,
    baselineArmId: "A", expectedCasesPerArm: 4, outputRoot,
    bootstrap: { iterations: 10_000, seed: "fixture-seed", confidence: 0.95 },
    paths: { packetRoot, atomicRoot, synthesisRoot, manualSealFile: sealFile, manualMapFile: mapFile },
    arms: arms.map((arm) => ({ ...arm, productionRoot: path.join(root, `production-${arm.armId}`) })) });
  childProcess.execFileSync(process.execPath, [path.join(__dirname, "../core/compile_campaign.js"), manifestFile],
    { stdio: "pipe", env: { ...process.env, ALLOW_HISTORICAL_REPRODUCTION: "YES",
      EXPECTED_RUNNER_AUTHORITY_SHA256: runnerAuthority.authoritySha256 } });
  const summary = JSON.parse(fs.readFileSync(path.join(outputRoot, "summary.json"), "utf8"));
  assert.deepEqual(summary.arms, ["A", "B", "C"]);
  assert.deepEqual(summary.strata, { automatic: 1, manual: 1, censored: 2 });
  assert.equal(summary.promptMetrics.find((row) => row.armId === "B").reductionVsBaselineFraction, 0.5);
  assert.equal(summary.promptSizeGate.byArm.B, true);
  assert.equal(summary.categoricalCounts.automatic.C.own_citation_support_defect.present, 1);
  assert.equal(summary.categoricalCounts.manual.B.lower_tier_source_selected.present, 1);
  assert.equal(summary.frozenProtocol.candidates.C.automatic.endpoints
    .find((row) => row.metric === "readable_own_citation_exact_support").passes, false);
  assert.equal(summary.frozenProtocol.candidates.B.manual.issueComparisons.lower_tier_selection.countDifference, 1);
  assert.equal(summary.noAggregateScore, true);
  assert.equal(summary.authorityProvenance.mode, "identical_sealed_and_current_authority");
  assert.equal(summary.authorityProvenance.currentCompilerAuthoritySha256, runnerAuthority.authoritySha256);
  assert.deepEqual(summary.authorityProvenance.transitionedFiles, []);
  const censored = fs.readFileSync(path.join(outputRoot, "raw-censored-providers.tsv"), "utf8");
  assert.match(censored, /P003\tone_or_more_arm_outputs_missing/);
  assert.match(censored, /P004\tpaired_production_operational_censor/);
  const caseRows = fs.readFileSync(path.join(outputRoot, "raw-case-results.tsv"), "utf8").trim().split("\n");
  assert.equal(caseRows.length, 1 + arms.length * cases.length);
  assert.match(caseRows[0], /npi\tprovider_name\tspecialty\tcity\tstate\tzip\trequest_json/);
  const claimRows = fs.readFileSync(path.join(outputRoot, "raw-claim-assessments.tsv"), "utf8");
  assert.match(claimRows.split("\n")[0], /value_json\tsource_id\tsource_url\tsource_title\tsubmitted_citation_json/);
  const evaluatorRows = fs.readFileSync(path.join(outputRoot, "raw-evaluator-operations.tsv"), "utf8");
  assert.match(evaluatorRows.split("\n")[0],
    /cost_usd\tknown_cost_usd\tunknown_cost_attempts\tsemantic_attempts/);
  assert.match(fs.readFileSync(path.join(outputRoot, "REPORT.md"), "utf8"),
    /Compiler authority provenance[\s\S]*identical_sealed_and_current_authority/);
  const completion = JSON.parse(fs.readFileSync(path.join(outputRoot, "COMPILATION_COMPLETE.json"), "utf8"));
  assert.equal(completion.authorityProvenance.currentCompilerAuthoritySha256, runnerAuthority.authoritySha256);
  for (const name of ["raw-paired-bootstrap.tsv", "raw-frozen-protocol-endpoints.tsv",
    "raw-frozen-protocol-gates.tsv", "raw-source-assessments.tsv",
    "raw-candidate-decision-assessments.tsv", "raw-case-policy-assessments.tsv",
    "REPORT.md", "COMPILATION_COMPLETE.json"]) {
    assert.equal(fs.existsSync(path.join(outputRoot, name)), true, `missing ${name}`);
  }
  assert.throws(() => compiler.normalizeConfig({ schemaVersion: 1, campaignId: "x", datasetRole: "development",
    caseBatteryFormat: "jsonl_rows", planNetworkContextPolicy: "preserve_frozen_audit_context",
    protocolFile, protocolSha256, caseBatteryFile, caseBatterySha256, productionEndpoint,
    baselineArmId: "A", outputRoot: "x", bootstrap: { iterations: 9999 }, paths: { packetRoot: "x",
      atomicRoot: "x", synthesisRoot: "x" }, arms: [{ armId: "A", name: "a", productionRoot: "x",
      promptStaticBytes: 1, expectedArmCommit: "a".repeat(40) },
      { armId: "B", name: "b", productionRoot: "x", promptStaticBytes: 1,
        expectedArmCommit: "b".repeat(40) }] },
  manifestFile), /exactly 10000/);
  assert.throws(() => compiler.normalizeConfig({ schemaVersion: 1, campaignId: "x", datasetRole: "development",
    caseBatteryFormat: "jsonl_rows", planNetworkContextPolicy: "preserve_frozen_audit_context",
    protocolFile, protocolSha256: "0".repeat(64), caseBatteryFile, caseBatterySha256, productionEndpoint,
    baselineArmId: "A", outputRoot: "x",
    paths: { packetRoot: "x", atomicRoot: "x", synthesisRoot: "x" },
    arms: [{ armId: "A", name: "a", productionRoot: "x", promptStaticBytes: 1,
      expectedArmCommit: "a".repeat(40) },
      { armId: "B", name: "b", productionRoot: "x", promptStaticBytes: 1,
        expectedArmCommit: "b".repeat(40) }] }, manifestFile),
  /Frozen protocol SHA-256 differs/);
  assert.throws(() => childProcess.execFileSync(process.execPath,
    [path.join(__dirname, "../core/compile_campaign.js"), manifestFile], {
      stdio: "pipe", env: { ...process.env, ALLOW_HISTORICAL_REPRODUCTION: "YES" }
    }));
  assert.equal(compiler.operationalCensor({ error: null,
    rawResponses: [{ status: "incomplete", incomplete_details: { reason: "content_filter" } }] }), null,
  "a recovered earlier filter must not become terminal censoring");
  assert.equal(compiler.operationalCensor({ error: { code: "terminal_error" }, sends: [{ raw: {
    status: "incomplete", incomplete_details: { reason: "content_filter" } } }] }),
  "terminal_production_content_filter", "the terminal raw response must drive paired content-filter censoring");
  const unsupportedSpan = judgment();
  unsupportedSpan.claimAssessments[0].exactSupport = "not_found";
  unsupportedSpan.claimAssessments[0].citedSourceSupport = "exact";
  unsupportedSpan.claimAssessments[0].factSpanFidelity = "nonverbatim";
  const spanRow = { production: { finalProfiles: [], parserProfiles: [] }, judgment: unsupportedSpan };
  assert.equal(compiler.criterionStates(spanRow).citation_span_or_contract_defect.state, "absent",
    "span-only criterion must not double-count an unsupported material claim");
  assert.equal(compiler.protocolIssueFlags(spanRow).span_defect, false,
    "frozen span gate must require otherwise exact material and own-citation support");
  const crossNpi = judgment();
  crossNpi.claimAssessments[0].crossNpiConflict = "exact_value_other_npi";
  crossNpi.claimAssessments[0].requestedNpiResolution = "none";
  const crossNpiRow = { production: { finalProfiles: [], parserProfiles: [] }, judgment: crossNpi };
  assert.equal(compiler.criterionStates(crossNpiRow).identity_attachment_defect.state, "present");
  assert.equal(compiler.protocolIssueFlags(crossNpiRow).cross_npi_misattribution, true);
  assert.equal(compiler.parserSucceeded({ production: { parserProfiles: [], error: null } }), true,
    "a valid structured empty profile is a parser success, not a parser failure");
  assert.equal(compiler.parserSucceeded({ production: { parserProfiles: [], error: { code: "parse" } } }), false);
  const incompleteCost = compiler.productionMetrics({ durationMs: 10,
    sends: [{ error: "fetch failed", raw: null }, { status: 200, raw: { status: "completed" } }],
    usage: [{ totalUsd: 0.25, webSearchCalls: 2, inputTokens: 10 }] });
  assert.equal(incompleteCost.costUsd, null, "unknown attempts must not be converted into a complete $0 total");
  assert.equal(incompleteCost.knownCostUsd, 0.25);
  assert.equal(incompleteCost.unknownCostAttempts, 1);
  assert.equal(incompleteCost.attempts[0].costKnown, false);
  assert.equal(incompleteCost.attempts[1].costUsd, 0.25,
    "response-only usage must retain the original HTTP-send index");
  assert.equal(compiler.assertAtomicToSynthesisManualTransition({ manualCaseIds: ["P001"] }, ["P002"],
    { preSynthesisManualCaseIds: ["P001", "P002"] }), true);
  assert.throws(() => compiler.assertAtomicToSynthesisManualTransition({ manualCaseIds: ["P001"] }, ["P002"],
    { preSynthesisManualCaseIds: ["P001"] }), /static\/runtime-manual/);
  const badDateSpan = judgment();
  badDateSpan.claimAssessments[0].explicitDateSpanFidelity = "date_not_verbatim";
  const badDateRow = { production: { finalProfiles: [], parserProfiles: [] }, judgment: badDateSpan };
  assert.equal(compiler.criterionStates(badDateRow).citation_span_or_contract_defect.state, "present");
  assert.equal(compiler.protocolIssueFlags(badDateRow).span_defect, true);

  const runOfflineCompile = () => {
    const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const config = compiler.normalizeConfig(raw, manifestFile);
    return compiler.compile(config, compiler.createAuditedReader());
  };
  const mutateAndReject = (file, mutate, pattern) => {
    const original = fs.readFileSync(file);
    const value = JSON.parse(original); mutate(value); write(file, value);
    try { assert.throws(runOfflineCompile, pattern); } finally { fs.writeFileSync(file, original); }
  };
  const mutateManyAndReject = (files, mutate, pattern) => {
    const originals = files.map((file) => fs.readFileSync(file));
    files.forEach((file) => { const value = JSON.parse(fs.readFileSync(file)); mutate(value); write(file, value); });
    try { assert.throws(runOfflineCompile, pattern); } finally {
      files.forEach((file, index) => fs.writeFileSync(file, originals[index]));
    }
  };
  mutateAndReject(path.join(packetRoot, "B", "P001", "packet.json"),
    (value) => { value.identityContext.request.name = "DRIFTED"; }, /request differs across arms|frozen battery/);
  mutateAndReject(path.join(packetRoot, "B", "P001", "packet.json"),
    (value) => { value.identityContext.cmsBaseline.npi = "0000000000"; }, /identity context differs|CMS baseline/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.input.providers[0].name = "DRIFTED"; }, /production provider payload differs/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.sends[0].request.reasoning.effort = "medium"; }, /reasoning differs/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.sends[0].request.instructions += " unmeasured"; }, /first send differs/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.sends[0].request.tools.push({ type: "other" }); }, /request surface differs|web_search configuration/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.armCommit = "0".repeat(40); }, /arm commit differs/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.strata.region = "drifted"; }, /Production strata differ/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.sends[0].url = "https://other.example/openai/v1/responses"; }, /endpoint differs/);
  mutateAndReject(path.join(root, "production-B", "cells", "B", "P001", "artifact.json"),
    (value) => { value.expectedInitialRequest.instructions += "drift"; },
    /first send differs|Static prompt contract differs/);
  mutateAndReject(path.join(atomicRoot, "CAMPAIGN_PLAN_SEAL.json"),
    (value) => { value.model = "wrong"; }, /internal seal is invalid/);
  mutateAndReject(path.join(atomicRoot, "CAMPAIGN_PLAN_SEAL.json"), (value) => {
    value.model = "wrong"; const unsigned = { ...value }; delete unsigned.sealSha256;
    value.sealSha256 = sha256(JSON.stringify(unsigned));
  }, /not the frozen Sol\/high evaluator/);
  mutateAndReject(path.join(synthesisRoot, "CAMPAIGN_PLAN_SEAL.json"), (value) => {
    value.atomicRoot = path.join(root, "wrong-atomic"); const unsigned = { ...value }; delete unsigned.sealSha256;
    value.sealSha256 = sha256(JSON.stringify(unsigned));
  }, /atomic root differs/);
  mutateAndReject(path.join(synthesisRoot, "manual-review-required.json"),
    (value) => { value.status = "wrong"; }, /invalid status/);
  mutateAndReject(path.join(synthesisRoot, "manual-review-required.json"),
    (value) => { value.cells = value.cells.filter((row) => !(row.caseId === "P002" && row.armId === "C")); },
    /does not contain the exact expected arm set/);
  mutateAndReject(path.join(synthesisRoot, "cells", "A", "P001", "parsed-v14.json"),
    (value) => { value.claimAssessments[0].reason = "tampered"; }, /parsed artifact binding differs/);
  {
    const parsedFile = path.join(synthesisRoot, "cells", "A", "P001", "parsed-v14.json");
    const resultFile = path.join(synthesisRoot, "cells", "A", "P001", "result.json");
    const parsedOriginal = fs.readFileSync(parsedFile); const resultOriginal = fs.readFileSync(resultFile);
    const parsed = JSON.parse(parsedOriginal); parsed.score = 100; write(parsedFile, parsed);
    const result = JSON.parse(resultOriginal); const body = fs.readFileSync(parsedFile);
    result.parsedArtifact.sha256 = sha256(body); result.parsedArtifact.byteLength = body.length; write(resultFile, result);
    try { assert.throws(runOfflineCompile, /unrecognized|score/i); } finally {
      fs.writeFileSync(parsedFile, parsedOriginal); fs.writeFileSync(resultFile, resultOriginal);
    }
  }
  mutateAndReject(path.join(atomicRoot, "cells", "A", "P001", "result-0.json"),
    (value) => { value.attempts[0].rawFile = "missing-raw.json"; }, /raw attempt.*missing/);
  mutateAndReject(sealFile, (value) => { value.unblindedCardinalitySealSha256 = "0".repeat(64); },
    /cardinality seal is invalid/);
  mutateAndReject(sealFile, (value) => { value.decisions.push({ ...value.decisions[0], caseId: "P999" }); },
    /unknown case P999/);
  mutateAndReject(sealFile, (value) => { value.expectedArmCount = 99; }, /expectedArmCount differs/);
  mutateAndReject(sealFile, (value) => { value.decisions[0].categoricalOutput.claimAssessments[0].reason = "tampered"; },
    /categorical output hash is invalid/);
  mutateAndReject(manualManifestFile, (value) => { value.manualCaseCount = 99; }, /manifest hash differs/);
  const commonPacketFiles = arms.map((arm) => path.join(packetRoot, arm.armId, "P001", "packet.json"));
  mutateManyAndReject(commonPacketFiles,
    (value) => { value.identityContext.nppesIdentity.npi = "0000000000"; }, /NPPES identity differs from the frozen battery/);
  mutateManyAndReject(commonPacketFiles,
    (value) => { value.identityContext.planNetworkEvidence = { invented: true }; }, /unfrozen plan\/network evidence/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("corrected campaign compiler tests passed\n");

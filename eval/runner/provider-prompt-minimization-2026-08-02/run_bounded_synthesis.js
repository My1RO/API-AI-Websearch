#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const WORKSPACE = process.env.EDE_SHARED_WORKSPACE || "/Users/kui/lucie/EDE";
const { CategoricalJudgeSchema, FIELD_TYPES } = require(
  "./categorical_judge_schema_v13_bounded_synthesis_axes.js");
const { FIXED_EVALUATION_POLICY } = require("./materialize_format_aware_packets_v4.js");
const planner = require("./evaluator_packet_planner.js");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");
const { serializeTransportError } = require("./transport_error_trace.js");
const { assertFreshOutputRoot, classifyEvaluatorInsufficiency, makeCampaignPlanSeal,
  validateCampaignPlanSeal, verifyExpectedPlanSeal } = require("./run_atomic_evaluator.js");

const MODEL = "gpt-5.6-sol";
const REASONING = "high";
const MAXIMUM_INPUT_TOKENS = 224_000;
const RATE_CARD = Object.freeze({ inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5,
  outputUsdPerMillion: 30, pricingVersion: "azure-public-global-standard-2026-07-30",
  contractRateKnown: false });
const estimateCost = (usage = {}) => {
  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return { estimatedUsd: ((Math.max(0, input - cached) * RATE_CARD.inputUsdPerMillion)
    + (cached * RATE_CARD.cachedInputUsdPerMillion) + (output * RATE_CARD.outputUsdPerMillion)) / 1_000_000,
  inputTokens: input, cachedInputTokens: cached, outputTokens: output, ...RATE_CARD };
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fileSha256 = (file) => sha256(fs.readFileSync(file));
const fileAudit = (file) => ({ path: file, sha256: sha256(fs.readFileSync(file)),
  byteLength: fs.statSync(file).size });

const assertSynthesisResumeOutputRoot = (root) => {
  const resolved = path.resolve(root);
  for (const name of ["summary.json", "CAMPAIGN_PLAN_SEAL.json"]) {
    if (!fs.existsSync(path.join(resolved, name))) {
      throw new Error(`Synthesis resume root is missing ${name}: ${resolved}`);
    }
  }
  return resolved;
};

const verifySynthesisResumePlanSeal = ({ expectedDryPlanSealFile, existingLivePlanSeal,
  recomputedPlanSeal, sourceEvaluatorAuthoritySha256 }) => {
  if (!expectedDryPlanSealFile || !fs.existsSync(expectedDryPlanSealFile)) {
    throw new Error("Synthesis resume requires the original EXPECTED_DRY_PLAN_SEAL.");
  }
  const dry = readJson(expectedDryPlanSealFile);
  validateCampaignPlanSeal(dry, "Expected dry synthesis campaign plan seal");
  validateCampaignPlanSeal(existingLivePlanSeal, "Existing live synthesis campaign plan seal");
  validateCampaignPlanSeal(recomputedPlanSeal, "Recomputed synthesis resume campaign plan seal");
  if (JSON.stringify(dry) !== JSON.stringify(existingLivePlanSeal)
    || JSON.stringify(existingLivePlanSeal) !== JSON.stringify(recomputedPlanSeal)) {
    throw new Error("Synthesis resume plan/request/schema/runtime policy differs from the original sealed plan.");
  }
  const sealedAuthority = existingLivePlanSeal.runtimeManifest?.runnerAuthority?.authoritySha256;
  if (!sourceEvaluatorAuthoritySha256 || sourceEvaluatorAuthoritySha256 !== sealedAuthority) {
    throw new Error("Synthesis resume source authority differs from the original sealed plan authority.");
  }
  return true;
};

const INSTRUCTIONS = [
  "You are the fixed whole-case categorical synthesizer for a public medical-provider evaluator.",
  "Use only the fixed case facts, compact atomic categorical readings, and verified verbatim evidence dictionary supplied. Do not browse.",
  "Return the existing V14 categorical output shape exactly. Assess every source, claim, candidate, and expected field by positional index.",
  "NPI and name are primary identity. Specialty and request location are stale cross-checks, never identity gates.",
  "A source tier applies only after readable evidence attaches the exact provider and fact. Official-looking domains alone prove nothing. For the same qualified fact, Q1 exact-provider first-party evidence precedes Q2 government registry evidence, then Q3 permitted professional directories. NPPES is eligible identity/taxonomy evidence but its contacts may be stale.",
  "Resolve conflicts by fact-specific evidence quality, not disagreement alone. For professional contacts, qualified exact-provider first-party evidence normally controls over NPPES-derived or other directory contacts. A lower-tier disagreement does not contradict a higher-tier fact unless readable evidence specifically establishes that the higher-tier fact is stale, wrong, or belongs to another provider.",
  "Undated evidence remains eligible. Prefer stronger fact-relevant recency when it exists; never reject a page merely because it lacks a date. Atomic source-level declared dates are context only. A page, profile, registry-record, dataset-refresh, crawl, copyright, publication, or generic update date does not date a displayed fact. Treat a claim or candidate as current, stale, or conflicting only when a verified quote ties a date or effective-status statement to that exact value and fact; otherwise its recency is undated.",
  "Specialty labels can differ in scope or coexist. A clinical specialty and an NPPES taxonomy do not contradict each other merely because their wording differs; require readable evidence that the labels are mutually exclusive for the relevant provider and time.",
  "Professional contacts exclude personal/mobile/home numbers, fax, residential addresses, prohibited sources, and uncertain-purpose contacts.",
  "Ratings, insurance, and plan/network are out of evaluation scope. A rating field row exists only for V14 schema compatibility: never penalize an omitted rating; use indeterminate top disposition and not-applicable contract/CMS semantics. Plan/network is never Provider AI authority.",
  "Reconcile chunk-local categories semantically. Chunk-local not_found is not whole-source absence unless the exhaustive atomic coverage supports that conclusion.",
  "For every claim and pre-sanitizer candidate, exactSupport assesses all eligible readable evidence returned by this arm, while citedSourceSupport assesses only the claim's exact cited source. An unreadable own citation cannot make exactSupport, identityLink, locationLink, displaySafety, recency, fieldValidity, sourceEligibility, crossNpiConflict, or requestedNpiResolution unreadable when other arm-owned readable evidence assesses that axis. Never credit citedSourceSupport or span fidelity from a different corroborating page.",
  "Critical findings are advisory and must agree with their item-level categories. OFFICIAL_WEBSITE_MISREPRESENTATION requires at least one emitted website whose fieldValidity is invalid. A partial or unreadable website or citation is not a misrepresentation without affirmative invalidity.",
  "Every evidence span quote must come verbatim from the supplied evidence dictionary for the same sourceIndex.",
  "Do not generate an aggregate score. Host code computes gates and validates all indices and evidence references."
].join("\n");

const discoverPackets = (root) => {
  const found = [];
  for (const armId of fs.readdirSync(root)) {
    const armRoot = path.join(root, armId);
    if (!fs.statSync(armRoot).isDirectory()) continue;
    for (const caseId of fs.readdirSync(armRoot)) {
      const caseRoot = path.join(armRoot, caseId);
      if (!fs.statSync(caseRoot).isDirectory()) continue;
      const file = path.join(caseRoot, "packet.json");
      if (fs.existsSync(file)) found.push({ armId, caseId, file });
    }
  }
  return found.sort((left, right) => left.caseId.localeCompare(right.caseId) || left.armId.localeCompare(right.armId));
};
const atomicManualCaseIds = (atomicRoot) => {
  const ids = new Set();
  for (const name of ["manual-review-required.json", "manual-review-required-runtime.json"]) {
    const file = path.join(atomicRoot, name);
    if (!fs.existsSync(file)) continue;
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    if (artifact.status !== "EVALUATOR_MANUAL_REVIEW_REQUIRED") {
      throw new Error(`Atomic manual trigger has unexpected status: ${file}`);
    }
    for (const caseId of artifact.caseIds || []) {
      if (!/^[PH]\d{3}$/.test(caseId)) throw new Error(`Atomic manual trigger has invalid case ID: ${caseId}`);
      ids.add(caseId);
    }
  }
  return ids;
};
const atomicOperationalCensorCaseIds = (atomicRoot) => {
  const file = path.join(atomicRoot, "operational-censor-cases.json");
  if (!fs.existsSync(file)) return new Set();
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  if (artifact.status !== "PAIRED_OPERATIONAL_CENSOR"
    || artifact.disposition !== "content_filter_exhaustion_not_arm_quality_failure") {
    throw new Error(`Atomic operational censor has unexpected status: ${file}`);
  }
  const ids = new Set();
  for (const caseId of artifact.caseIds || []) {
    if (!/^[PH]\d{3}$/.test(caseId)) throw new Error(`Atomic operational censor has invalid case ID: ${caseId}`);
    ids.add(caseId);
  }
  return ids;
};
const summarizeSynthesisPlans = (plans) => {
  const manualCaseIds = new Set(plans.filter((item) => item.plan.status !== "ready").map((item) => item.caseId));
  return {
    manualCaseIds,
    plannedReadyCells: plans.filter((item) => item.plan.status === "ready").length,
    executableReadyCells: plans.filter((item) => item.plan.status === "ready"
      && !manualCaseIds.has(item.caseId)).length
  };
};

const exactGroup = (rows, fields, { sourceIndex, evidenceLookup } = {}) => {
  const groups = new Map();
  for (const row of rows || []) {
    const values = Object.fromEntries(fields.map((field) => [field, row[field]]));
    const key = stableJson(values);
    const current = groups.get(key) || { values, chunkIndices: [], evidenceIndices: new Set(),
      reasons: new Set(), count: 0 };
    current.chunkIndices.push(row.chunkIndex);
    for (const quote of row.evidenceQuotes || []) {
      for (const evidenceIndex of evidenceLookup?.get(`${sourceIndex}\0${quote}`) || []) {
        current.evidenceIndices.add(evidenceIndex);
      }
    }
    const reason = row.reason || row.notes;
    if (reason) current.reasons.add(reason);
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({ ...group,
    chunkIndices: [...new Set(group.chunkIndices)].sort((a, b) => a - b),
    evidenceIndices: [...group.evidenceIndices].sort((a, b) => a - b),
    reasons: [...group.reasons].map((reason) => String(reason).slice(0, 320)).slice(0, 4)
  }));
};

const compactActionTrace = (packet, sourceIndex) => ({
  calls: (packet.actionTrace?.calls || []).map((call, callIndex) => ({
    callIndex,
    type: call.type || null,
    sourceIndices: (call.sourceIds || []).map((sourceId) => sourceIndex.get(sourceId))
      .filter(Number.isInteger)
  })),
  annotations: (packet.actionTrace?.annotations || []).map((annotation, annotationIndex) => ({
    annotationIndex,
    sourceIndex: sourceIndex.get(annotation.sourceId)
  })).filter((annotation) => Number.isInteger(annotation.sourceIndex))
});

const compactAtomicInput = (packet, merged) => {
  const sourceIndex = new Map(packet.sources.map((source, index) => [source.sourceId, index]));
  const rolesBySource = planner.sourceRoles(packet);
  const dedupedEvidence = [...new Map((merged.evidence || []).map((item) => [
    `${sourceIndex.get(item.sourceId)}\0${item.quote}`, item
  ])).values()];
  const evidence = dedupedEvidence.map((item, evidenceIndex) => ({
    evidenceIndex,
    sourceIndex: sourceIndex.get(item.sourceId),
    quote: item.quote
  })).filter((item) => Number.isInteger(item.sourceIndex));
  const evidenceLookup = new Map();
  for (const item of evidence) {
    const key = `${item.sourceIndex}\0${item.quote}`;
    if (!evidenceLookup.has(key)) evidenceLookup.set(key, []);
    evidenceLookup.get(key).push(item.evidenceIndex);
  }
  const sourceFields = ["sourceClass", "identityAttachment", "crossNpiConflict", "requestedNpiResolution",
    "professionalPurpose", "dateStatus", "providerIdentitySupported", "prohibitedForDisplay", "declaredDates"];
  const factFields = ["support", "identityLink", "locationLink", "displaySafety", "recency", "fieldValidity",
    "sourceEligibility", "crossNpiConflict", "requestedNpiResolution"];
  const compactFactReadings = (rows, indexField) => {
    const byFact = new Map();
    for (const item of rows || []) {
      const index = item[indexField];
      if (!byFact.has(index)) byFact.set(index, []);
      const itemSourceIndex = sourceIndex.get(item.sourceId);
      byFact.get(index).push({ sourceIndex: itemSourceIndex,
        groups: exactGroup(item.chunkAssessments, factFields, { sourceIndex: itemSourceIndex, evidenceLookup }) });
    }
    return [...byFact].sort(([left], [right]) => left - right).map(([index, sourceReadings]) => ({
      [indexField]: index,
      sourceReadings: sourceReadings.filter((reading) => Number.isInteger(reading.sourceIndex))
        .sort((left, right) => left.sourceIndex - right.sourceIndex)
    }));
  };
  return {
    schemaVersion: 1,
    fixedCase: {
      caseId: packet.caseId,
      identityContext: packet.identityContext,
      evaluationGate: packet.evaluationGate || null,
      evaluationGuidance: packet.evaluationGuidance || null,
      claims: packet.claims,
      preSanitizerCandidates: packet.preSanitizerCandidates || [],
      expectedFields: packet.expectedFields || FIELD_TYPES,
      evaluationPolicy: packet.evaluationPolicy || FIXED_EVALUATION_POLICY,
      actionTrace: compactActionTrace(packet, sourceIndex)
    },
    sources: packet.sources.map((source, index) => ({
      sourceIndex: index,
      canonicalUrl: planner.canonicalUrl(source.finalUrl || source.url),
      host: (() => { try { return new URL(source.finalUrl || source.url).hostname.toLowerCase(); } catch { return null; } })(),
      roles: rolesBySource.get(source.sourceId) || ["arm_returned_source"],
      discoveryRole: source.discoveryRole || null, discoveryChannels: source.discoveryChannels || [],
      hostReadStatus: source.hostReadStatus, snapshotCoverage: source.snapshotCoverage,
      normalizationFormat: source.normalizationFormat || source.normalization?.normalizationFormat || null,
      evaluationCoverage: (merged.sourceCoverage || []).find((item) => item.sourceId === source.sourceId) || null
    })),
    atomicSourceReadings: (merged.sourceAssessments || []).map((item) => ({
      sourceIndex: sourceIndex.get(item.sourceId), groups: exactGroup(item.chunkAssessments, sourceFields,
        { sourceIndex: sourceIndex.get(item.sourceId), evidenceLookup })
    })).filter((item) => Number.isInteger(item.sourceIndex)).sort((left, right) => left.sourceIndex - right.sourceIndex),
    atomicClaimReadings: compactFactReadings(merged.claimSourceAssessments, "claimIndex"),
    atomicCandidateReadings: compactFactReadings(merged.candidateSourceAssessments, "candidateIndex"),
    verifiedEvidence: evidence,
    completeness: {
      atomicStatus: merged.status,
      invalidNormalizations: merged.invalidNormalizations || [],
      everyDeliveredEvaluationChunkLosslesslyCovered: true,
      everyOriginalSourceFullyModelRead: (merged.sourceCoverage || []).length === packet.sources.length
        && merged.sourceCoverage.every((item) => item.fullOriginalSourceModelRead === true),
      indexedProjectionSources: (merged.sourceCoverage || []).filter((item) => !item.fullOriginalSourceModelRead)
        .map((item) => item.sourceIndex),
      evidenceQuotesHostVerifiedVerbatim: true,
      hostInventedSemanticCategories: false
    }
  };
};

const buildSynthesisPlan = (packet, merged, { countTokens, textFormat }) => {
  if (typeof countTokens !== "function" || typeof textFormat !== "function") {
    throw new Error("countTokens and textFormat are required.");
  }
  const input = compactAtomicInput(packet, merged);
  const request = {
    model: MODEL,
    reasoning: { effort: REASONING },
    store: false,
    truncation: "disabled",
    instructions: INSTRUCTIONS,
    input: JSON.stringify(input),
    text: { format: textFormat(CategoricalJudgeSchema, "provider_bounded_categorical_synthesis_v1") }
  };
  const requestTokens = countTokens(JSON.stringify(request));
  return {
    schemaVersion: 1,
    status: requestTokens <= MAXIMUM_INPUT_TOKENS ? "ready" : "EVALUATOR_MANUAL_REVIEW_REQUIRED",
    reason: requestTokens <= MAXIMUM_INPUT_TOKENS ? null : "BOUNDED_SYNTHESIS_CONTEXT_OVERFLOW",
    requestTokens,
    maximumInputTokens: MAXIMUM_INPUT_TOKENS,
    inputSha256: sha256(JSON.stringify(input)),
    requestSha256: sha256(JSON.stringify(request)),
    input,
    request
  };
};

const validateSynthesisOutput = (output, packet, compactInput) => {
  const parsed = CategoricalJudgeSchema.parse(output);
  const expectedIndices = (length) => Array.from({ length }, (_, index) => index);
  const exactIndices = (rows, field, length, label) => {
    const indices = rows.map((row) => row[field]);
    if (stableJson(indices) !== stableJson(expectedIndices(length))) throw new Error(`${label} positional cardinality mismatch.`);
  };
  exactIndices(parsed.sourceAssessments, "sourceIndex", packet.sources.length, "source assessments");
  exactIndices(parsed.claimAssessments, "claimIndex", packet.claims.length, "claim assessments");
  exactIndices(parsed.candidateDecisionAssessments, "candidateIndex",
    (packet.preSanitizerCandidates || []).length, "candidate assessments");
  exactIndices(parsed.fieldAssessments, "fieldIndex", (packet.expectedFields || FIELD_TYPES).length, "field assessments");
  const atomicGroups = (readings, indexField, index) => (readings || [])
    .find((row) => row[indexField] === index)?.sourceReadings
    .flatMap((source) => source.groups || []) || [];
  const assertWholePacketWasSynthesized = (rows, readings, indexField, label) => {
    for (const [index, row] of rows.entries()) {
      const groups = atomicGroups(readings, indexField, index);
      if (row.exactSupport === "unreadable"
        && groups.some((group) => group.values?.support !== "unreadable")) {
        throw new Error(`${label} ${index} exactSupport is own-citation-only; readable atomic arm evidence was not synthesized.`);
      }
    }
  };
  assertWholePacketWasSynthesized(parsed.claimAssessments, compactInput.atomicClaimReadings,
    "claimIndex", "claim assessment");
  assertWholePacketWasSynthesized(parsed.candidateDecisionAssessments, compactInput.atomicCandidateReadings,
    "candidateIndex", "candidate assessment");
  const expectedFields = packet.expectedFields || FIELD_TYPES;
  const ratingIndex = expectedFields.indexOf("rating");
  if (ratingIndex >= 0) {
    const row = parsed.fieldAssessments[ratingIndex];
    if (row.topFactDisposition !== "indeterminate" || row.armFoundBestEligibleClass !== "indeterminate"
      || row.topSelectedClass !== "none"
      || row.hierarchyOpportunity !== "indeterminate" || row.cmsHierarchyConditionalOutcome !== "not_applicable"
      || row.recencyOpportunity !== "indeterminate" || row.contractFidelity !== "not_applicable"
      || row.directoryComparison !== "not_comparable") {
      throw new Error("Out-of-scope rating compatibility row must remain non-penalizing and not applicable.");
    }
  }
  if (parsed.cmsRoleAssessment.ratingSourceNeutrality !== "not_applicable") {
    throw new Error("Out-of-scope ratingSourceNeutrality must be not_applicable.");
  }
  if (parsed.criticalFindings.includes("OFFICIAL_WEBSITE_MISREPRESENTATION")) {
    const supported = parsed.claimAssessments.some((claim, claimIndex) =>
      packet.claims[claimIndex]?.fieldType === "website" && claim.fieldValidity === "invalid");
    if (!supported) {
      parsed.criticalFindings = parsed.criticalFindings
        .filter((finding) => finding !== "OFFICIAL_WEBSITE_MISREPRESENTATION");
    }
  }
  const quotesBySource = new Map();
  for (const item of compactInput.verifiedEvidence || []) {
    if (!quotesBySource.has(item.sourceIndex)) quotesBySource.set(item.sourceIndex, new Set());
    quotesBySource.get(item.sourceIndex).add(item.quote);
  }
  const verifySpans = (spans, label) => {
    for (const span of spans || []) {
      if (span.sourceIndex >= packet.sources.length || !quotesBySource.get(span.sourceIndex)?.has(span.quote)) {
        throw new Error(`${label} cites evidence outside verified atomic evidence.`);
      }
    }
  };
  verifySpans(parsed.identityAssessment.evidenceSpans, "identity assessment");
  for (const row of parsed.claimAssessments) verifySpans(row.evidenceSpans, `claim ${row.claimIndex}`);
  for (const row of parsed.candidateDecisionAssessments) verifySpans(row.evidenceSpans,
    `candidate ${row.candidateIndex}`);
  const verifyRefs = (refs, label) => {
    const limits = { source: packet.sources.length, claim: packet.claims.length,
      candidate: (packet.preSanitizerCandidates || []).length };
    for (const ref of refs || []) if (ref.index >= limits[ref.kind]) throw new Error(`${label} evidence reference is out of range.`);
  };
  for (const row of parsed.fieldAssessments) verifyRefs(row.evidenceRefs, `field ${row.fieldIndex}`);
  verifyRefs(parsed.cmsRoleAssessment.evidenceRefs, "CMS role assessment");
  verifyRefs(parsed.casePolicyAssessment.evidenceRefs, "case policy assessment");
  if (Object.hasOwn(parsed, "score")) throw new Error("Model-generated aggregate score is forbidden.");
  return parsed;
};

const synthesisEvidenceBindingAudit = (parsed, compactInput) => {
  const evidenceKey = (item) => `${item.sourceIndex}\0${item.quote}`;
  const evidenceByIndex = new Map((compactInput.verifiedEvidence || [])
    .map((item) => [item.evidenceIndex, item]));
  const allowedFactEvidence = (readings, indexField, index) => new Set((readings || [])
    .find((row) => row[indexField] === index)?.sourceReadings.flatMap((source) =>
      source.groups.flatMap((group) => group.evidenceIndices || []).map((evidenceIndex) =>
        evidenceByIndex.get(evidenceIndex)).filter(Boolean).map(evidenceKey)) || []);
  const warnings = [];
  const auditRows = (rows, readings, indexField, kind) => {
    for (const row of rows || []) {
      const index = row[indexField];
      const allowed = allowedFactEvidence(readings, indexField, index);
      for (const span of row.evidenceSpans || []) if (!allowed.has(evidenceKey(span))) warnings.push({
        kind, index, sourceIndex: span.sourceIndex, quote: span.quote,
        disposition: "verified_exact_quote_semantic_assignment_owned_by_synthesizer"
      });
    }
  };
  auditRows(parsed.claimAssessments, compactInput.atomicClaimReadings, "claimIndex", "claim");
  auditRows(parsed.candidateDecisionAssessments, compactInput.atomicCandidateReadings,
    "candidateIndex", "candidate");
  return { schemaVersion: 1,
    policy: "exact_verified_quote_required_atomic_group_membership_diagnostic_only",
    warningCount: warnings.length, warnings };
};

const parseOutput = (raw) => {
  if (raw.output_parsed) return raw.output_parsed;
  if (raw.output_text) return JSON.parse(raw.output_text);
  const text = (raw.output || []).flatMap((item) => item.type === "message" ? item.content || [] : [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("Synthesis returned no output_text.");
  return JSON.parse(text);
};

const synthesisSemanticRawFiles = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir)
    .filter((name) => /^raw-response-semantic-\d+\.json$/.test(name))
    .sort()
    .map((name) => path.join(dir, name))
  : [];
const synthesisTransportFiles = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir)
    .filter((name) => /^transport-error(?:-[^.]+)?\.json$/.test(name))
    .sort()
    .map((name) => path.join(dir, name))
  : [];
const containsProviderResponseEvidence = (value, seen = new Set()) => {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if ((key === "responseId" || key === "response_id" || key === "providerResponse")
      && child !== null && child !== undefined && child !== "") return true;
    if (key === "usage" && child !== null && child !== undefined) return true;
    if (containsProviderResponseEvidence(child, seen)) return true;
  }
  return false;
};

const inspectSynthesisRawAttempt = (item, rawFile) => {
  const raw = readJson(rawFile);
  let insufficiency = classifyEvaluatorInsufficiency(raw);
  let parsed = null;
  if (!insufficiency) {
    try {
      parsed = validateSynthesisOutput(parseOutput(raw), item.packet, item.plan.input);
    } catch (error) {
      insufficiency = { reason: "EVALUATOR_MALFORMED_OUTPUT", responseStatus: raw.status || null,
        providerReason: String(error?.message || error).slice(0, 400) };
    }
  }
  const semanticAttempt = Number(path.basename(rawFile).match(/semantic-(\d+)/)?.[1]);
  if (!Number.isSafeInteger(semanticAttempt) || semanticAttempt < 1) {
    throw new Error("Synthesis semantic raw artifact has an invalid attempt index.");
  }
  return { semanticAttempt, rawFile: path.basename(rawFile), raw, parsed, insufficiency,
    responseId: raw.id || null, responseStatus: raw.status || null, usage: raw.usage || null,
    estimatedCost: estimateCost(raw.usage) };
};

const validateParsedArtifactDescriptor = (result, parsedFile) => {
  const descriptor = result.parsedArtifact;
  if (!descriptor || descriptor.file !== "parsed-v14.json" || descriptor.path !== parsedFile
    || descriptor.sha256 !== fileSha256(parsedFile)
    || descriptor.byteLength !== fs.statSync(parsedFile).size) {
    throw new Error("Completed synthesis result parsedArtifact descriptor does not match the persisted parsed bytes.");
  }
};

const completedSynthesisFromArtifacts = ({ item, result = null, allowRecovery = false,
  readOnly = false }) => {
  const recoveringOrphan = !result;
  const parsedFile = path.join(item.dir, "parsed-v14.json");
  const rawFiles = synthesisSemanticRawFiles(item.dir);
  const rawAttempts = rawFiles.map((rawFile) => inspectSynthesisRawAttempt(item, rawFile));
  const successfulAttempts = rawAttempts.filter((attempt) => !attempt.insufficiency && attempt.parsed);
  const supportingAttempt = successfulAttempts.length === 1
    && successfulAttempts[0] === rawAttempts.at(-1) ? successfulAttempts[0] : null;
  let parsed = fs.existsSync(parsedFile) ? readJson(parsedFile) : null;
  if (parsed && supportingAttempt
    && JSON.stringify(parsed) !== JSON.stringify(supportingAttempt.parsed)) {
    throw new Error("Persisted parsed synthesis output differs from its raw provider response.");
  }
  parsed ||= supportingAttempt?.parsed || null;
  if (!parsed || !supportingAttempt) return null;
  parsed = validateSynthesisOutput(parsed, item.packet, item.plan.input);
  if (!fs.existsSync(parsedFile)) {
    if (!allowRecovery) throw new Error("Completed synthesis result is missing its parsed artifact.");
    if (!readOnly) writeJsonExclusive(parsedFile, parsed);
  }
  const evidenceBindingAudit = synthesisEvidenceBindingAudit(parsed, item.plan.input);
  if (!result) {
    if (!allowRecovery) return null;
    const stats = fs.statSync(path.join(item.dir, supportingAttempt.rawFile));
    const usage = supportingAttempt.usage;
    const recoveredAttempts = rawAttempts.map(({ semanticAttempt, rawFile, responseId,
      responseStatus, insufficiency, usage: attemptUsage, estimatedCost }) => ({
      semanticAttempt, rawFile, responseId, responseStatus, insufficiency,
      usage: attemptUsage, estimatedCost
    }));
    result = {
      schemaVersion: 1, status: "completed",
      startedAt: stats.birthtime.toISOString(), completedAt: stats.mtime.toISOString(),
      durationMs: Math.max(0, stats.mtimeMs - stats.birthtimeMs),
      responseId: supportingAttempt.responseId, usage,
      parsedArtifact: { file: "parsed-v14.json", path: parsedFile,
        sha256: sha256(`${JSON.stringify(parsed, null, 2)}\n`),
        byteLength: Buffer.byteLength(`${JSON.stringify(parsed, null, 2)}\n`) },
      evidenceBindingAudit,
      totalEstimatedUsd: recoveredAttempts.reduce((sum, attempt) =>
        sum + attempt.estimatedCost.estimatedUsd, 0),
      retryPolicy: { semanticMaxAttempts: 2, semanticAttemptsUsed: recoveredAttempts.length,
        transportOwner: "openai_sdk_native", configuredTransportMaxRetriesPerSemanticAttempt: 2 },
      recoveredFromOrphanedSuccessfulArtifacts: true,
      attempts: recoveredAttempts
    };
    if (!readOnly) writeJsonExclusive(path.join(item.dir, "result.json"), result);
  }
  if (result.status !== "completed") throw new Error("Completed synthesis result has an invalid status.");
  if (fs.existsSync(parsedFile)) validateParsedArtifactDescriptor(result, parsedFile);
  else if (!(recoveringOrphan && allowRecovery && readOnly)) {
    throw new Error("Completed synthesis result is missing its parsed artifact.");
  }
  if (result.responseId !== supportingAttempt.responseId
    || JSON.stringify(result.usage || null) !== JSON.stringify(supportingAttempt.usage)) {
    throw new Error("Completed synthesis result response metadata differs from its successful raw provider response.");
  }
  const persistedAttempts = result.attempts || [];
  if (persistedAttempts.length !== rawAttempts.length
    || result.retryPolicy?.semanticAttemptsUsed !== rawAttempts.length) {
    throw new Error("Completed synthesis result attempt cardinality differs from its raw response artifacts.");
  }
  for (let index = 0; index < rawAttempts.length; index += 1) {
    const persisted = persistedAttempts[index];
    const actual = rawAttempts[index];
    if (persisted.semanticAttempt !== actual.semanticAttempt || persisted.rawFile !== actual.rawFile
      || persisted.responseId !== actual.responseId || persisted.responseStatus !== actual.responseStatus
      || JSON.stringify(persisted.usage || null) !== JSON.stringify(actual.usage)) {
      throw new Error("Completed synthesis attempt metadata differs from its raw provider response.");
    }
  }
  const expectedTotalCost = rawAttempts.reduce((sum, attempt) => sum + attempt.estimatedCost.estimatedUsd, 0);
  if (result.totalEstimatedUsd !== expectedTotalCost) {
    throw new Error("Completed synthesis result cost differs from its raw provider responses.");
  }
  return { status: "completed", item, parsed, evidenceBindingAudit,
    attempts: result.attempts || [], result };
};

const inspectSynthesisResumeItem = (item, { readOnly = false } = {}) => {
  const resultFile = path.join(item.dir, "result.json");
  const rawFiles = synthesisSemanticRawFiles(item.dir);
  const transportFiles = synthesisTransportFiles(item.dir);
  const parsedFile = path.join(item.dir, "parsed-v14.json");
  if (!fs.existsSync(resultFile)) {
    const recovered = completedSynthesisFromArtifacts({ item, allowRecovery: true, readOnly });
    if (recovered) return { disposition: "completed", output: recovered, resultFile,
      recoveredWithoutPaidCall: true, requiresMaterialization: true };
    if (rawFiles.length) return { disposition: "manual", resultFile,
      reason: "ORPHANED_NONCOMPLETED_PROVIDER_RESPONSE_NOT_RETRIED", orphanedRawFiles: rawFiles };
    if (fs.existsSync(parsedFile)) return { disposition: "manual", resultFile,
      reason: "ORPHANED_PARSED_OUTPUT_WITHOUT_PROVIDER_RESPONSE_NOT_RETRIED" };
    if (transportFiles.length) return { disposition: "retry", resultFile,
      reason: "EVALUATOR_TRANSPORT_FAILURE", orphanedTransportFiles: transportFiles };
    return { disposition: "retry", resultFile, reason: "MISSING_PLANNED_RESULT" };
  }
  const result = readJson(resultFile);
  if (result.status === "completed") {
    const output = completedSynthesisFromArtifacts({ item, result });
    if (!output) throw new Error("Completed synthesis result lacks a valid raw/parsed output pair.");
    return { disposition: "completed", output, resultFile, result,
      recoveredWithoutPaidCall: result.recoveredFromOrphanedSuccessfulArtifacts === true,
      requiresMaterialization: false };
  }
  if (result.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED"
    && result.reason === "EVALUATOR_TRANSPORT_FAILURE") {
    if (rawFiles.length || containsProviderResponseEvidence(result)) {
      return { disposition: "manual", resultFile,
        reason: "RESPONSE_BEARING_TRANSPORT_RESULT_NOT_RETRIED", result, orphanedRawFiles: rawFiles };
    }
    for (const attempt of result.attempts || []) {
      const attemptFile = path.join(item.dir, attempt.rawFile || "");
      if (!attempt.rawFile || !fs.existsSync(attemptFile)) {
        throw new Error("Transport-failure synthesis result references a missing attempt artifact.");
      }
    }
    return { disposition: "retry", resultFile, result,
      reason: "EVALUATOR_TRANSPORT_FAILURE", orphanedTransportFiles: transportFiles };
  }
  return { disposition: "manual", resultFile, result,
    reason: result.reason || result.status || "UNKNOWN_RESULT" };
};

const archivePreResumeFile = (file) => {
  if (!fs.existsSync(file)) return null;
  const digest = fileSha256(file);
  const parsed = path.parse(file);
  const backup = path.join(parsed.dir, `${parsed.name}.pre-resume-${digest.slice(0, 12)}${parsed.ext}`);
  if (fs.existsSync(backup)) {
    if (fileSha256(backup) !== digest) throw new Error("Pre-resume synthesis archive hash mismatch.");
    fs.unlinkSync(file);
  } else fs.renameSync(file, backup);
  return { path: backup, sha256: digest, byteLength: fs.statSync(backup).size };
};
const preservePreResumeSynthesisFailure = (inspection) => {
  const attemptFiles = new Set(inspection.orphanedTransportFiles || []);
  for (const attempt of inspection.result?.attempts || []) {
    if (attempt.rawFile) attemptFiles.add(path.join(path.dirname(inspection.resultFile), attempt.rawFile));
  }
  const priorAttempts = [...attemptFiles].filter((file) => fs.existsSync(file)).map((file) => {
    const digest = fileSha256(file);
    const parsed = path.parse(file);
    const backup = path.join(parsed.dir, `${parsed.name}.pre-resume-${digest.slice(0, 12)}${parsed.ext}`);
    if (fs.existsSync(backup)) {
      if (fileSha256(backup) !== digest) throw new Error("Pre-resume synthesis attempt backup hash mismatch.");
    } else fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    return { path: backup, sha256: digest, byteLength: fs.statSync(backup).size };
  });
  return { priorResult: archivePreResumeFile(inspection.resultFile), priorAttempts };
};

const optionalFileLedger = (file) => fs.existsSync(file)
  ? { file: path.basename(file), sha256: fileSha256(file), byteLength: fs.statSync(file).size }
  : null;
const synthesisResumeCellArtifactLedger = (rows) => rows.map(({ task, inspection }) => ({
  armId: task.armId, caseId: task.caseId,
  disposition: inspection.disposition,
  reason: inspection.reason || null,
  result: optionalFileLedger(path.join(task.dir, "result.json")),
  parsed: optionalFileLedger(path.join(task.dir, "parsed-v14.json")),
  semanticRawResponses: synthesisSemanticRawFiles(task.dir).map(optionalFileLedger),
  transportErrors: synthesisTransportFiles(task.dir).map(optionalFileLedger)
}));
const synthesisRuntimeManualArtifact = (allPacketCells, rows) => {
  const caseIds = new Set(rows.map((row) => row.task.caseId));
  return {
    schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
    disposition: "evaluator_sufficiency_exception_not_arm_failure_paired_all_arms",
    caseIds: [...caseIds].sort(),
    cells: allPacketCells.filter((cell) => caseIds.has(cell.caseId)).map((cell) => ({
      armId: cell.armId, caseId: cell.caseId,
      reasons: rows.filter((row) => row.task.caseId === cell.caseId).map((row) => ({
        reason: row.inspection.reason, triggeringArmId: row.task.armId
      }))
    }))
  };
};

const executeSynthesisSemanticAttempts = async ({ client, item, semanticMaxAttempts = 2 }) => {
  if (!Number.isSafeInteger(semanticMaxAttempts) || semanticMaxAttempts < 1 || semanticMaxAttempts > 2) {
    throw new Error("semanticMaxAttempts must be 1 or 2.");
  }
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const attempts = [];
  const finishManual = (insufficiency) => {
    const result = { schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
      disposition: "evaluator_sufficiency_exception_not_arm_failure", reason: insufficiency.reason,
      providerReason: insufficiency.providerReason, startedAt, completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      totalEstimatedUsd: attempts.reduce((sum, attempt) => sum + attempt.estimatedCost.estimatedUsd, 0),
      retryPolicy: { semanticMaxAttempts, semanticAttemptsUsed: attempts.length,
        semanticRetryReasons: ["EVALUATOR_CONTENT_FILTER", "EVALUATOR_INCOMPLETE_RESPONSE",
          "EVALUATOR_REFUSAL", "EVALUATOR_MALFORMED_OUTPUT"],
        nonRetryableReasons: ["EVALUATOR_MAX_OUTPUT_TOKENS"],
        transportOwner: "openai_sdk_native", configuredTransportMaxRetriesPerSemanticAttempt: 2 }, attempts };
    writeJson(path.join(item.dir, "result.json"), result);
    return { status: "manual_review_required", item, reason: insufficiency.reason, attempts };
  };
  for (let semanticAttempt = 1; semanticAttempt <= semanticMaxAttempts; semanticAttempt += 1) {
    const raw = await client.responses.create(item.plan.request);
    const rawFile = `raw-response-semantic-${String(semanticAttempt).padStart(2, "0")}.json`;
    writeJson(path.join(item.dir, rawFile), raw);
    let insufficiency = classifyEvaluatorInsufficiency(raw);
    attempts.push({ semanticAttempt, rawFile, responseId: raw.id || null, responseStatus: raw.status || null,
      insufficiency, usage: raw.usage || null, estimatedCost: estimateCost(raw.usage) });
    let parsed = null;
    if (!insufficiency) {
      try {
        parsed = validateSynthesisOutput(parseOutput(raw), item.packet, item.plan.input);
      } catch (error) {
        insufficiency = { reason: "EVALUATOR_MALFORMED_OUTPUT", responseStatus: raw.status || null,
          providerReason: String(error?.message || error).slice(0, 400) };
        attempts.at(-1).insufficiency = insufficiency;
      }
    }
    if (insufficiency) {
      const retryable = insufficiency.reason !== "EVALUATOR_MAX_OUTPUT_TOKENS";
      if (retryable && semanticAttempt < semanticMaxAttempts) continue;
      return finishManual(insufficiency);
    }
    const evidenceBindingAudit = synthesisEvidenceBindingAudit(parsed, item.plan.input);
    const parsedFile = path.join(item.dir, "parsed-v14.json");
    writeJson(parsedFile, parsed);
    const parsedArtifact = { file: "parsed-v14.json", ...fileAudit(parsedFile) };
    writeJson(path.join(item.dir, "result.json"), { schemaVersion: 1, status: "completed", startedAt,
      completedAt: new Date().toISOString(), durationMs: Date.now() - start, responseId: raw.id || null,
      usage: raw.usage || null, parsedArtifact,
      evidenceBindingAudit,
      totalEstimatedUsd: attempts.reduce((sum, attempt) => sum + attempt.estimatedCost.estimatedUsd, 0),
      retryPolicy: { semanticMaxAttempts, semanticAttemptsUsed: attempts.length,
        transportOwner: "openai_sdk_native", configuredTransportMaxRetriesPerSemanticAttempt: 2 }, attempts });
    return { status: "completed", item, parsed, attempts };
  }
  throw new Error("Synthesis semantic-attempt loop ended without a disposition.");
};

const runPool = async (items, concurrency, operation) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await operation(items[index], index); }
  }));
  return results;
};

const main = async () => {
  const packetRoot = process.env.PACKET_ROOT;
  const atomicRoot = process.env.ATOMIC_ROOT;
  const outputRoot = process.env.OUTPUT_ROOT;
  const tokenizerModules = process.env.TOKENIZER_MODULES;
  const nodeModules = process.env.PROVIDER_EVAL_NODE_MODULES;
  const dryRun = process.env.DRY_RUN !== "0";
  const resume = process.env.RESUME === "1";
  const resumeInspectOnly = process.env.RESUME_INSPECT_ONLY === "1";
  if (!packetRoot || !atomicRoot || !outputRoot || !tokenizerModules || !nodeModules) {
    throw new Error("PACKET_ROOT, ATOMIC_ROOT, OUTPUT_ROOT, TOKENIZER_MODULES, and PROVIDER_EVAL_NODE_MODULES are required.");
  }
  if (resume && dryRun) throw new Error("Synthesis resume is a live-only stage.");
  if (resumeInspectOnly && !resume) throw new Error("RESUME_INSPECT_ONLY requires RESUME=1.");
  if (resume) assertSynthesisResumeOutputRoot(outputRoot); else assertFreshOutputRoot(outputRoot);
  const existingLivePlanSeal = resume ? readJson(path.join(outputRoot, "CAMPAIGN_PLAN_SEAL.json")) : null;
  const { getEncoding } = require(tokenizerModules);
  const encoding = getEncoding("o200k_base");
  const { zodTextFormat } = require(path.join(nodeModules, "openai/helpers/zod"));
  const preSynthesisManualCaseIds = atomicManualCaseIds(atomicRoot);
  const preSynthesisOperationalCensorCaseIds = atomicOperationalCensorCaseIds(atomicRoot);
  const allPacketCells = discoverPackets(packetRoot);
  const plans = allPacketCells.filter((cell) => !preSynthesisManualCaseIds.has(cell.caseId)
    && !preSynthesisOperationalCensorCaseIds.has(cell.caseId)).map((cell) => {
    const packet = JSON.parse(fs.readFileSync(cell.file, "utf8"));
    const mergedFile = path.join(atomicRoot, "cells", cell.armId, cell.caseId, "atomic-merged.json");
    if (!fs.existsSync(mergedFile)) throw new Error(`Missing atomic merge: ${cell.armId}/${cell.caseId}`);
    const merged = JSON.parse(fs.readFileSync(mergedFile, "utf8"));
    const plan = buildSynthesisPlan(packet, merged, { countTokens: (value) => encoding.encode(value).length,
      textFormat: zodTextFormat });
    const dir = path.join(outputRoot, "cells", cell.armId, cell.caseId);
    const persistedPlan = { ...plan, request: undefined, input: undefined };
    if (resume) {
      const planFile = path.join(dir, "synthesis-plan.json");
      const requestFile = path.join(dir, "request.json");
      if (!fs.existsSync(planFile)
        || fs.readFileSync(planFile, "utf8") !== `${JSON.stringify(persistedPlan, null, 2)}\n`) {
        throw new Error(`Synthesis resume cell plan differs from the persisted plan: ${cell.armId}/${cell.caseId}`);
      }
      if (!fs.existsSync(requestFile)
        || fs.readFileSync(requestFile, "utf8") !== `${JSON.stringify(plan.request, null, 2)}\n`) {
        throw new Error(`Synthesis resume request artifact differs from the sealed request: ${cell.armId}/${cell.caseId}`);
      }
    } else {
      writeJson(path.join(dir, "synthesis-plan.json"), persistedPlan);
      writeJson(path.join(dir, "request.json"), plan.request);
    }
    return { ...cell, packet, merged, plan, dir };
  });
  const schemaFile = path.join(__dirname,
    "categorical_judge_schema_v13_bounded_synthesis_axes.js");
  const computedRuntimeManifest = {
    schemaVersion: 1, model: MODEL, reasoning: REASONING,
    nodeExecutable: process.execPath, nodeVersion: process.version,
    tokenizerModules: path.resolve(tokenizerModules), sdkModules: path.resolve(nodeModules),
    evaluatorScript: fileAudit(__filename), schemaScript: fileAudit(schemaFile),
    runnerAuthority: evaluatorRunnerAuthority(__dirname),
    instructionsSha256: sha256(INSTRUCTIONS),
    schemaPolicyVersion: require(schemaFile).SCHEMA_POLICY_VERSION
  };
  const runtimeManifest = resume ? existingLivePlanSeal.runtimeManifest : computedRuntimeManifest;
  const synthesisDisposition = summarizeSynthesisPlans(plans);
  const { manualCaseIds } = synthesisDisposition;
  const planSeal = makeCampaignPlanSeal("provider_bounded_synthesis", {
    model: MODEL, reasoning: REASONING, runtimeManifest,
    packetRoot: path.resolve(packetRoot), atomicRoot: path.resolve(atomicRoot),
    preSynthesisManualCaseIds: [...preSynthesisManualCaseIds].sort(),
    preSynthesisOperationalCensorCaseIds: [...preSynthesisOperationalCensorCaseIds].sort(),
    cells: plans.map((item) => ({ armId: item.armId, caseId: item.caseId,
      status: item.plan.status, reason: item.plan.reason, requestTokens: item.plan.requestTokens,
      inputSha256: item.plan.inputSha256, requestSha256: item.plan.requestSha256 })),
    manualCaseIds: [...manualCaseIds].sort()
  });
  if (resume) verifySynthesisResumePlanSeal({
    expectedDryPlanSealFile: process.env.EXPECTED_DRY_PLAN_SEAL,
    existingLivePlanSeal,
    recomputedPlanSeal: planSeal,
    sourceEvaluatorAuthoritySha256: process.env.SOURCE_EVALUATOR_AUTHORITY_SHA256
  });
  else writeJson(path.join(outputRoot, "CAMPAIGN_PLAN_SEAL.json"), planSeal);
  const staticManualArtifact = {
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", disposition: "evaluator_exception_not_arm_failure",
    caseIds: [...manualCaseIds].sort(), protocol: "same_provider_all_arms_blinded_randomized_identical_rubric",
    cells: plans.filter((item) => manualCaseIds.has(item.caseId)).map((item) => ({
      armId: item.armId, caseId: item.caseId, reason: item.plan.reason, requestTokens: item.plan.requestTokens
    }))
  };
  const staticManualFile = path.join(outputRoot, "manual-review-required.json");
  if (resume) {
    if (manualCaseIds.size) {
      if (!fs.existsSync(staticManualFile)
        || JSON.stringify(readJson(staticManualFile)) !== JSON.stringify(staticManualArtifact)) {
        throw new Error("Synthesis resume static manual-review plan drifted.");
      }
    } else if (fs.existsSync(staticManualFile)) {
      throw new Error("Synthesis resume found an unexpected static manual-review artifact.");
    }
  } else if (manualCaseIds.size) writeJson(staticManualFile, staticManualArtifact);

  const summaryBase = {
    dryRun, model: MODEL, reasoning: REASONING, runtimeManifest,
    packetCells: allPacketCells.length, cells: plans.length,
    preSynthesisManualCaseIds: [...preSynthesisManualCaseIds].sort(),
    preSynthesisManualCellsSkipped: allPacketCells.filter((cell) => preSynthesisManualCaseIds.has(cell.caseId)).length,
    preSynthesisOperationalCensorCaseIds: [...preSynthesisOperationalCensorCaseIds].sort(),
    preSynthesisOperationalCensorCellsSkipped: allPacketCells
      .filter((cell) => preSynthesisOperationalCensorCaseIds.has(cell.caseId)).length,
    plannedReadyCells: synthesisDisposition.plannedReadyCells,
    readyCells: synthesisDisposition.executableReadyCells,
    manualCaseIds: [...manualCaseIds].sort(),
    maximumRequestTokens: Math.max(0, ...plans.map((item) => item.plan.requestTokens))
  };
  const summaryFile = path.join(outputRoot, "summary.json");
  if (resume) {
    const existingSummary = readJson(summaryFile);
    const comparableExisting = { ...existingSummary };
    delete comparableExisting.runtimeManualCaseIds;
    if (JSON.stringify(comparableExisting) !== JSON.stringify(summaryBase)) {
      throw new Error("Synthesis resume summary differs from the original admitted campaign summary.");
    }
  } else writeJson(summaryFile, { ...summaryBase, runtimeManualCaseIds: [] });

  let runtimeManualCaseIds = new Set();
  if (!dryRun) {
    if (!resume) verifyExpectedPlanSeal(process.env.EXPECTED_DRY_PLAN_SEAL, planSeal);
    const tasks = plans.filter((item) => !manualCaseIds.has(item.caseId));
    let client = null;
    const executeTask = async (item) => {
      if (!client) throw new Error("Evaluator provider client was not initialized.");
      const taskStartedAt = new Date().toISOString();
      try {
        return await executeSynthesisSemanticAttempts({ client, item });
      } catch (error) {
        const rawFile = "transport-error.json";
        const errorArtifact = { schemaVersion: 1, status: "transport_error_after_native_retries",
          startedAt: taskStartedAt, completedAt: new Date().toISOString(),
          error: serializeTransportError(error) };
        writeJson(path.join(item.dir, rawFile), errorArtifact);
        const attempts = [{ semanticAttempt: null, rawFile, responseId: null, responseStatus: null,
          insufficiency: { reason: "EVALUATOR_TRANSPORT_FAILURE", providerReason: errorArtifact.error.message },
          usage: null, estimatedCost: null }];
        writeJson(path.join(item.dir, "result.json"), { schemaVersion: 1,
          status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
          disposition: "evaluator_sufficiency_exception_not_arm_failure",
          reason: "EVALUATOR_TRANSPORT_FAILURE", startedAt: taskStartedAt,
          completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(taskStartedAt),
          totalEstimatedUsd: null,
          retryPolicy: { transportOwner: "openai_sdk_native", configuredTransportMaxRetries: 2,
            observedTransportAttemptCount: null }, attempts });
        return { status: "manual_review_required", item, reason: "EVALUATOR_TRANSPORT_FAILURE", attempts };
      }
    };
    if (resume) {
      const expectedCellsRaw = process.env.EXPECTED_SYNTHESIS_CELLS || "";
      if (!/^\d+$/.test(expectedCellsRaw)) {
        throw new Error("Synthesis resume requires exact integer EXPECTED_SYNTHESIS_CELLS.");
      }
      const expectedCells = Number(expectedCellsRaw);
      if (tasks.length !== expectedCells) {
        throw new Error(`Synthesis resume cardinality differs from expectation: cells=${tasks.length}/${expectedCells}.`);
      }
      // Always admit the entire result tree without mutation first. A valid
      // orphan in an early cell must not be materialized before a bad late
      // cell is discovered.
      let inspections = tasks.map((task) => ({ task,
        inspection: inspectSynthesisResumeItem(task, { readOnly: true }) }));
      const completedBefore = inspections.filter((row) => row.inspection.disposition === "completed");
      const retryRows = inspections.filter((row) => row.inspection.disposition === "retry");
      const manualBefore = inspections.filter((row) => row.inspection.disposition === "manual");
      if (resumeInspectOnly) {
        process.stdout.write(`${JSON.stringify({
          schemaVersion: 1,
          status: "SYNTHESIS_RESUME_READ_ONLY_INVENTORY",
          sourceCampaignPlanSealSha256: existingLivePlanSeal.sealSha256,
          sourceEvaluatorAuthoritySha256: existingLivePlanSeal.runtimeManifest.runnerAuthority.authoritySha256,
          plannedCells: tasks.length,
          completed: completedBefore.length,
          recoveredSuccessfulOrphans: completedBefore.filter((row) =>
            row.inspection.recoveredWithoutPaidCall).length,
          retryable: retryRows.length,
          retryableTransport: retryRows.filter((row) =>
            row.inspection.reason === "EVALUATOR_TRANSPORT_FAILURE").length,
          retryableMissing: retryRows.filter((row) =>
            row.inspection.reason === "MISSING_PLANNED_RESULT").length,
          manualNonretryable: manualBefore.length,
          expectedCells,
          inspectOnly: true,
          providerClientConstructed: false,
          filesystemMutations: 0
        }, null, 2)}\n`);
        return;
      }
      const completionSealFile = path.join(outputRoot, "RESUME_COMPLETION_SEAL.json");
      if (fs.existsSync(completionSealFile)) {
        const completion = readJson(completionSealFile);
        validateCampaignPlanSeal(completion, "Synthesis resume completion seal");
        const completedRows = inspections.filter((row) => row.inspection.disposition === "completed");
        const terminalManualRows = inspections.filter((row) => row.inspection.disposition === "manual");
        const runtimeCaseIds = [...new Set(terminalManualRows.map((row) => row.task.caseId))].sort();
        const completedSummary = { ...summaryBase, runtimeManualCaseIds: runtimeCaseIds };
        const completedSummarySha256 = sha256(`${JSON.stringify(completedSummary, null, 2)}\n`);
        const cellArtifacts = synthesisResumeCellArtifactLedger(inspections);
        const resultArtifacts = cellArtifacts.filter((row) => row.result).map((row) => ({
          armId: row.armId, caseId: row.caseId, resultSha256: row.result.sha256
        }));
        const runtimeManualFile = path.join(outputRoot, "manual-review-required-runtime.json");
        const expectedRuntimeManual = terminalManualRows.length
          ? synthesisRuntimeManualArtifact(allPacketCells, terminalManualRows) : null;
        const runtimeManualArtifact = expectedRuntimeManual && fs.existsSync(runtimeManualFile)
          ? optionalFileLedger(runtimeManualFile) : null;
        if (completion.kind !== "provider_synthesis_resume_completion"
          || retryRows.length || completedBefore.some((row) => row.inspection.requiresMaterialization)
          || completion.expectedCellCount !== expectedCells
          || cellArtifacts.length !== expectedCells
          || completion.completedCellCount !== completedRows.length
          || completion.terminalManualCellCount !== terminalManualRows.length
          || JSON.stringify(completion.terminalManualCaseIds) !== JSON.stringify(runtimeCaseIds)
          || completion.completedCellCount + completion.terminalManualCellCount !== expectedCells
          || completion.sourceCampaignPlanSealSha256 !== existingLivePlanSeal.sealSha256
          || completion.summarySha256 !== completedSummarySha256
          || JSON.stringify(completion.cellArtifacts) !== JSON.stringify(cellArtifacts)
          || JSON.stringify(completion.resultArtifacts) !== JSON.stringify(resultArtifacts)
          || JSON.stringify(completion.runtimeManualArtifact) !== JSON.stringify(runtimeManualArtifact)
          || (expectedRuntimeManual
            && (!fs.existsSync(runtimeManualFile)
              || JSON.stringify(readJson(runtimeManualFile)) !== JSON.stringify(expectedRuntimeManual)))
          || (!expectedRuntimeManual && fs.existsSync(runtimeManualFile))) {
          throw new Error("Existing synthesis resume completion seal disagrees with current artifacts.");
        }
        if (fs.readFileSync(summaryFile, "utf8") !== `${JSON.stringify(completedSummary, null, 2)}\n`) {
          writeJson(summaryFile, completedSummary);
        }
        return;
      }

      // The global admission above succeeded. Materialize only those valid
      // successful orphans that were identified without a paid call.
      inspections = inspections.map((row) => row.inspection.requiresMaterialization
        ? { task: row.task, inspection: inspectSynthesisResumeItem(row.task) } : row);
      const preserved = retryRows.map((row) => ({
        armId: row.task.armId, caseId: row.task.caseId, reason: row.inspection.reason,
        ...preservePreResumeSynthesisFailure(row.inspection)
      }));
      if (retryRows.length) {
        const OpenAI = require(path.join(nodeModules, "openai")).default;
        client = new OpenAI({ apiKey: process.env.AZURE_OPENAI_API_KEY,
          baseURL: process.env.AZURE_OPENAI_BASE_URL, maxRetries: 2, timeout: 15 * 60 * 1000 });
        await runPool(retryRows.map((row) => row.task), 10, executeTask);
      }
      const finalInspections = tasks.map((task) => ({ task,
        inspection: inspectSynthesisResumeItem(task, { readOnly: true }) }));
      const retryRemaining = finalInspections.filter((row) => row.inspection.disposition === "retry");
      const terminalManual = finalInspections.filter((row) => row.inspection.disposition === "manual");
      const runtimeManualFile = path.join(outputRoot, "manual-review-required-runtime.json");
      if (retryRemaining.length) {
        const incomplete = finalInspections.filter((row) => row.inspection.disposition !== "completed");
        const previousRuntimeManual = archivePreResumeFile(runtimeManualFile);
        const runtimeCaseIds = new Set(incomplete.map((row) => row.task.caseId));
        writeJson(runtimeManualFile, { ...synthesisRuntimeManualArtifact(allPacketCells, incomplete),
          previousRuntimeManual });
        writeJson(summaryFile, { ...summaryBase, runtimeManualCaseIds: [...runtimeCaseIds].sort() });
        throw new Error(`Synthesis resume remains retryable for ${retryRemaining.length} planned cells.`);
      }
      const previousRuntimeManual = archivePreResumeFile(runtimeManualFile);
      if (finalInspections.length !== expectedCells
        || finalInspections.filter((row) => row.inspection.disposition === "completed").length
          + terminalManual.length !== expectedCells) {
        throw new Error("Synthesis resume final campaign cardinality validation failed.");
      }
      const runtimeManual = terminalManual.length
        ? synthesisRuntimeManualArtifact(allPacketCells, terminalManual) : null;
      if (runtimeManual) writeJson(runtimeManualFile, runtimeManual);
      const runtimeCaseIds = [...new Set(terminalManual.map((row) => row.task.caseId))].sort();
      const completedSummary = { ...summaryBase, runtimeManualCaseIds: runtimeCaseIds };
      writeJson(summaryFile, completedSummary);
      const cellArtifacts = synthesisResumeCellArtifactLedger(finalInspections);
      const resultArtifacts = cellArtifacts.filter((row) => row.result).map((row) => ({
        armId: row.armId, caseId: row.caseId, resultSha256: row.result.sha256
      }));
      const completionSeal = makeCampaignPlanSeal("provider_synthesis_resume_completion", {
        sourceCampaignPlanSealSha256: existingLivePlanSeal.sealSha256,
        sourceEvaluatorAuthority: existingLivePlanSeal.runtimeManifest.runnerAuthority,
        resumeEvaluatorAuthority: evaluatorRunnerAuthority(__dirname),
        expectedCellCount: expectedCells,
        completedCellCount: finalInspections.filter((row) =>
          row.inspection.disposition === "completed").length,
        terminalManualCellCount: terminalManual.length,
        terminalManualCaseIds: runtimeCaseIds,
        preservedCompletedCellCount: completedBefore.length,
        retriedCellCount: retryRows.length,
        recoveredWithoutPaidCallCount: completedBefore.filter((row) =>
          row.inspection.recoveredWithoutPaidCall).length,
        summarySha256: fileSha256(summaryFile),
        runtimeManualArtifact: runtimeManual ? optionalFileLedger(runtimeManualFile) : null,
        previousRuntimeManual,
        preserved,
        cellArtifacts,
        resultArtifacts
      });
      writeJsonExclusive(completionSealFile, completionSeal);
      return;
    }
    const OpenAI = require(path.join(nodeModules, "openai")).default;
    client = new OpenAI({ apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: process.env.AZURE_OPENAI_BASE_URL, maxRetries: 2, timeout: 15 * 60 * 1000 });
    const outcomes = await runPool(tasks, 10, executeTask);
    const runtimeManual = outcomes.filter((outcome) => outcome.status === "manual_review_required");
    runtimeManualCaseIds = new Set(runtimeManual.map((outcome) => outcome.item.caseId));
    if (runtimeManualCaseIds.size) writeJson(path.join(outputRoot, "manual-review-required-runtime.json"), {
      schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
      disposition: "evaluator_sufficiency_exception_not_arm_failure_paired_all_arms",
      caseIds: [...runtimeManualCaseIds].sort(),
      cells: allPacketCells.filter((cell) => runtimeManualCaseIds.has(cell.caseId)).map((cell) => ({
        armId: cell.armId, caseId: cell.caseId,
        reasons: runtimeManual.filter((outcome) => outcome.item.caseId === cell.caseId)
          .map((outcome) => ({ reason: outcome.reason, triggeringArmId: outcome.item.armId }))
      }))
    });
  }
  writeJson(summaryFile, { ...summaryBase, runtimeManualCaseIds: [...runtimeManualCaseIds].sort() });
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { INSTRUCTIONS, atomicManualCaseIds, atomicOperationalCensorCaseIds,
  archivePreResumeFile, assertSynthesisResumeOutputRoot,
  buildSynthesisPlan, compactActionTrace, compactAtomicInput,
  completedSynthesisFromArtifacts, containsProviderResponseEvidence,
  discoverPackets,
  executeSynthesisSemanticAttempts, main, parseOutput, summarizeSynthesisPlans,
  inspectSynthesisResumeItem, preservePreResumeSynthesisFailure,
  synthesisSemanticRawFiles, synthesisTransportFiles,
  estimateCost, RATE_CARD, runPool, synthesisEvidenceBindingAudit, validateSynthesisOutput,
  verifySynthesisResumePlanSeal };

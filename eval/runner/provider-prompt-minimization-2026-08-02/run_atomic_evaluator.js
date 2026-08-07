#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const planner = require("./evaluator_packet_planner.js");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");
const { serializeTransportError } = require("./transport_error_trace.js");

const SUPPORT = ["exact", "partial", "contradicted", "not_found", "unreadable"];
const SOURCE_CLASS = ["fixed_cms_nppes_identity_context", "Q1_exact_provider_first_party",
  "Q2_exact_provider_government", "Q3_permitted_professional_directory", "R_exact_rating_directory",
  "X_prohibited_or_unsafe", "other_permitted", "ambiguous", "unreadable"];
const IDENTITY = ["exact_npi", "strong_name_location", "ambiguous", "wrong_provider", "not_applicable", "unreadable"];
const PURPOSE = ["professional", "personal_or_residential", "ambiguous", "not_applicable", "unreadable"];
const ELIGIBILITY = ["eligible", "ineligible", "ambiguous", "unreadable"];
const CROSS_NPI = ["none", "exact_value_other_npi", "co_bound_bundle_other_npi", "ambiguous", "unreadable"];
const NPI_RESOLUTION = ["exact_requested_npi", "explicit_shared_or_concurrent_use", "name_location_only",
  "none", "ambiguous", "unreadable"];
const LOCATION = ["requested_location", "compatible_professional_location", "different_professional_location",
  "ambiguous", "wrong_location", "not_applicable", "unreadable"];
const DISPLAY_SAFETY = ["professional", "personal_mobile", "residential", "prohibited_source",
  "ambiguous", "not_applicable", "unreadable"];
const RECENCY = ["current", "stale", "conflicting", "undated", "unknown", "not_applicable", "unreadable"];
const FIELD_VALIDITY = ["valid", "partial", "invalid", "not_applicable", "unreadable"];
const DATE_STATUS = ["current_explicit", "stale_explicit", "conflicting_dates", "undated",
  "weak_date_only", "not_applicable", "unreadable"];
const RATE_CARD = Object.freeze({ inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5,
  outputUsdPerMillion: 30, pricingVersion: "azure-public-global-standard-2026-07-30",
  contractRateKnown: false });
const ARTIFACT_LOSS_MINIMUM_FREE_BYTES = 512 * 1024 * 1024;
const estimateCost = (usage = {}) => {
  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return {
    estimatedUsd: ((Math.max(0, input - cached) * RATE_CARD.inputUsdPerMillion)
      + (cached * RATE_CARD.cachedInputUsdPerMillion) + (output * RATE_CARD.outputUsdPerMillion)) / 1_000_000,
    inputTokens: input, cachedInputTokens: cached, outputTokens: output, ...RATE_CARD
  };
};

const factChunkAssessment = (indexName) => ({ type: "object", additionalProperties: false,
  required: ["chunkIndex", indexName, "support", "identityLink", "locationLink", "displaySafety",
    "recency", "fieldValidity", "sourceEligibility", "crossNpiConflict", "requestedNpiResolution",
    "evidenceQuotes", "reason"],
  properties: {
    chunkIndex: { type: "integer", minimum: 0 },
    [indexName]: { type: "integer", minimum: 0 },
    support: { type: "string", enum: SUPPORT },
    identityLink: { type: "string", enum: IDENTITY },
    locationLink: { type: "string", enum: LOCATION },
    displaySafety: { type: "string", enum: DISPLAY_SAFETY },
    recency: { type: "string", enum: RECENCY },
    fieldValidity: { type: "string", enum: FIELD_VALIDITY },
    sourceEligibility: { type: "string", enum: ELIGIBILITY },
    crossNpiConflict: { type: "string", enum: CROSS_NPI },
    requestedNpiResolution: { type: "string", enum: NPI_RESOLUTION },
    evidenceQuotes: { type: "array", items: { type: "string" } },
    reason: { type: "string" }
  }
});
const fileSha256 = (file) => planner.sha256(fs.readFileSync(file));
const runtimeManifest = ({ tokenizerModules }) => ({
  schemaVersion: 1,
  model: "gpt-5.6-sol",
  reasoning: "high",
  nodeExecutable: process.execPath,
  nodeVersion: process.version,
  tokenizerModules: path.resolve(tokenizerModules),
  evaluatorScript: { path: __filename, sha256: fileSha256(__filename) },
  plannerScript: { path: path.join(__dirname, "evaluator_packet_planner.js"),
    sha256: fileSha256(path.join(__dirname, "evaluator_packet_planner.js")) },
  runnerAuthority: evaluatorRunnerAuthority(__dirname),
  atomicSchemaSha256: planner.sha256(JSON.stringify(ATOMIC_SCHEMA)),
  instructionsSha256: planner.sha256(INSTRUCTIONS)
});

const ATOMIC_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["sourceChunkAssessments", "claimChunkAssessments", "candidateChunkAssessments"],
  properties: {
    sourceChunkAssessments: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["chunkIndex", "sourceClass", "identityAttachment", "crossNpiConflict", "requestedNpiResolution",
        "professionalPurpose", "dateStatus", "providerIdentitySupported", "prohibitedForDisplay",
        "declaredDates", "evidenceQuotes", "notes"],
      properties: {
        chunkIndex: { type: "integer", minimum: 0 },
        sourceClass: { type: "string", enum: SOURCE_CLASS },
        identityAttachment: { type: "string", enum: IDENTITY },
        crossNpiConflict: { type: "string", enum: CROSS_NPI },
        requestedNpiResolution: { type: "string", enum: NPI_RESOLUTION },
        professionalPurpose: { type: "string", enum: PURPOSE },
        dateStatus: { type: "string", enum: DATE_STATUS },
        providerIdentitySupported: { type: "boolean" },
        prohibitedForDisplay: { type: "boolean" },
        declaredDates: { type: "array", items: { type: "object", additionalProperties: false,
          required: ["kind", "value", "strength"], properties: {
            kind: { type: "string", enum: ["published", "updated", "nppes_last_updated", "copyright", "http_last_modified", "other"] },
            value: { type: "string" }, strength: { type: "string", enum: ["strong", "medium", "weak"] }
          } } },
        evidenceQuotes: { type: "array", items: { type: "string" } },
        notes: { type: "string" }
      }
    } },
    claimChunkAssessments: { type: "array", items: factChunkAssessment("claimIndex") },
    candidateChunkAssessments: { type: "array", items: factChunkAssessment("candidateIndex") }
  }
};

const INSTRUCTIONS = [
  "You are an atomic evidence reader for a public medical-provider evaluator.",
  "Use only the fixed identity context, shared factTargets, fact references, and complete declared source chunks supplied. Do not browse.",
  "Each claim or candidate references one factTarget by targetIndex. Resolve that target before assessing the fact; citedSourceIndex binds its submitted citation to one arm-owned source.",
  "Each bounded chunk is part of one arm-owned source. Assess every chunk, claim/chunk pair, and candidate/chunk pair in input order.",
  "A chunk-local not_found means only that this chunk lacks support; it is not a whole-page absence finding.",
  "NPI and name are primary identity. Specialty and request location may be stale cross-checks, never identity gates.",
  "Professional contacts exclude fax, personal/mobile/home numbers and residential or uncertain-purpose addresses.",
  "Page, profile, registry-record, dataset-refresh, crawl, copyright, publication, or generic update dates may be recorded as source context, but they do not date a displayed fact. Set a claim or candidate's recency to current, stale, or conflicting only when readable evidence ties a date or effective-status statement to that exact value and fact; otherwise use undated even when the page declares other dates.",
  "Q1 exact provider/practice/facility page precedes Q2 exact-provider government registry, then Q3 permitted directory; source class requires readable attachment, not domain appearance.",
  "Return short evidence excerpts copied from the supplied chunk for every positive, contradictory, or contextual judgment. The host collapses whitespace and ignores deterministic parenthesized link-target annotations when verifying attribution. Empty evidenceQuotes is required for not_found or unreadable.",
  "Do not return aggregate scores, whole-case field judgments, or facts not present in the input."
].join("\n");

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const assertFreshOutputRoot = (root) => {
  const resolved = path.resolve(root);
  if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) {
    throw new Error(`OUTPUT_ROOT must be absent or empty: ${resolved}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
};
const assertResumeOutputRoot = (root) => {
  const resolved = path.resolve(root);
  for (const name of ["summary.json", "CAMPAIGN_PLAN_SEAL.json", "manual-review-required.json"]) {
    if (!fs.existsSync(path.join(resolved, name))) {
      throw new Error(`Atomic resume root is missing ${name}: ${resolved}`);
    }
  }
  return resolved;
};
const makeCampaignPlanSeal = (kind, payload) => {
  const unsigned = { schemaVersion: 1, kind, ...payload };
  return { ...unsigned, sealSha256: planner.sha256(JSON.stringify(unsigned)) };
};
const verifyExpectedPlanSeal = (expectedFile, currentSeal) => {
  if (!expectedFile || !fs.existsSync(expectedFile)) throw new Error("Live execution requires EXPECTED_DRY_PLAN_SEAL.");
  const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  const unsigned = { ...expected };
  delete unsigned.sealSha256;
  if (expected.sealSha256 !== planner.sha256(JSON.stringify(unsigned))) {
    throw new Error("Expected dry campaign plan seal is internally invalid.");
  }
  if (expected.sealSha256 !== currentSeal.sealSha256
    || JSON.stringify(expected) !== JSON.stringify(currentSeal)) {
    throw new Error("Live campaign plan/request/schema/runtime policy differs from dry admission seal.");
  }
  return true;
};
const validateCampaignPlanSeal = (seal, label = "campaign plan seal") => {
  const unsigned = { ...seal };
  delete unsigned.sealSha256;
  if (!seal?.sealSha256 || seal.sealSha256 !== planner.sha256(JSON.stringify(unsigned))) {
    throw new Error(`${label} is internally invalid.`);
  }
  return true;
};
const verifyResumePlanSeal = ({ expectedDryPlanSealFile, existingLivePlanSeal, recomputedPlanSeal,
  sourceEvaluatorAuthoritySha256 }) => {
  if (!expectedDryPlanSealFile || !fs.existsSync(expectedDryPlanSealFile)) {
    throw new Error("Atomic resume requires the original EXPECTED_DRY_PLAN_SEAL.");
  }
  const dry = readJson(expectedDryPlanSealFile);
  validateCampaignPlanSeal(dry, "Expected dry campaign plan seal");
  validateCampaignPlanSeal(existingLivePlanSeal, "Existing live campaign plan seal");
  validateCampaignPlanSeal(recomputedPlanSeal, "Recomputed resume campaign plan seal");
  if (JSON.stringify(dry) !== JSON.stringify(existingLivePlanSeal)) {
    throw new Error("Atomic resume live plan differs from the original sealed dry plan.");
  }
  const sealedAuthority = existingLivePlanSeal.runtimeManifest?.runnerAuthority?.authoritySha256;
  if (!sourceEvaluatorAuthoritySha256 || sourceEvaluatorAuthoritySha256 !== sealedAuthority) {
    throw new Error("Atomic resume source authority differs from the original sealed plan authority.");
  }
  const comparable = (seal) => {
    const value = structuredClone(seal);
    delete value.sealSha256;
    if (value.runtimeManifest?.evaluatorScript) value.runtimeManifest.evaluatorScript.sha256 = "<authority-transition>";
    if (value.runtimeManifest) value.runtimeManifest.runnerAuthority = "<authority-transition>";
    return value;
  };
  if (JSON.stringify(comparable(existingLivePlanSeal)) !== JSON.stringify(comparable(recomputedPlanSeal))) {
    throw new Error("Atomic resume plan/request/schema/runtime policy differs from the original sealed plan.");
  }
  const sourceAuthority = existingLivePlanSeal.runtimeManifest?.runnerAuthority;
  const resumeAuthority = recomputedPlanSeal.runtimeManifest?.runnerAuthority;
  if (sourceAuthority?.schemaVersion !== resumeAuthority?.schemaVersion
    || sourceAuthority?.authority !== resumeAuthority?.authority) {
    throw new Error("Atomic resume authority identity differs from the original evaluator authority.");
  }
  const sourceFiles = new Map((sourceAuthority?.files || []).map((file) => [file.name, file]));
  const resumeFiles = new Map((resumeAuthority?.files || []).map((file) => [file.name, file]));
  if (sourceAuthority?.authoritySha256 !== resumeAuthority?.authoritySha256
    && (!sourceFiles.size || !resumeFiles.size)) {
    throw new Error("Atomic resume authority transition lacks sealed file manifests.");
  }
  const changedAuthorityFiles = [...new Set([...sourceFiles.keys(), ...resumeFiles.keys()])]
    .filter((name) => {
      const left = sourceFiles.get(name);
      const right = resumeFiles.get(name);
      return !left || !right || left.sha256 !== right.sha256 || left.byteLength !== right.byteLength;
    });
  const allowedAuthorityTransitionFiles = new Set(["run_atomic_evaluator.js", "compile_corrected_campaign.js"]);
  const disallowedAuthorityFiles = changedAuthorityFiles.filter((name) =>
    !allowedAuthorityTransitionFiles.has(name));
  if (disallowedAuthorityFiles.length) {
    throw new Error(`Atomic resume authority transition changes disallowed files: ${disallowedAuthorityFiles.join(", ")}`);
  }
  return true;
};
const runPool = async (items, concurrency, operation) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await operation(items[index], index); }
  }));
  return results;
};
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
  return found.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.armId.localeCompare(b.armId));
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, stableValue(value[key])]));
  return value;
};

const factTargetDictionary = (packet) => {
  const sourceIndexById = new Map((packet.sources || []).map((source, sourceIndex) =>
    [source.sourceId, sourceIndex]));
  const targets = [];
  const targetIndexByKey = new Map();
  const bind = (fact, kind, itemIndex) => {
    const citedSourceIndex = sourceIndexById.get(fact.sourceId);
    if (!Number.isInteger(citedSourceIndex)) {
      throw new Error(`${kind} ${itemIndex} cites an unknown packet source.`);
    }
    const semantic = {
      fieldType: fact.fieldType,
      value: fact.value,
      citedSourceIndex,
      modelCitation: fact.modelCitation || null
    };
    const key = JSON.stringify(stableValue(semantic));
    let targetIndex = targetIndexByKey.get(key);
    if (!Number.isInteger(targetIndex)) {
      targetIndex = targets.length;
      targetIndexByKey.set(key, targetIndex);
      targets.push({ targetIndex, ...semantic });
    }
    return { [`${kind}Index`]: itemIndex, targetIndex };
  };
  const claims = (packet.claims || []).map((fact, claimIndex) => bind(fact, "claim", claimIndex));
  const candidates = (packet.preSanitizerCandidates || []).map((fact, candidateIndex) =>
    bind(fact, "candidate", candidateIndex));
  return { targets, claims, candidates };
};

const modelChunkText = (unit) => {
  const delimiter = unit.deliveredContent.indexOf("\n");
  if (delimiter < 0) throw new Error("Atomic unit wrapper lacks a newline delimiter.");
  return unit.deliveredContent.slice(delimiter + 1);
};

const measureRequestSections = ({ countTokens, request, input }) => {
  const measure = (value) => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return { bytes: Buffer.byteLength(serialized), tokens: countTokens(serialized) };
  };
  return {
    instructions: measure(request.instructions),
    schema: measure(request.text.format.schema),
    identityContext: measure(input.identityContext),
    factTargets: measure(input.factTargets),
    factReferences: measure({ claims: input.claims, candidates: input.candidates }),
    sourceChunks: measure(input.sourceChunks),
    completeRequest: measure(request)
  };
};

const buildAtomicPlan = (packet, {
  countTokens,
  countSourceTokens = (text) => Buffer.byteLength(text),
  maximumChunkTokens = 160_000,
  maximumAssessmentRows = 48,
  maximumOutputTokens = 48_000
} = {}) => {
  if (typeof countTokens !== "function") throw new Error("countTokens is required.");
  const dictionary = factTargetDictionary(packet);
  const units = [];
  const invalidNormalizations = [];
  const manualReviewReasons = [];
  const sourceCoverage = [];
  const rolesBySource = planner.sourceRoles(packet);
  for (const [sourceIndex, source] of packet.sources.entries()) {
    const projection = planner.planWorkbookProjection(source, packet);
    sourceCoverage.push({ sourceIndex, sourceId: source.sourceId,
      mode: projection.applied ? "deterministic_index_projection_from_complete_workbook" : "complete_source_chunks",
      fullOriginalSourceModelRead: !projection.applied,
      workbookRetrievalAudit: projection.audit || null });
    for (const reason of source.normalization?.manualReviewSignals || []) {
      manualReviewReasons.push({ sourceIndex, sourceId: source.sourceId, reason });
    }
    if (projection.audit?.requiresManualReview) for (const reason of projection.audit.manualReviewReasons) {
      manualReviewReasons.push({ sourceIndex, sourceId: source.sourceId, reason,
        workbookRetrievalAudit: projection.audit });
    }
    const planned = planner.planSourceChunks(projection.source, {
      countTokens: countSourceTokens, maximumChunkTokens, wrapperTokens: 2_000
    });
    if (planned.status !== "chunked") {
      invalidNormalizations.push({ sourceIndex, sourceId: source.sourceId, status: planned.status,
        defects: planned.defects || [], format: planned.format || null });
      continue;
    }
    for (const chunk of planned.chunks) units.push({
      sourceIndex,
      sourceId: source.sourceId,
      sourceUrl: source.url,
      sourceRoles: rolesBySource.get(source.sourceId),
      workbookRetrievalAudit: projection.audit,
      sourceTextSha256: planned.sourceTextSha256,
      ...chunk
    });
  }
  const assessmentRowsPerUnit = 1 + packet.claims.length + (packet.preSanitizerCandidates || []).length;
  if (assessmentRowsPerUnit > maximumAssessmentRows) manualReviewReasons.push({
    sourceIndex: null, sourceId: null, reason: "ATOMIC_ASSESSMENT_ROW_BUDGET_EXCEEDED",
    assessmentRowsPerUnit, maximumAssessmentRows
  });
  const batches = [];
  for (const unit of [...units].sort((a, b) => b.serializedTokens - a.serializedTokens
    || a.sourceIndex - b.sourceIndex || a.chunkIndex - b.chunkIndex)) {
    let batch = batches.find((candidate) => candidate.sourceTokens + unit.serializedTokens <= 120_000
      && candidate.assessmentRows + assessmentRowsPerUnit <= maximumAssessmentRows);
    if (!batch) { batch = { sourceTokens: 0, assessmentRows: 0, units: [] }; batches.push(batch); }
    batch.units.push(unit);
    batch.sourceTokens += unit.serializedTokens;
    batch.assessmentRows += assessmentRowsPerUnit;
  }
  const requests = batches.map((batch, requestIndex) => {
    const input = {
      schemaVersion: 2,
      identityContext: packet.identityContext,
      factTargets: dictionary.targets,
      claims: dictionary.claims,
      candidates: dictionary.candidates,
      sourceChunks: batch.units.map((unit, chunkIndex) => ({
        chunkIndex,
        sourceIndex: unit.sourceIndex,
        canonicalUrl: planner.canonicalUrl(unit.sourceUrl),
        roles: unit.sourceRoles,
        text: modelChunkText(unit)
      }))
    };
    const request = {
      model: "gpt-5.6-sol", reasoning: { effort: "high" }, store: false, truncation: "disabled",
      max_output_tokens: maximumOutputTokens,
      instructions: INSTRUCTIONS,
      input: `Return exactly ${batch.units.length} sourceChunkAssessments, ${batch.units.length * packet.claims.length} claimChunkAssessments, and ${batch.units.length * (packet.preSanitizerCandidates || []).length} candidateChunkAssessments. Each fact array is chunk-major, then item-index order.\n${JSON.stringify(input)}`,
      text: { format: { type: "json_schema", name: "provider_atomic_evidence_v1", strict: true, schema: ATOMIC_SCHEMA } }
    };
    return { requestIndex, units: batch.units, input, request,
      assessmentRows: batch.assessmentRows, maximumAssessmentRows, maximumOutputTokens,
      requestTokens: countTokens(JSON.stringify(request)),
      sectionMetrics: measureRequestSections({ countTokens, request, input }) };
  });
  return {
    schemaVersion: 1,
    sourceCount: packet.sources.length,
    claimCount: packet.claims.length,
    candidateCount: (packet.preSanitizerCandidates || []).length,
    uniqueFactTargetCount: dictionary.targets.length,
    intendedSourceByUniqueFactComparisonCount: packet.sources.length * dictionary.targets.length,
    plannedSourceByUniqueFactComparisonCount:
      new Set(units.map((unit) => unit.sourceIndex)).size * dictionary.targets.length,
    sourceByUniqueFactComparisonMatrixComplete: invalidNormalizations.length === 0,
    factTargetDictionary: dictionary,
    unitCount: units.length,
    requestCount: requests.length,
    invalidNormalizations,
    manualReviewReasons,
    sourceCoverage,
    maximumAssessmentRows,
    maximumOutputTokens,
    maximumRequestTokens: Math.max(0, ...requests.map((item) => item.requestTokens)),
    contextOverflowCount: requests.filter((item) => item.requestTokens > 224_000).length,
    requests
  };
};

const parseOutputText = (raw) => {
  if (typeof raw.output_text === "string" && raw.output_text) return JSON.parse(raw.output_text);
  const text = (raw.output || []).flatMap((item) => item.type === "message" ? item.content || [] : [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("Atomic judge returned no output_text.");
  return JSON.parse(text);
};
const classifyEvaluatorInsufficiency = (raw) => {
  const incompleteReason = String(raw?.incomplete_details?.reason || raw?.error?.code || "").toLowerCase();
  if (raw?.status === "incomplete") {
    const reason = incompleteReason === "max_output_tokens" ? "EVALUATOR_MAX_OUTPUT_TOKENS"
      : incompleteReason.includes("content_filter") ? "EVALUATOR_CONTENT_FILTER"
        : "EVALUATOR_INCOMPLETE_RESPONSE";
    return { reason, responseStatus: raw.status, providerReason: incompleteReason || null };
  }
  const refusal = (raw?.output || []).flatMap((item) => item.type === "message" ? item.content || [] : [])
    .find((content) => content.type === "refusal");
  if (refusal) return { reason: "EVALUATOR_REFUSAL", responseStatus: raw.status || null,
    providerReason: String(refusal.refusal || refusal.text || "refusal").slice(0, 400) };
  return null;
};
const executeAtomicSemanticAttempts = async ({ client, cell, plannedRequest, semanticMaxAttempts = 2 }) => {
  if (!Number.isSafeInteger(semanticMaxAttempts) || semanticMaxAttempts < 1 || semanticMaxAttempts > 2) {
    throw new Error("semanticMaxAttempts must be 1 or 2.");
  }
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const attempts = [];
  const finishManual = (insufficiency) => {
    const result = { schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
      disposition: "evaluator_sufficiency_exception_not_arm_failure", requestIndex: plannedRequest.requestIndex,
      reason: insufficiency.reason, providerReason: insufficiency.providerReason,
      startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - start,
      totalEstimatedUsd: attempts.reduce((sum, attempt) => sum + attempt.estimatedCost.estimatedUsd, 0),
      retryPolicy: { semanticMaxAttempts, semanticAttemptsUsed: attempts.length,
        semanticRetryReasons: ["EVALUATOR_CONTENT_FILTER", "EVALUATOR_INCOMPLETE_RESPONSE",
          "EVALUATOR_REFUSAL", "EVALUATOR_MALFORMED_OUTPUT"],
        nonRetryableReasons: ["EVALUATOR_MAX_OUTPUT_TOKENS"],
        transportOwner: "openai_sdk_native", configuredTransportMaxRetriesPerSemanticAttempt: 2 },
      attempts };
    writeJson(path.join(cell.dir, `result-${plannedRequest.requestIndex}.json`), result);
    return { status: "manual_review_required", cell, plannedRequest, reason: insufficiency.reason, attempts };
  };
  for (let semanticAttempt = 1; semanticAttempt <= semanticMaxAttempts; semanticAttempt += 1) {
    const raw = await client.responses.create(plannedRequest.request);
    const rawFile = `raw-${plannedRequest.requestIndex}-semantic-${String(semanticAttempt).padStart(2, "0")}.json`;
    writeJson(path.join(cell.dir, rawFile), raw);
    let insufficiency = classifyEvaluatorInsufficiency(raw);
    attempts.push({ semanticAttempt, rawFile, responseId: raw.id || null, responseStatus: raw.status || null,
      insufficiency, usage: raw.usage || null, estimatedCost: estimateCost(raw.usage) });
    let parsed = null;
    let quoteAttributionAudit = null;
    if (!insufficiency) {
      try {
        parsed = parseOutputText(raw);
        validateAtomicOutput(parsed, plannedRequest, cell.packet.claims.length);
        quoteAttributionAudit = auditAtomicEvidenceQuotes(parsed, plannedRequest);
        attempts.at(-1).quoteAttributionAudit = quoteAttributionAudit;
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
    writeJson(path.join(cell.dir, `parsed-${plannedRequest.requestIndex}.json`), parsed);
    writeJson(path.join(cell.dir, `result-${plannedRequest.requestIndex}.json`), {
      schemaVersion: 1, status: "completed", requestIndex: plannedRequest.requestIndex,
      startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - start,
      responseId: raw.id || null, usage: raw.usage || null,
      quoteAttributionAudit,
      totalEstimatedUsd: attempts.reduce((sum, attempt) => sum + attempt.estimatedCost.estimatedUsd, 0),
      retryPolicy: { semanticMaxAttempts, semanticAttemptsUsed: attempts.length,
        transportOwner: "openai_sdk_native", configuredTransportMaxRetriesPerSemanticAttempt: 2 },
      attempts
    });
    return { status: "completed", cell, plannedRequest, parsed, quoteAttributionAudit, attempts };
  }
  throw new Error("Atomic semantic-attempt loop ended without a disposition.");
};
const unitBody = (unit) => {
  const headerEnd = unit.deliveredContent.indexOf("\n");
  if (headerEnd < 0) throw new Error("Atomic unit wrapper lacks a newline delimiter.");
  return unit.deliveredContent.slice(headerEnd + 1);
};
const quoteProjection = (value, { stripLinkTargets = false, withMap = false } = {}) => {
  const text = String(value || "");
  const ignored = [];
  if (stripLinkTargets) {
    const pattern = /\s*\(https?:\/\/[^\s)]*\)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) ignored.push([match.index, pattern.lastIndex]);
  }
  const projected = [];
  const map = [];
  let ignoredIndex = 0;
  const appendWhitespace = (start, end) => {
    if (!projected.length || projected.at(-1) === " ") {
      if (map.length) map.at(-1).end = Math.max(map.at(-1).end, end);
      return;
    }
    projected.push(" ");
    map.push({ start, end });
  };
  for (let index = 0; index < text.length;) {
    const range = ignored[ignoredIndex];
    if (range && index === range[0]) {
      index = range[1];
      ignoredIndex += 1;
      continue;
    }
    if (/\s/.test(text[index])) {
      const start = index;
      while (index < text.length && /\s/.test(text[index])) index += 1;
      appendWhitespace(start, index);
      continue;
    }
    projected.push(text[index]);
    map.push({ start: index, end: index + 1 });
    index += 1;
  }
  if (projected.at(-1) === " ") { projected.pop(); map.pop(); }
  return withMap ? { text: projected.join(""), map } : projected.join("");
};
const quoteOccurrences = (unit, quote) => {
  const body = unitBody(unit);
  const positions = [];
  let at = body.indexOf(quote);
  while (at >= 0) {
    positions.push({ absoluteStart: unit.deliveredStart + at,
      absoluteEnd: unit.deliveredStart + at + quote.length,
      verificationMode: "byte_exact" });
    at = body.indexOf(quote, at + Math.max(1, quote.length));
  }
  if (positions.length) return positions;
  for (const [stripLinkTargets, verificationMode] of [[false, "whitespace_normalized"],
    [true, "rendered_link_target_normalized"]]) {
    const source = quoteProjection(body, { stripLinkTargets, withMap: true });
    const needle = quoteProjection(quote, { stripLinkTargets });
    if (!needle) continue;
    let projectedAt = source.text.indexOf(needle);
    while (projectedAt >= 0) {
      const first = source.map[projectedAt];
      const last = source.map[projectedAt + needle.length - 1];
      positions.push({ absoluteStart: unit.deliveredStart + first.start,
        absoluteEnd: unit.deliveredStart + last.end, verificationMode });
      projectedAt = source.text.indexOf(needle, projectedAt + Math.max(1, needle.length));
    }
    if (positions.length) return positions;
  }
  return [];
};

const auditAtomicEvidenceQuotes = (parsed, plannedRequest) => {
  const issues = [];
  const inspect = (assessmentKind, rows) => {
    for (const [rowIndex, row] of (rows || []).entries()) {
      const unit = plannedRequest.units[row.chunkIndex];
      for (const [quoteIndex, quote] of (row.evidenceQuotes || []).entries()) {
        if (unit && quoteOccurrences(unit, quote).length) continue;
        issues.push({ assessmentKind, rowIndex, chunkIndex: row.chunkIndex, quoteIndex, quote,
          reasonCode: unit ? "EVIDENCE_EXCERPT_NOT_DETERMINISTICALLY_ATTRIBUTABLE"
            : "EVIDENCE_EXCERPT_CHUNK_MISSING" });
      }
    }
  };
  inspect("source", parsed.sourceChunkAssessments);
  inspect("claim", parsed.claimChunkAssessments);
  inspect("candidate", parsed.candidateChunkAssessments);
  return {
    schemaVersion: 1,
    policy: "unattributed_excerpt_logged_and_not_credited_categorical_judgment_retained",
    submittedQuoteCount: [parsed.sourceChunkAssessments, parsed.claimChunkAssessments,
      parsed.candidateChunkAssessments].flatMap((rows) => rows || [])
      .reduce((sum, row) => sum + (row.evidenceQuotes || []).length, 0),
    rejectedQuoteCount: issues.length,
    creditedQuoteCount: [parsed.sourceChunkAssessments, parsed.claimChunkAssessments,
      parsed.candidateChunkAssessments].flatMap((rows) => rows || [])
      .reduce((sum, row) => sum + (row.evidenceQuotes || []).length, 0) - issues.length,
    issues
  };
};

const validateAtomicOutput = (parsed, plannedRequest, claimCount) => {
  const candidateCount = plannedRequest.input.candidates?.length || 0;
  if (parsed.sourceChunkAssessments?.length !== plannedRequest.units.length
    || parsed.claimChunkAssessments?.length !== plannedRequest.units.length * claimCount
    || parsed.candidateChunkAssessments?.length !== plannedRequest.units.length * candidateCount) {
    throw new Error("Atomic output cardinality mismatch.");
  }
  for (let chunkIndex = 0; chunkIndex < plannedRequest.units.length; chunkIndex += 1) {
    if (parsed.sourceChunkAssessments[chunkIndex].chunkIndex !== chunkIndex) {
      throw new Error("Atomic source chunk binding mismatch.");
    }
  }
  for (let position = 0; position < plannedRequest.units.length * claimCount; position += 1) {
    const row = parsed.claimChunkAssessments[position];
    const chunkIndex = Math.floor(position / claimCount);
    const claimIndex = position % claimCount;
    if (row.chunkIndex !== chunkIndex || row.claimIndex !== claimIndex) throw new Error("Atomic claim binding mismatch.");
  }
  for (let position = 0; position < plannedRequest.units.length * candidateCount; position += 1) {
    const row = parsed.candidateChunkAssessments[position];
    const chunkIndex = Math.floor(position / candidateCount);
    const candidateIndex = position % candidateCount;
    if (row.chunkIndex !== chunkIndex || row.candidateIndex !== candidateIndex) {
      throw new Error("Atomic candidate binding mismatch.");
    }
  }
  return true;
};

const unitKey = (unit) => [unit.sourceIndex, unit.chunkIndex, unit.coreStart, unit.coreEnd,
  unit.deliveredStart, unit.deliveredEnd, unit.sourceTextSha256, unit.deliveredTextSha256].join(":");
const assertAtomicCompletion = (packet, plan, outputs) => {
  if (plan.invalidNormalizations.length || plan.contextOverflowCount) {
    throw new Error("Atomic completion cannot be declared for an inadmissible plan.");
  }
  if (outputs.length !== plan.requests.length) throw new Error("Atomic request completion cardinality mismatch.");
  const expectedRequests = new Map(plan.requests.map((request) => [request.requestIndex, request]));
  const observedRequestIndices = new Set();
  const observedUnits = new Set();
  for (const output of outputs) {
    const index = output.plannedRequest?.requestIndex;
    const expected = expectedRequests.get(index);
    if (!expected || observedRequestIndices.has(index)) throw new Error("Atomic request index missing or duplicated.");
    observedRequestIndices.add(index);
    if (planner.sha256(JSON.stringify(output.plannedRequest.request))
      !== planner.sha256(JSON.stringify(expected.request))) throw new Error("Atomic request hash mismatch.");
    validateAtomicOutput(output.parsed, expected, packet.claims.length);
    for (const unit of output.plannedRequest.units) {
      const key = unitKey(unit);
      if (observedUnits.has(key)) throw new Error("Atomic unit was returned more than once.");
      observedUnits.add(key);
    }
  }
  const expectedUnits = new Set(plan.requests.flatMap((request) => request.units.map(unitKey)));
  if (observedUnits.size !== expectedUnits.size || [...expectedUnits].some((key) => !observedUnits.has(key))) {
    throw new Error("Atomic unit coverage mismatch.");
  }
  const bySource = new Map();
  for (const request of plan.requests) for (const unit of request.units) {
    if (!bySource.has(unit.sourceId)) bySource.set(unit.sourceId, []);
    bySource.get(unit.sourceId).push(unit);
  }
  for (const units of bySource.values()) {
    const length = Math.max(0, ...units.map((unit) => unit.coreEnd));
    planner.verifyIntervalCoverage(length, units);
  }
  return true;
};

const semanticRawFiles = (cellDir, requestIndex) => fs.existsSync(cellDir)
  ? fs.readdirSync(cellDir).filter((name) => new RegExp(`^raw-${requestIndex}-semantic-\\d+\\.json$`).test(name))
    .sort().map((name) => path.join(cellDir, name))
  : [];
const semanticRawArtifactInventory = (cellDir, requestIndex) => semanticRawFiles(cellDir, requestIndex)
  .map((file) => {
    const bytes = fs.readFileSync(file);
    let readableJson = true;
    try { JSON.parse(bytes.toString("utf8")); } catch { readableJson = false; }
    return { file, fileName: path.basename(file), byteLength: bytes.length,
      sha256: planner.sha256(bytes), readableJson };
  });
const artifactLossRecoveryJournalFile = (cellDir, requestIndex) =>
  path.join(cellDir, `artifact-loss-recovery-${requestIndex}.json`);
const assertDiskHeadroom = (root, { minimumFreeBytes = ARTIFACT_LOSS_MINIMUM_FREE_BYTES,
  statfsSync = fs.statfsSync } = {}) => {
  const stats = statfsSync(path.resolve(root));
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
    const error = new Error(`Atomic artifact-loss recovery requires ${minimumFreeBytes} free bytes; observed ${freeBytes}.`);
    error.code = "EVALUATOR_ARTIFACT_LOSS_DISK_HEADROOM_INSUFFICIENT";
    throw error;
  }
  return { schemaVersion: 1, policy: "artifact_loss_recovery_disk_headroom_v1",
    checkedRoot: path.resolve(root), minimumFreeBytes, observedFreeBytes: freeBytes };
};
const artifactLossDisposition = ({ cell, requestIndex, resultFile, result = null, responseArtifacts }) => {
  const journalFile = artifactLossRecoveryJournalFile(cell.dir, requestIndex);
  if (fs.existsSync(journalFile)) return { disposition: "manual", resultFile, result,
    reason: "EVALUATOR_RESPONSE_ARTIFACT_LOSS_RECOVERY_EXHAUSTED", responseBearingArtifactLoss: true,
    responseArtifacts, recoveryJournal: { file: journalFile, sha256: fileSha256(journalFile) } };
  return { disposition: "retry", resultFile, result, reason: "EVALUATOR_RESPONSE_ARTIFACT_LOSS",
    retryClass: "explicit_single_artifact_loss_recovery", responseBearingArtifactLoss: true,
    originalAttemptCostDisposition: "possibly_billed_unknown_cost", responseArtifacts };
};
const completedOutputFromArtifacts = ({ cell, plannedRequest, result = null, allowRecovery = false,
  readOnly = false }) => {
  const requestIndex = plannedRequest.requestIndex;
  const parsedFile = path.join(cell.dir, `parsed-${requestIndex}.json`);
  const rawFiles = semanticRawFiles(cell.dir, requestIndex);
  let parsed = fs.existsSync(parsedFile) ? readJson(parsedFile) : null;
  let supportingRaw = null;
  for (const rawFile of [...rawFiles].reverse()) {
    let raw;
    try { raw = readJson(rawFile); } catch { continue; }
    if (classifyEvaluatorInsufficiency(raw)) continue;
    try {
      const rawParsed = parseOutputText(raw);
      validateAtomicOutput(rawParsed, plannedRequest, cell.packet.claims.length);
      if (parsed && JSON.stringify(parsed) !== JSON.stringify(rawParsed)) {
        throw new Error("Persisted parsed atomic output differs from its raw provider response.");
      }
      parsed ||= rawParsed;
      supportingRaw = { file: rawFile, raw };
      break;
    } catch (error) {
      if (String(error?.message || error).includes("differs from its raw")) throw error;
    }
  }
  if (!parsed || !supportingRaw) return null;
  validateAtomicOutput(parsed, plannedRequest, cell.packet.claims.length);
  if (!fs.existsSync(parsedFile)) {
    if (!allowRecovery) throw new Error("Completed atomic result is missing its parsed artifact.");
    if (!readOnly) writeJsonExclusive(parsedFile, parsed);
  }
  const quoteAttributionAudit = auditAtomicEvidenceQuotes(parsed, plannedRequest);
  if (!result) {
    if (!allowRecovery) return null;
    const stats = fs.statSync(supportingRaw.file);
    const usage = supportingRaw.raw.usage || null;
    const estimatedCost = estimateCost(usage);
    result = {
      schemaVersion: 1, status: "completed", requestIndex,
      startedAt: stats.birthtime.toISOString(), completedAt: stats.mtime.toISOString(),
      durationMs: Math.max(0, stats.mtimeMs - stats.birthtimeMs),
      responseId: supportingRaw.raw.id || null, usage, quoteAttributionAudit,
      totalEstimatedUsd: estimatedCost.estimatedUsd,
      retryPolicy: { semanticMaxAttempts: 2, semanticAttemptsUsed: 1,
        transportOwner: "openai_sdk_native", configuredTransportMaxRetriesPerSemanticAttempt: 2 },
      recoveredFromOrphanedSuccessfulArtifacts: true,
      attempts: [{ semanticAttempt: Number(path.basename(supportingRaw.file).match(/semantic-(\d+)/)?.[1] || 1),
        rawFile: path.basename(supportingRaw.file), responseId: supportingRaw.raw.id || null,
        responseStatus: supportingRaw.raw.status || null, insufficiency: null, usage,
        estimatedCost, quoteAttributionAudit }]
    };
    if (!readOnly) writeJsonExclusive(path.join(cell.dir, `result-${requestIndex}.json`), result);
  }
  if (result.requestIndex !== requestIndex || result.status !== "completed") {
    throw new Error("Completed atomic result has an invalid status or request index.");
  }
  if (result.responseId && supportingRaw.raw.id && result.responseId !== supportingRaw.raw.id) {
    throw new Error("Completed atomic result responseId differs from its raw provider response.");
  }
  for (const attempt of result.attempts || []) {
    const attemptFile = path.join(cell.dir, attempt.rawFile || "");
    if (!attempt.rawFile || !fs.existsSync(attemptFile)) {
      throw new Error("Completed atomic result references a missing raw attempt artifact.");
    }
  }
  return { status: "completed", cell, plannedRequest, parsed, quoteAttributionAudit,
    attempts: result.attempts || [], result };
};
const inspectAtomicResumeItem = ({ cell, plannedRequest }, { readOnly = false } = {}) => {
  const requestIndex = plannedRequest.requestIndex;
  const resultFile = path.join(cell.dir, `result-${requestIndex}.json`);
  if (!fs.existsSync(resultFile)) {
    const recovered = completedOutputFromArtifacts({ cell, plannedRequest, allowRecovery: true, readOnly });
    if (recovered) return { disposition: "completed", output: recovered, resultFile,
      recoveredWithoutPaidCall: true };
    const orphanedRawArtifacts = semanticRawArtifactInventory(cell.dir, requestIndex);
    if (orphanedRawArtifacts.some((artifact) => !artifact.readableJson)) return artifactLossDisposition({
      cell, requestIndex, resultFile, responseArtifacts: orphanedRawArtifacts });
    if (orphanedRawArtifacts.length) return { disposition: "manual", resultFile,
      reason: "ORPHANED_NONCOMPLETED_PROVIDER_RESPONSE_NOT_RETRIED", orphanedRawArtifacts };
    return { disposition: "retry", resultFile, reason: "MISSING_PLANNED_RESULT" };
  }
  const result = readJson(resultFile);
  if (result.status === "completed") {
    const output = completedOutputFromArtifacts({ cell, plannedRequest, result });
    if (!output) throw new Error("Completed atomic result lacks a valid raw/parsed output pair.");
    return { disposition: "completed", output, resultFile, recoveredWithoutPaidCall: false };
  }
  if (result.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED" && result.reason === "EVALUATOR_TRANSPORT_FAILURE") {
    const attempts = result.attempts || [];
    if (attempts.some((attempt) => attempt.responseId || attempt.usage)) {
      throw new Error("Transport-failure result unexpectedly contains a paid provider response.");
    }
    const responseArtifacts = semanticRawArtifactInventory(cell.dir, requestIndex);
    if (responseArtifacts.length) return artifactLossDisposition({ cell, requestIndex, resultFile, result,
      responseArtifacts });
    return { disposition: "retry", resultFile, result, reason: "EVALUATOR_TRANSPORT_FAILURE" };
  }
  return { disposition: "manual", resultFile, reason: result.reason || result.status || "UNKNOWN_RESULT" };
};
const preservePreResumeResult = (inspection) => {
  const hasResult = fs.existsSync(inspection.resultFile);
  const priorAttempts = [];
  for (const attempt of hasResult ? inspection.result?.attempts || [] : []) {
    const source = path.join(path.dirname(inspection.resultFile), attempt.rawFile || "");
    if (!attempt.rawFile || !fs.existsSync(source)) continue;
    const attemptDigest = fileSha256(source);
    const parsed = path.parse(source);
    const backup = path.join(parsed.dir, `${parsed.name}.pre-resume-${attemptDigest.slice(0, 12)}${parsed.ext}`);
    if (fs.existsSync(backup)) {
      if (fileSha256(backup) !== attemptDigest) throw new Error("Pre-resume attempt backup hash mismatch.");
    } else fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
    priorAttempts.push({ path: backup, sha256: attemptDigest });
  }
  const responseArtifacts = (inspection.responseArtifacts || []).map((artifact) => {
    const source = artifact.file;
    const digest = fileSha256(source);
    const parsed = path.parse(source);
    const backup = path.join(parsed.dir, `${parsed.name}.pre-resume-${digest.slice(0, 12)}${parsed.ext}`);
    if (fs.existsSync(backup)) {
      if (fileSha256(backup) !== digest) throw new Error("Pre-resume response-artifact backup hash mismatch.");
    } else fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
    return { path: backup, sha256: digest, byteLength: fs.statSync(backup).size,
      originalFileName: artifact.fileName, readableJson: artifact.readableJson };
  });
  if (!hasResult) return { path: null, sha256: null, priorAttempts, responseArtifacts };
  const digest = fileSha256(inspection.resultFile);
  const backup = inspection.resultFile.replace(/\.json$/, `.pre-resume-${digest.slice(0, 12)}.json`);
  if (fs.existsSync(backup)) {
    if (fileSha256(backup) !== digest) throw new Error("Pre-resume result backup hash mismatch.");
    fs.unlinkSync(inspection.resultFile);
  } else fs.renameSync(inspection.resultFile, backup);
  return { path: backup, sha256: digest, priorAttempts, responseArtifacts };
};
const prepareArtifactLossRecovery = ({ row, priorResult, diskHeadroom }) => {
  const file = artifactLossRecoveryJournalFile(row.task.cell.dir, row.task.plannedRequest.requestIndex);
  const journal = { schemaVersion: 1, status: "ARTIFACT_LOSS_RECOVERY_AUTHORIZED_ONCE",
    armId: row.task.cell.armId, caseId: row.task.cell.caseId,
    requestIndex: row.task.plannedRequest.requestIndex,
    recoveryLimit: 1, recoveryAttempt: 1, furtherArtifactLossRecoveryAllowed: false,
    originalAttempt: { billingDisposition: "possibly_billed_unknown_cost", estimatedUsd: null,
      responseReturnedBeforePersistenceFailure: true, reason: row.inspection.reason,
      preservedResult: priorResult?.path ? { fileName: path.basename(priorResult.path),
        sha256: priorResult.sha256 } : null,
      preservedAttemptArtifacts: (priorResult?.priorAttempts || []).map((item) => ({
        fileName: path.basename(item.path), sha256: item.sha256 })),
      preservedResponseArtifacts: (priorResult?.responseArtifacts || []).map((item) => ({
        fileName: path.basename(item.path), sha256: item.sha256, byteLength: item.byteLength,
        originalFileName: item.originalFileName, readableJson: item.readableJson })) },
    diskHeadroom };
  writeJsonExclusive(file, journal);
  return { file, journal, sha256: fileSha256(file) };
};
const attachArtifactLossRecoveryLineage = ({ row, recoveryJournal }) => {
  const resultFile = path.join(row.task.cell.dir, `result-${row.task.plannedRequest.requestIndex}.json`);
  if (!fs.existsSync(resultFile)) return null;
  const result = readJson(resultFile);
  const originalAttempt = { semanticAttempt: null, attemptClass: "response_artifact_loss_original",
    rawFile: path.basename(recoveryJournal.file), responseId: null, responseStatus: null,
    insufficiency: { reason: "EVALUATOR_RESPONSE_ARTIFACT_LOSS",
      providerReason: "Provider response returned but its raw body could not be persisted." },
    usage: null, estimatedCost: null, billingDisposition: "possibly_billed_unknown_cost" };
  result.attempts = [originalAttempt, ...(result.attempts || [])];
  result.artifactLossRecovery = { schemaVersion: 1, recoveryAttempt: 1, recoveryLimit: 1,
    furtherArtifactLossRecoveryAllowed: false,
    originalAttemptBillingDisposition: "possibly_billed_unknown_cost",
    knownReplacementEstimatedUsd: Number.isFinite(result.totalEstimatedUsd) ? result.totalEstimatedUsd : null,
    totalCostDisposition: "known_replacement_plus_unknown_original",
    recoveryJournal: { fileName: path.basename(recoveryJournal.file), sha256: recoveryJournal.sha256 },
    preservedResponseArtifacts: recoveryJournal.journal.originalAttempt.preservedResponseArtifacts };
  writeJson(resultFile, result);
  return { resultFile, resultSha256: fileSha256(resultFile) };
};

const mergeAtomicOutputs = (packet, plan, outputs) => {
  assertAtomicCompletion(packet, plan, outputs);
  const sourceChunks = new Map();
  const claimSourceChunks = new Map();
  const candidateSourceChunks = new Map();
  const evidence = [];
  const quoteAudits = [];
  for (const { plannedRequest, parsed } of outputs) {
    validateAtomicOutput(parsed, plannedRequest, packet.claims.length);
    const quoteAudit = auditAtomicEvidenceQuotes(parsed, plannedRequest);
    quoteAudits.push({ requestIndex: plannedRequest.requestIndex, ...quoteAudit });
    for (const row of parsed.sourceChunkAssessments) {
      const unit = plannedRequest.units[row.chunkIndex];
      const sourceId = unit.sourceId;
      if (!sourceChunks.has(sourceId)) sourceChunks.set(sourceId, []);
      sourceChunks.get(sourceId).push(row);
      for (const quote of row.evidenceQuotes || []) {
        for (const occurrence of quoteOccurrences(unit, quote)) evidence.push({
          kind: "source", sourceId, itemIndex: unit.sourceIndex, ...occurrence, quote
        });
      }
    }
    for (const row of parsed.claimChunkAssessments) {
      const unit = plannedRequest.units[row.chunkIndex];
      const sourceId = unit.sourceId;
      const key = `${row.claimIndex}:${sourceId}`;
      if (!claimSourceChunks.has(key)) claimSourceChunks.set(key, []);
      claimSourceChunks.get(key).push(row);
      for (const quote of row.evidenceQuotes || []) {
        for (const occurrence of quoteOccurrences(unit, quote)) evidence.push({
          kind: "claim", sourceId, itemIndex: row.claimIndex, claimIndex: row.claimIndex, ...occurrence, quote
        });
      }
    }
    for (const row of parsed.candidateChunkAssessments) {
      const unit = plannedRequest.units[row.chunkIndex];
      const sourceId = unit.sourceId;
      const key = `${row.candidateIndex}:${sourceId}`;
      if (!candidateSourceChunks.has(key)) candidateSourceChunks.set(key, []);
      candidateSourceChunks.get(key).push(row);
      for (const quote of row.evidenceQuotes || []) {
        for (const occurrence of quoteOccurrences(unit, quote)) evidence.push({
          kind: "candidate", sourceId, itemIndex: row.candidateIndex, ...occurrence, quote
        });
      }
    }
  }
  const categories = (rows, field) => [...new Set(rows.map((row) => row[field]))];
  return {
    schemaVersion: 1,
    status: plan.invalidNormalizations.length ? "requires_normalization_refetch" : "atomic_read_complete",
    sourceAssessments: packet.sources.map((source) => {
      const rows = sourceChunks.get(source.sourceId) || [];
      const axes = Object.fromEntries(["sourceClass", "identityAttachment", "crossNpiConflict",
        "requestedNpiResolution", "professionalPurpose", "dateStatus", "providerIdentitySupported",
        "prohibitedForDisplay"].map((field) => [field, categories(rows, field)]));
      return { sourceId: source.sourceId, chunkAssessments: rows, observedCategories: axes,
        requiresBoundedSynthesis: Object.values(axes).some((values) => values.length !== 1) };
    }),
    claimSourceAssessments: [...claimSourceChunks].map(([key, rows]) => {
      const [claimIndex, sourceId] = key.split(":");
      return { claimIndex: Number(claimIndex), sourceId, chunkAssessments: rows,
        observedSupportCategories: categories(rows, "support"),
        observedEligibilityCategories: categories(rows, "sourceEligibility"),
        requiresBoundedSynthesis: ["support", "identityLink", "locationLink", "displaySafety", "recency",
          "fieldValidity", "sourceEligibility", "crossNpiConflict", "requestedNpiResolution"]
          .some((field) => categories(rows, field).length !== 1) };
    }),
    candidateSourceAssessments: [...candidateSourceChunks].map(([key, rows]) => {
      const [candidateIndex, sourceId] = key.split(":");
      return { candidateIndex: Number(candidateIndex), sourceId, chunkAssessments: rows,
        observedSupportCategories: categories(rows, "support"),
        observedEligibilityCategories: categories(rows, "sourceEligibility"),
        requiresBoundedSynthesis: ["support", "identityLink", "locationLink", "displaySafety", "recency",
          "fieldValidity", "sourceEligibility", "crossNpiConflict", "requestedNpiResolution"]
          .some((field) => categories(rows, field).length !== 1) };
    }),
    evidence: planner.stableDedupeEvidence(evidence),
    quoteAttributionAudit: {
      schemaVersion: 1,
      policy: "unattributed_excerpt_logged_and_not_credited_categorical_judgment_retained",
      submittedQuoteCount: quoteAudits.reduce((sum, audit) => sum + audit.submittedQuoteCount, 0),
      creditedQuoteCount: quoteAudits.reduce((sum, audit) => sum + audit.creditedQuoteCount, 0),
      rejectedQuoteCount: quoteAudits.reduce((sum, audit) => sum + audit.rejectedQuoteCount, 0),
      issues: quoteAudits.flatMap((audit) => audit.issues.map((issue) => ({
        requestIndex: audit.requestIndex, ...issue
      })))
    },
    invalidNormalizations: plan.invalidNormalizations,
    sourceCoverage: plan.sourceCoverage,
    wholeCaseAxesPendingBoundedSynthesis: [
      "whole-source categorical reconciliation", "claim exactSupport and citedSourceSupport",
      "candidate decisions", "field withholding", "source hierarchy", "recency", "critical findings"
    ],
    hostInventedSemanticCategories: false
  };
};

const assertEvaluatorAdmission = (plannedCells) => {
  const overflow = plannedCells.filter((cell) => cell.plan.contextOverflowCount > 0);
  const invalid = plannedCells.filter((cell) => cell.plan.invalidNormalizations.length > 0);
  if (overflow.length || invalid.length) {
    const error = new Error(`EVALUATOR_ADMISSION_FAILED: context_overflow_cells=${overflow.length}; invalid_normalization_cells=${invalid.length}`);
    error.code = "EVALUATOR_ADMISSION_FAILED";
    error.contextOverflowCells = overflow.map((cell) => `${cell.armId}/${cell.caseId}`);
    error.invalidNormalizationCells = invalid.map((cell) => ({ cell: `${cell.armId}/${cell.caseId}`,
      count: cell.plan.invalidNormalizations.length }));
    throw error;
  }
  return true;
};
const pairedOperationalCensorCaseIds = (plannedCells) => new Set(plannedCells
  .filter((cell) => cell.packet?.evaluationGate?.productionOutcome === "operational_censor_content_filter")
  .map((cell) => cell.caseId));

const main = async () => {
  const inputRoot = process.env.PACKET_ROOT;
  const outputRoot = process.env.OUTPUT_ROOT;
  const tokenizerModules = process.env.TOKENIZER_MODULES;
  const dryRun = process.env.DRY_RUN !== "0";
  const resume = process.env.RESUME === "1";
  const resumeInspectOnly = process.env.RESUME_INSPECT_ONLY === "1";
  if (!inputRoot || !outputRoot || !tokenizerModules) {
    throw new Error("PACKET_ROOT, OUTPUT_ROOT, and TOKENIZER_MODULES are required.");
  }
  if (resume && dryRun) throw new Error("Atomic resume is a live-only stage.");
  if (resumeInspectOnly && !resume) throw new Error("RESUME_INSPECT_ONLY requires RESUME=1.");
  if (resume) assertResumeOutputRoot(outputRoot); else assertFreshOutputRoot(outputRoot);
  const existingLivePlanSeal = resume
    ? readJson(path.join(outputRoot, "CAMPAIGN_PLAN_SEAL.json")) : null;
  const { getEncoding } = require(tokenizerModules);
  const encoding = getEncoding("o200k_base");
  const countTokens = (text) => encoding.encode(text).length;
  const summaries = [];
  const plannedCells = [];
  for (const cell of discoverPackets(inputRoot)) {
    const packet = JSON.parse(fs.readFileSync(cell.file, "utf8"));
    const plan = buildAtomicPlan(packet, { countTokens });
    const dir = path.join(outputRoot, "cells", cell.armId, cell.caseId);
    const persistedPlan = { ...plan, requests: plan.requests.map((item) => ({
      requestIndex: item.requestIndex,
      sourceIds: item.units.map((unit) => unit.sourceId),
      sourceIndices: item.units.map((unit) => unit.sourceIndex),
      coreRanges: item.units.map((unit) => [unit.coreStart, unit.coreEnd]),
      deliveredRanges: item.units.map((unit) => [unit.deliveredStart, unit.deliveredEnd]),
      sourceTextSha256: item.units.map((unit) => unit.sourceTextSha256),
      deliveredTextSha256: item.units.map((unit) => unit.deliveredTextSha256),
      requestTokens: item.requestTokens,
      sectionMetrics: item.sectionMetrics,
      requestSha256: planner.sha256(JSON.stringify(item.request))
    })) };
    if (resume) {
      const planFile = path.join(dir, "atomic-plan.json");
      if (!fs.existsSync(planFile) || JSON.stringify(readJson(planFile)) !== JSON.stringify(persistedPlan)) {
        throw new Error(`Atomic resume cell plan differs from the persisted plan: ${cell.armId}/${cell.caseId}`);
      }
      for (const item of plan.requests) {
        const requestFile = path.join(dir, `request-${item.requestIndex}.json`);
        if (!fs.existsSync(requestFile)
          || planner.sha256(JSON.stringify(readJson(requestFile))) !== planner.sha256(JSON.stringify(item.request))) {
          throw new Error(`Atomic resume request artifact differs from the sealed request: ${cell.armId}/${cell.caseId}/${item.requestIndex}`);
        }
      }
    } else {
      for (const item of plan.requests) writeJson(path.join(dir, `request-${item.requestIndex}.json`), item.request);
      writeJson(path.join(dir, "atomic-plan.json"), persistedPlan);
    }
    plannedCells.push({ ...cell, packet, plan, dir });
    const operationalCensor = packet.evaluationGate?.productionOutcome === "operational_censor_content_filter";
    summaries.push({ armId: cell.armId, caseId: cell.caseId, requestCount: plan.requestCount,
      maximumRequestTokens: plan.maximumRequestTokens, contextOverflowCount: plan.contextOverflowCount,
      uniqueFactTargetCount: plan.uniqueFactTargetCount,
      intendedSourceByUniqueFactComparisonCount: plan.intendedSourceByUniqueFactComparisonCount,
      plannedSourceByUniqueFactComparisonCount: plan.plannedSourceByUniqueFactComparisonCount,
      sourceByUniqueFactComparisonMatrixComplete: plan.sourceByUniqueFactComparisonMatrixComplete,
      invalidNormalizationCount: plan.invalidNormalizations.length,
      operationalCensor,
      manualReviewRequired: plan.manualReviewReasons.length > 0,
      manualReviewReasons: plan.manualReviewReasons });
  }
  const operationalCensorCaseIds = pairedOperationalCensorCaseIds(plannedCells);
  const manifest = resume ? existingLivePlanSeal.runtimeManifest : runtimeManifest({ tokenizerModules });
  const summary = { dryRun, model: "gpt-5.6-sol", reasoning: "high",
    runtimeManifest: manifest,
    cells: summaries.length, totalRequests: summaries.reduce((sum, row) => sum + row.requestCount, 0),
    operationalCensorCaseIds: [...operationalCensorCaseIds].sort(),
    operationalCensorCells: plannedCells.filter((cell) => operationalCensorCaseIds.has(cell.caseId)).length,
    contextOverflowCount: summaries.reduce((sum, row) => sum + row.contextOverflowCount, 0),
    invalidNormalizationCells: summaries.filter((row) => row.invalidNormalizationCount), rows: summaries };
  if (resume) {
    if (JSON.stringify(readJson(path.join(outputRoot, "summary.json"))) !== JSON.stringify(summary)) {
      throw new Error("Atomic resume summary differs from the original admitted campaign summary.");
    }
  } else writeJson(path.join(outputRoot, "summary.json"), summary);
  // Inspect the complete campaign before constructing a client or making the
  // first paid request. A bad late cell cannot yield a partial evaluation.
  assertEvaluatorAdmission(plannedCells);
  const operationalCensorArtifact = {
    schemaVersion: 1,
    status: "PAIRED_OPERATIONAL_CENSOR",
    disposition: "content_filter_exhaustion_not_arm_quality_failure",
    caseIds: [...operationalCensorCaseIds].sort(),
    cells: plannedCells.filter((cell) => operationalCensorCaseIds.has(cell.caseId)).map((cell) => ({
      armId: cell.armId,
      caseId: cell.caseId,
      triggeringCell: cell.packet.evaluationGate?.productionOutcome === "operational_censor_content_filter"
    }))
  };
  if (resume) {
    if (JSON.stringify(readJson(path.join(outputRoot, "operational-censor-cases.json")))
      !== JSON.stringify(operationalCensorArtifact)) throw new Error("Atomic resume operational-censor plan drifted.");
  } else writeJson(path.join(outputRoot, "operational-censor-cases.json"), operationalCensorArtifact);
  const manualCaseIds = new Set(plannedCells.filter((cell) => !operationalCensorCaseIds.has(cell.caseId)
    && cell.plan.manualReviewReasons.length)
    .map((cell) => cell.caseId));
  const staticManualArtifact = {
    schemaVersion: 1,
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
    disposition: "evaluator_sufficiency_exception_not_arm_failure",
    caseIds: [...manualCaseIds].sort(),
    protocol: "same_provider_all_compared_arms_blinded_randomized_identical_categorical_rubric",
    cells: plannedCells.filter((cell) => manualCaseIds.has(cell.caseId)).map((cell) => ({
      armId: cell.armId, caseId: cell.caseId, reasons: cell.plan.manualReviewReasons
    }))
  };
  if (resume) {
    if (JSON.stringify(readJson(path.join(outputRoot, "manual-review-required.json")))
      !== JSON.stringify(staticManualArtifact)) throw new Error("Atomic resume static manual-review plan drifted.");
  } else writeJson(path.join(outputRoot, "manual-review-required.json"), staticManualArtifact);
  const planSeal = makeCampaignPlanSeal("provider_atomic_evaluator", {
    model: "gpt-5.6-sol", reasoning: "high", runtimeManifest: manifest,
    packetRoot: path.resolve(inputRoot),
    cells: plannedCells.map((cell) => ({ armId: cell.armId, caseId: cell.caseId,
      packetSha256: cell.packet.packetSha256 || planner.sha256(JSON.stringify(cell.packet)),
      invalidNormalizations: cell.plan.invalidNormalizations,
      manualReviewReasons: cell.plan.manualReviewReasons,
      requests: cell.plan.requests.map((request) => ({ requestIndex: request.requestIndex,
        requestSha256: planner.sha256(JSON.stringify(request.request)), requestTokens: request.requestTokens,
        assessmentRows: request.assessmentRows, maximumOutputTokens: request.maximumOutputTokens })) })),
    manualCaseIds: [...manualCaseIds].sort(),
    operationalCensorCaseIds: [...operationalCensorCaseIds].sort()
  });
  if (resume) verifyResumePlanSeal({
    expectedDryPlanSealFile: process.env.EXPECTED_DRY_PLAN_SEAL,
    existingLivePlanSeal,
    recomputedPlanSeal: planSeal,
    sourceEvaluatorAuthoritySha256: process.env.SOURCE_EVALUATOR_AUTHORITY_SHA256
  });
  else writeJson(path.join(outputRoot, "CAMPAIGN_PLAN_SEAL.json"), planSeal);
  if (!dryRun) {
    if (!resume) verifyExpectedPlanSeal(process.env.EXPECTED_DRY_PLAN_SEAL, planSeal);
    const eligibleCells = plannedCells.filter((cell) => !manualCaseIds.has(cell.caseId)
      && !operationalCensorCaseIds.has(cell.caseId));
    const tasks = eligibleCells
      .flatMap((cell) => cell.plan.requests.map((plannedRequest) => ({ cell, plannedRequest })));
    let client = null;
    const executeTask = async ({ cell, plannedRequest }) => {
      if (!client) throw new Error("Evaluator provider client was not initialized.");
      const taskStartedAt = new Date().toISOString();
      try {
        return await executeAtomicSemanticAttempts({ client, cell, plannedRequest });
      } catch (error) {
        const rawFile = `transport-error-${plannedRequest.requestIndex}.json`;
        const errorArtifact = { schemaVersion: 1, status: "transport_error_after_native_retries",
          startedAt: taskStartedAt, completedAt: new Date().toISOString(),
          error: serializeTransportError(error) };
        writeJson(path.join(cell.dir, rawFile), errorArtifact);
        const attempts = [{ semanticAttempt: null, rawFile, responseId: null, responseStatus: null,
          insufficiency: { reason: "EVALUATOR_TRANSPORT_FAILURE", providerReason: errorArtifact.error.message },
          usage: null, estimatedCost: null }];
        writeJson(path.join(cell.dir, `result-${plannedRequest.requestIndex}.json`), {
          schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
          disposition: "evaluator_sufficiency_exception_not_arm_failure",
          reason: "EVALUATOR_TRANSPORT_FAILURE", requestIndex: plannedRequest.requestIndex,
          startedAt: taskStartedAt, completedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(taskStartedAt), totalEstimatedUsd: null,
          retryPolicy: { transportOwner: "openai_sdk_native", configuredTransportMaxRetries: 2,
            observedTransportAttemptCount: null }, attempts
        });
        return { status: "manual_review_required", cell, plannedRequest,
          reason: "EVALUATOR_TRANSPORT_FAILURE", attempts };
      }
    };
    if (resume) {
      const expectedRequestsRaw = process.env.EXPECTED_ATOMIC_REQUESTS || "";
      const expectedMergedCellsRaw = process.env.EXPECTED_ATOMIC_MERGED_CELLS || "";
      if (!/^\d+$/.test(expectedRequestsRaw) || !/^\d+$/.test(expectedMergedCellsRaw)) {
        throw new Error("Atomic resume requires exact integer EXPECTED_ATOMIC_REQUESTS and EXPECTED_ATOMIC_MERGED_CELLS.");
      }
      const expectedRequests = Number(expectedRequestsRaw);
      const expectedMergedCells = Number(expectedMergedCellsRaw);
      if (tasks.length !== expectedRequests || eligibleCells.length !== expectedMergedCells) {
        throw new Error(`Atomic resume cardinality differs from expectation: requests=${tasks.length}/${expectedRequests}, mergedCells=${eligibleCells.length}/${expectedMergedCells}.`);
      }
      const inspections = tasks.map((task) => ({ task,
        inspection: inspectAtomicResumeItem(task, { readOnly: resumeInspectOnly }) }));
      const completedBefore = inspections.filter((row) => row.inspection.disposition === "completed");
      const retryRows = inspections.filter((row) => row.inspection.disposition === "retry");
      const manualBefore = inspections.filter((row) => row.inspection.disposition === "manual");
      if (resumeInspectOnly) {
        const currentMergedCells = eligibleCells.filter((cell) =>
          fs.existsSync(path.join(cell.dir, "atomic-merged.json"))).length;
        process.stdout.write(`${JSON.stringify({
          schemaVersion: 1,
          status: "ATOMIC_RESUME_READ_ONLY_INVENTORY",
          sourceCampaignPlanSealSha256: existingLivePlanSeal.sealSha256,
          sourceEvaluatorAuthoritySha256: existingLivePlanSeal.runtimeManifest.runnerAuthority.authoritySha256,
          plannedRequests: tasks.length,
          completed: completedBefore.length,
          recoveredSuccessfulOrphans: completedBefore.filter((row) =>
            row.inspection.recoveredWithoutPaidCall).length,
          retryable: retryRows.length,
          retryableTransport: retryRows.filter((row) =>
            row.inspection.reason === "EVALUATOR_TRANSPORT_FAILURE").length,
          retryableResponseArtifactLoss: retryRows.filter((row) =>
            row.inspection.reason === "EVALUATOR_RESPONSE_ARTIFACT_LOSS").length,
          retryableMissing: retryRows.filter((row) =>
            row.inspection.reason === "MISSING_PLANNED_RESULT").length,
          manualNonretryable: manualBefore.length,
          currentMergedCells,
          expectedMergedCells,
          inspectOnly: true,
          providerClientConstructed: false,
          filesystemMutations: 0
        }, null, 2)}\n`);
        return;
      }
      if (manualBefore.length) {
        throw new Error(`Atomic resume found ${manualBefore.length} non-transport provider responses that cannot be safely rerun.`);
      }
      const completionSealFile = path.join(outputRoot, "RESUME_COMPLETION_SEAL.json");
      if (fs.existsSync(completionSealFile)) {
        const completion = readJson(completionSealFile);
        validateCampaignPlanSeal(completion, "Atomic resume completion seal");
        if (retryRows.length || completion.completedRequestCount !== expectedRequests
          || completion.mergedCellCount !== expectedMergedCells
          || completion.sourceCampaignPlanSealSha256 !== existingLivePlanSeal.sealSha256) {
          throw new Error("Existing atomic resume completion seal disagrees with current artifacts.");
        }
        return;
      }
      const artifactLossRetryRows = retryRows.filter((row) =>
        row.inspection.reason === "EVALUATOR_RESPONSE_ARTIFACT_LOSS");
      const diskHeadroom = artifactLossRetryRows.length ? assertDiskHeadroom(outputRoot) : null;
      const preserved = retryRows.map((row) => ({
        armId: row.task.cell.armId, caseId: row.task.cell.caseId,
        requestIndex: row.task.plannedRequest.requestIndex, reason: row.inspection.reason,
        priorResult: preservePreResumeResult(row.inspection)
      }));
      const preservedByRequest = new Map(preserved.map((item) =>
        [`${item.armId}\u0000${item.caseId}\u0000${item.requestIndex}`, item]));
      const recoveryJournals = new Map(artifactLossRetryRows.map((row) => {
        const key = `${row.task.cell.armId}\u0000${row.task.cell.caseId}\u0000${row.task.plannedRequest.requestIndex}`;
        return [key, prepareArtifactLossRecovery({ row,
          priorResult: preservedByRequest.get(key)?.priorResult, diskHeadroom })];
      }));
      const OpenAI = require(path.join(process.env.PROVIDER_EVAL_NODE_MODULES, "openai")).default;
      client = new OpenAI({ apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: process.env.AZURE_OPENAI_BASE_URL, maxRetries: 2, timeout: 15 * 60 * 1000 });
      if (retryRows.length) await runPool(retryRows, 10, async (row) => {
        const outcome = await executeTask(row.task);
        const key = `${row.task.cell.armId}\u0000${row.task.cell.caseId}\u0000${row.task.plannedRequest.requestIndex}`;
        if (recoveryJournals.has(key)) attachArtifactLossRecoveryLineage({ row,
          recoveryJournal: recoveryJournals.get(key) });
        return outcome;
      });
      const finalInspections = tasks.map((task) => ({ task, inspection: inspectAtomicResumeItem(task) }));
      const incomplete = finalInspections.filter((row) => row.inspection.disposition !== "completed");
      if (incomplete.length) {
        const runtimeCaseIds = new Set(incomplete.map((row) => row.task.cell.caseId));
        writeJson(path.join(outputRoot, "manual-review-required-runtime.json"), {
          schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
          disposition: "evaluator_sufficiency_exception_not_arm_failure_paired_all_arms",
          caseIds: [...runtimeCaseIds].sort(),
          cells: plannedCells.filter((cell) => runtimeCaseIds.has(cell.caseId)).map((cell) => ({
            armId: cell.armId, caseId: cell.caseId,
            reasons: incomplete.filter((row) => row.task.cell.caseId === cell.caseId).map((row) => ({
              reason: row.inspection.reason, triggeringArmId: row.task.cell.armId,
              requestIndex: row.task.plannedRequest.requestIndex }))
          }))
        });
        throw new Error(`Atomic resume remains incomplete for ${incomplete.length} planned requests.`);
      }
      const runtimeManualFile = path.join(outputRoot, "manual-review-required-runtime.json");
      if (fs.existsSync(runtimeManualFile)) {
        const digest = fileSha256(runtimeManualFile);
        const archived = path.join(outputRoot, `manual-review-required-runtime.pre-resume-${digest.slice(0, 12)}.json`);
        if (!fs.existsSync(archived)) fs.renameSync(runtimeManualFile, archived);
        else if (fileSha256(archived) === digest) fs.unlinkSync(runtimeManualFile);
        else throw new Error("Runtime manual-review archive hash mismatch.");
      }
      for (const cell of eligibleCells) {
        const outputs = finalInspections.filter((row) => row.task.cell === cell)
          .map((row) => row.inspection.output)
          .sort((left, right) => left.plannedRequest.requestIndex - right.plannedRequest.requestIndex);
        const merged = mergeAtomicOutputs(cell.packet, cell.plan, outputs);
        const mergedFile = path.join(cell.dir, "atomic-merged.json");
        if (fs.existsSync(mergedFile)) {
          if (JSON.stringify(readJson(mergedFile)) !== JSON.stringify(merged)) {
            throw new Error(`Persisted atomic merge differs from validated request artifacts: ${cell.armId}/${cell.caseId}`);
          }
        } else writeJsonExclusive(mergedFile, merged);
      }
      const mergedFiles = eligibleCells.filter((cell) => fs.existsSync(path.join(cell.dir, "atomic-merged.json")));
      if (finalInspections.length !== expectedRequests || mergedFiles.length !== expectedMergedCells) {
        throw new Error("Atomic resume final campaign cardinality validation failed.");
      }
      const resultArtifacts = finalInspections.map((row) => {
        const file = row.inspection.resultFile;
        return { armId: row.task.cell.armId, caseId: row.task.cell.caseId,
          requestIndex: row.task.plannedRequest.requestIndex, resultSha256: fileSha256(file) };
      });
      const completionSeal = makeCampaignPlanSeal("provider_atomic_resume_completion", {
        sourceCampaignPlanSealSha256: existingLivePlanSeal.sealSha256,
        sourceEvaluatorAuthority: existingLivePlanSeal.runtimeManifest.runnerAuthority,
        resumeEvaluatorAuthority: evaluatorRunnerAuthority(__dirname),
        expectedRequestCount: expectedRequests,
        completedRequestCount: finalInspections.length,
        preservedCompletedRequestCount: completedBefore.length,
        retriedRequestCount: retryRows.length,
        responseArtifactLossRecoveryCount: artifactLossRetryRows.length,
        responseArtifactLossOriginalUnknownCostAttemptCount: artifactLossRetryRows.length,
        artifactLossRecoveryDiskHeadroom: diskHeadroom,
        recoveredWithoutPaidCallCount: completedBefore.filter((row) => row.inspection.recoveredWithoutPaidCall).length,
        expectedMergedCellCount: expectedMergedCells,
        mergedCellCount: mergedFiles.length,
        preserved,
        resultArtifacts
      });
      writeJsonExclusive(completionSealFile, completionSeal);
      return;
    }
    const OpenAI = require(path.join(process.env.PROVIDER_EVAL_NODE_MODULES, "openai")).default;
    client = new OpenAI({ apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: process.env.AZURE_OPENAI_BASE_URL, maxRetries: 2, timeout: 15 * 60 * 1000 });
    const outcomes = await runPool(tasks, 10, executeTask);
    const runtimeManual = outcomes.filter((item) => item.status === "manual_review_required");
    const runtimeManualCaseIds = new Set(runtimeManual.map((item) => item.cell.caseId));
    if (runtimeManualCaseIds.size) writeJson(path.join(outputRoot, "manual-review-required-runtime.json"), {
      schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
      disposition: "evaluator_sufficiency_exception_not_arm_failure_paired_all_arms",
      caseIds: [...runtimeManualCaseIds].sort(),
      cells: plannedCells.filter((cell) => runtimeManualCaseIds.has(cell.caseId)).map((cell) => ({
        armId: cell.armId, caseId: cell.caseId,
        reasons: runtimeManual.filter((item) => item.cell.caseId === cell.caseId)
          .map((item) => ({ reason: item.reason, triggeringArmId: item.cell.armId,
            requestIndex: item.plannedRequest.requestIndex }))
      }))
    });
    for (const cell of plannedCells.filter((item) => !manualCaseIds.has(item.caseId)
      && !operationalCensorCaseIds.has(item.caseId)
      && !runtimeManualCaseIds.has(item.caseId))) {
      const outputs = outcomes.filter((item) => item.status === "completed" && item.cell === cell)
        .sort((left, right) => left.plannedRequest.requestIndex - right.plannedRequest.requestIndex);
      writeJson(path.join(cell.dir, "atomic-merged.json"), mergeAtomicOutputs(cell.packet, cell.plan, outputs));
    }
  }
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { ATOMIC_SCHEMA, buildAtomicPlan, mergeAtomicOutputs, parseOutputText,
  ARTIFACT_LOSS_MINIMUM_FREE_BYTES, artifactLossRecoveryJournalFile, assertDiskHeadroom,
  attachArtifactLossRecoveryLineage, prepareArtifactLossRecovery,
  assertFreshOutputRoot, assertResumeOutputRoot, auditAtomicEvidenceQuotes,
  classifyEvaluatorInsufficiency, completedOutputFromArtifacts, discoverPackets,
  executeAtomicSemanticAttempts,
  inspectAtomicResumeItem, makeCampaignPlanSeal, preservePreResumeResult, semanticRawArtifactInventory,
  validateCampaignPlanSeal, verifyExpectedPlanSeal, verifyResumePlanSeal, validateAtomicOutput,
  assertAtomicCompletion, assertEvaluatorAdmission, estimateCost,
  pairedOperationalCensorCaseIds, quoteOccurrences, RATE_CARD, runPool, runtimeManifest };

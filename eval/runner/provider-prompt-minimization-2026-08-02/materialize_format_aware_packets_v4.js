#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { canonicalExactSourceUrl } = require("../provider-d-series-2026-07-31/generated/public_url_canonicalizer.js");
const { evaluatorRunnerAuthority, sameEvaluatorAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const FIXED_EVALUATION_POLICY = Object.freeze({
  schemaVersion: 1,
  outOfScopeFields: ["rating", "insurance", "plan_network"],
  ratingPolicy: "schema_compatibility_row_only_never_penalize_omission",
  planNetworkPolicy: "not_sent_to_provider_ai_and_never_judged_as_provider_ai_output",
  schemaCompatibilityDisposition: "not_applicable_no_quality_inference"
});
const canonicalUrl = (value) => {
  const canonical = canonicalExactSourceUrl(value);
  if (!canonical) throw new Error(`Invalid public evidence URL: ${value}`);
  return canonical;
};
const literalUrl = (value) => {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.toString();
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
};
const writeBufferExclusive = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { flag: "wx", mode: 0o600 });
};
const verifyDescriptor = (root, descriptor, label) => {
  if (descriptor?.complete !== true) throw new Error(`${label} is not declared complete.`);
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, descriptor?.path || "");
  if (!file.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(file)) {
    throw new Error(`${label} is missing or escapes evidence root.`);
  }
  const body = fs.readFileSync(file);
  if (body.length !== descriptor.byteLength || sha256(body) !== descriptor.sha256) {
    throw new Error(`${label} descriptor hash/length mismatch.`);
  }
  return { file, body };
};
const fieldType = (field) => typeof field === "string" ? field : field?.fieldType;
const canonicalUrlSet = (values) => [...new Set((values || []).filter(Boolean).map(canonicalUrl))].sort();
const profileFacts = (profiles) => (profiles || []).flatMap((profile) => [
  ...(profile.specialties || []), ...(profile.locations || []), ...(profile.phoneNumbers || []),
  ...(profile.websites || [])
]);
const productionSourceUrls = (artifact) => canonicalUrlSet([
  ...(artifact.trace?.actionSourceUrls || []), ...(artifact.trace?.openedUrls || []),
  ...(artifact.trace?.citationUrls || []), ...(artifact.trace?.provenanceUrls || []),
  ...profileFacts(artifact.finalProfiles).map((fact) => fact.citation?.sourceUrl),
  ...profileFacts(artifact.finalProfiles).map((fact) =>
    typeof fact.value === "string" && /^https?:\/\//i.test(fact.value) ? fact.value : null)
]);

const sourceIdForUrl = (evidence) => new Map((evidence.sources || []).flatMap((source) => [
  [canonicalUrl(source.requestedUrl), source.sourceId],
  [canonicalUrl(source.canonicalUrl || source.requestedUrl), source.sourceId]
]));
const titleForUrl = (artifact, url) => profileFacts(artifact.finalProfiles)
  .find((fact) => fact.citation?.sourceUrl && canonicalUrl(fact.citation.sourceUrl) === url)
  ?.citation?.sourceTitle || null;
const claimsForProfiles = (profiles, sourceIds) => {
  const claims = [];
  for (const [profileIndex, profile] of (profiles || []).entries()) {
    for (const [field, values] of [["specialty", profile.specialties || []],
      ["address", profile.locations || []], ["phone", profile.phoneNumbers || []],
      ["website", profile.websites || []]]) {
      for (const [index, item] of values.entries()) {
        const citationUrl = item.citation?.sourceUrl ? canonicalUrl(item.citation.sourceUrl) : null;
        claims.push({
          claimId: `claim:p${profileIndex}:${field}:${index}`,
          fieldType: field,
          value: field === "address" ? {
            addressLine1: item.addressLine1,
            addressLine2: item.addressLine2 ?? null,
            city: item.city ?? null,
            state: item.state ?? null,
            zip: item.zip ?? null
          } : item.value,
          sourceId: citationUrl ? sourceIds.get(citationUrl) || null : null,
          citationUrl,
          citationTitle: item.citation?.sourceTitle || null,
          modelCitation: {
            sourceUrl: citationUrl,
            sourceTitle: item.citation?.sourceTitle || null,
            providerIdentitySpan: item.citation?.providerIdentitySpan || null,
            factSpan: item.citation?.factSpan || null,
            explicitFactDateSpanRaw: item.citation?.explicitFactDateSpan ?? null,
            explicitFactDateSpan: item.citation?.explicitFactDateSpan ?? null
          },
          hostNativeCitationProvenance: citationUrl && sourceIds.has(citationUrl) ? "confirmed" : "unconfirmed"
        });
      }
    }
  }
  return claims;
};
const expectedFieldsForClaims = (claims) => ["phone", "address", "website", "rating", "specialty"]
  .map((field) => {
    const top = claims.find((claim) => claim.fieldType === field);
    return { fieldType: field, outputState: top ? "emitted" : "missing", topClaimId: top?.claimId || null };
  });
const candidatesForProfiles = (rawProfiles, finalClaims, sourceIds) => {
  const rawClaims = claimsForProfiles(rawProfiles, sourceIds);
  const finalCounts = new Map();
  const matchKey = (item) => stableJson([item.fieldType, item.value, item.citationUrl]);
  for (const claim of finalClaims) finalCounts.set(matchKey(claim), (finalCounts.get(matchKey(claim)) || 0) + 1);
  return rawClaims.map((claim, index) => {
    const key = matchKey(claim);
    const kept = (finalCounts.get(key) || 0) > 0;
    if (kept) finalCounts.set(key, finalCounts.get(key) - 1);
    return {
      candidateFactId: `candidate:${index}`,
      fieldType: claim.fieldType,
      value: claim.value,
      sourceId: claim.sourceId,
      citationUrl: claim.citationUrl,
      citationTitle: claim.citationTitle,
      modelCitation: claim.modelCitation,
      hostNativeCitationProvenance: claim.hostNativeCitationProvenance,
      sanitizerActionObserved: kept ? "kept" : "stack_withheld",
      sanitizerReasonCode: null
    };
  });
};

const makeProductionPacket = ({ artifact, evidence }) => {
  if (artifact.error) throw new Error("A generated ordinary packet requires a completed production outcome.");
  const provider = artifact.input?.providers?.[0];
  if (!provider) throw new Error("Generated production packet lacks input.providers[0].");
  const sourceIds = sourceIdForUrl(evidence);
  const claims = claimsForProfiles(artifact.finalProfiles, sourceIds);
  const candidates = candidatesForProfiles(artifact.parserProfiles || artifact.finalProfiles, claims, sourceIds);
  const sourceIdsFor = (urls) => canonicalUrlSet(urls).map((url) => sourceIds.get(url)).filter(Boolean);
  const calls = [];
  for (const item of artifact.trace?.output || []) {
    if (item.type !== "web_search_call" || !item.action) continue;
    const action = item.action;
    calls.push({
      type: action.type || "unknown",
      query: action.query || null,
      url: action.url || null,
      sourceIds: sourceIdsFor((action.sources || []).map((source) => source.url).filter(Boolean))
    });
  }
  const sources = (evidence.sources || []).map((source) => {
    const url = literalUrl(source.requestedUrl);
    const normalizedUrl = canonicalUrl(source.canonicalUrl || source.requestedUrl);
    return {
      sourceId: source.sourceId,
      origin: "arm_production_trace",
      url,
      literalUrl: source.requestedUrl,
      canonicalUrl: normalizedUrl,
      titles: [titleForUrl(artifact, normalizedUrl)].filter(Boolean),
      deliveredContent: "",
      hostReadStatus: "unmaterialized",
      snapshotCoverage: "unmaterialized"
    };
  });
  return {
    schemaVersion: 1,
    protocol: "provider-prompt-minimization-sol-high-v14-generated-format-aware-v4",
    caseId: artifact.caseId,
    blindedCandidateId: `candidate_${sha256(`${artifact.armId}:${artifact.caseId}:format-aware-v4`).slice(0, 12)}`,
    identityContext: {
      request: provider,
      cmsBaseline: artifact.cmsBaseline || null,
      nppesIdentity: { npi: String(provider.npi || provider.providerId || ""),
        entityType: artifact.strata?.entityType || null },
      rule: "Use fixed context for identity and taxonomy only; it is not current contact truth."
    },
    evaluationGate: null,
    evaluationGuidance: null,
    finalSanitizedProfiles: artifact.finalProfiles || [],
    rawStructuredProfiles: artifact.parserProfiles || [],
    claims,
    preSanitizerCandidates: candidates,
    expectedFields: expectedFieldsForClaims(claims),
    actionTrace: { calls, annotations: [],
      actionSourceCount: artifact.trace?.actionSourceUrls?.length || 0,
      openedSourceCount: artifact.trace?.openedUrls?.length || 0,
      citationSourceCount: artifact.trace?.citationUrls?.length || 0,
      provenanceSourceCount: artifact.trace?.provenanceUrls?.length || 0 },
    sources,
    armOwnedSourceCount: sources.length,
    sourceCoverage: { policy: "generated_from_exact_production_trace_before_v4_materialization" },
    productionArtifacts: { armCommit: artifact.armCommit || null }
  };
};

const makeOperationalCensorPacket = ({ artifact, evidence }) => {
  if (classifyEmptyProductionOutcome(artifact) !== "content_filter_no_call") {
    throw new Error("Operational censor packet requires exhausted production content filtering.");
  }
  const packet = makeProductionPacket({ artifact: { ...artifact, error: null,
    finalProfiles: [], parserProfiles: [] }, evidence });
  packet.evaluationGate = {
    productionOutcome: "operational_censor_content_filter",
    traceClassification: "content_filter_no_call",
    productionError: String(artifact.error || "").slice(0, 1200),
    qualityDisposition: "paired_operational_censor_not_arm_failure"
  };
  return packet;
};
const assertFrozenProductionBinding = (packet, artifact) => {
  const provider = artifact.input?.providers?.[0];
  if (!provider) throw new Error("Production artifact lacks input.providers[0].");
  const request = packet.identityContext?.request;
  if (stableJson(request) !== stableJson(provider)) throw new Error("Frozen request differs from production input.providers[0].");
  if (stableJson(packet.identityContext?.cmsBaseline || null) !== stableJson(artifact.cmsBaseline || null)) {
    throw new Error("Frozen CMS baseline differs from production artifact.");
  }
  if (stableJson(packet.finalSanitizedProfiles || []) !== stableJson(artifact.finalProfiles || [])) {
    throw new Error("Frozen sanitized profiles differ from production artifact.");
  }
  if (stableJson(packet.rawStructuredProfiles || []) !== stableJson(artifact.parserProfiles || [])) {
    throw new Error("Frozen parser profiles differ from production artifact.");
  }
  const packetUrls = canonicalUrlSet((packet.sources || [])
    .filter((source) => source.origin !== "common_identity_context"
      && source.sourceId !== "__fixed_cms_nppes_identity_context")
    .map((source) => source.url));
  if (stableJson(packetUrls) !== stableJson(productionSourceUrls(artifact))) {
    throw new Error("Frozen action/source URL set differs from production trace.");
  }
  return true;
};
const assertPacketIntegrity = (packet) => {
  const sources = packet.sources || [];
  const sourceIds = sources.map((source) => source.sourceId);
  const urls = sources.filter((source) => source.url).map((source) => canonicalUrl(source.url));
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Packet contains duplicate source IDs.");
  if (new Set(urls).size !== urls.length) throw new Error("Packet contains duplicate canonical source URLs.");
  const allowed = new Set(sourceIds);
  const check = (sourceId, label) => {
    if (sourceId != null && !allowed.has(sourceId)) throw new Error(`${label} references an unknown sourceId.`);
  };
  for (const [index, claim] of (packet.claims || []).entries()) check(claim.sourceId, `claim ${index}`);
  for (const [index, candidate] of (packet.preSanitizerCandidates || []).entries()) {
    check(candidate.sourceId, `candidate ${index}`);
  }
  for (const [index, call] of (packet.actionTrace?.calls || []).entries()) {
    for (const sourceId of call.sourceIds || []) check(sourceId, `action call ${index}`);
  }
  for (const [index, annotation] of (packet.actionTrace?.annotations || []).entries()) {
    check(annotation.sourceId, `annotation ${index}`);
  }
  const fields = (packet.expectedFields || []).map(fieldType);
  if (fields.some((field) => typeof field !== "string" || !field)) throw new Error("Packet contains an invalid expected field.");
  if (new Set(fields).size !== fields.length) throw new Error("Packet contains duplicate expected fields.");
  return true;
};

const fixedPacketFacts = (packet) => ({
  caseId: packet.caseId,
  identityContext: packet.identityContext,
  evaluationGate: packet.evaluationGate || null,
  evaluationGuidance: packet.evaluationGuidance || null,
  finalSanitizedProfiles: packet.finalSanitizedProfiles || [],
  rawStructuredProfiles: packet.rawStructuredProfiles || [],
  claims: packet.claims || [],
  preSanitizerCandidates: packet.preSanitizerCandidates || [],
  expectedFields: packet.expectedFields || [],
  actionTrace: packet.actionTrace || null,
  evaluationPolicy: packet.evaluationPolicy || FIXED_EVALUATION_POLICY
});

const classifyEmptyProductionOutcome = (artifact) => {
  const responses = artifact.rawResponses || [];
  const contentFiltered = responses.some((response) => response.status === "incomplete"
    && /content_filter/i.test(String(response.incomplete_details?.reason || response.error?.code || "")));
  if (contentFiltered) return "content_filter_no_call";
  const completedOutputText = responses.some((response) => response.status === "completed"
    && (response.output || []).some((item) => item.type === "message"
      && (item.content || []).some((content) => content.type === "output_text" && content.text)));
  if (completedOutputText) return "parser_or_contract_failure";
  return "unclassified_production_failure";
};

const makeEmptyProductionPacket = ({ artifact, evidence }) => {
  if (!artifact.error || (artifact.finalProfiles || []).length || (artifact.parserProfiles || []).length) {
    throw new Error("Only a parser/contract failure with no parsed or final profile may become an empty packet.");
  }
  const provider = artifact.input?.providers?.[0];
  if (!provider) throw new Error("Empty production outcome lacks input.providers[0].");
  const outcomeClass = classifyEmptyProductionOutcome(artifact);
  if (outcomeClass !== "parser_or_contract_failure") {
    throw new Error(`Empty packet requires trace-proven parser/contract failure; observed ${outcomeClass}.`);
  }
  const sourceIdByUrl = new Map((evidence.sources || []).map((source) => [
    canonicalUrl(source.canonicalUrl || source.requestedUrl), source.sourceId
  ]));
  const sourceIdsFor = (urls) => canonicalUrlSet(urls).map((url) => {
    const sourceId = sourceIdByUrl.get(url);
    if (!sourceId) throw new Error(`Production trace URL is absent from V4 evidence: ${url}`);
    return sourceId;
  });
  const calls = [];
  for (const item of artifact.trace?.output || []) {
    if (item.type !== "web_search_call" || !item.action) continue;
    const action = item.action;
    const urls = (action.sources || []).map((source) => source.url).filter(Boolean);
    calls.push({ type: action.type || "unknown", query: action.query || null, url: action.url || null,
      sourceIds: sourceIdsFor(urls) });
  }
  return {
    schemaVersion: 1,
    caseId: artifact.caseId,
    identityContext: {
      request: provider,
      cmsBaseline: artifact.cmsBaseline || null,
      nppesIdentity: { npi: String(provider.npi || provider.providerId || ""),
        entityType: artifact.strata?.entityType || null },
      rule: "Use fixed context for identity and taxonomy only; it is not current contact truth."
    },
    evaluationGate: { productionOutcome: "empty_profile_after_parser_or_contract_failure",
      traceClassification: outcomeClass,
      productionError: String(artifact.error).slice(0, 1200) },
    evaluationGuidance: null,
    finalSanitizedProfiles: [],
    rawStructuredProfiles: [],
    claims: [],
    preSanitizerCandidates: [],
    expectedFields: ["phone", "address", "website", "rating", "specialty"],
    actionTrace: { calls, annotations: [],
      actionSourceCount: (artifact.trace?.actionSourceUrls || []).length,
      openedSourceCount: (artifact.trace?.openedUrls || []).length,
      citationSourceCount: (artifact.trace?.citationUrls || []).length,
      provenanceSourceCount: (artifact.trace?.provenanceUrls || []).length },
    sources: (evidence.sources || []).map((source) => ({
      sourceId: source.sourceId,
      url: source.requestedUrl,
      canonicalUrl: source.canonicalUrl || canonicalUrl(source.requestedUrl),
      origin: "arm_production_trace"
    }))
  };
};

const materializePacket = ({ packet, productionArtifact, evidence, evidenceRoot, packetArtifactRoot = null }) => {
  assertPacketIntegrity(packet);
  assertFrozenProductionBinding(packet, productionArtifact);
  if (packet.caseId !== productionArtifact.caseId || packet.caseId !== evidence.caseId) {
    throw new Error("Case binding mismatch across frozen packet, production artifact, and V4 evidence.");
  }
  if (evidence.armId && productionArtifact.armId && evidence.armId !== productionArtifact.armId) {
    throw new Error("Arm binding mismatch between production artifact and V4 evidence.");
  }
  const packetNpi = String(packet.identityContext?.request?.npi || packet.identityContext?.request?.providerId || "");
  const artifactProvider = productionArtifact.input?.providers?.[0] || {};
  const artifactNpi = String(artifactProvider.npi || artifactProvider.providerId || "");
  if (packetNpi && artifactNpi && packetNpi !== artifactNpi) throw new Error("Frozen production NPI binding mismatch.");
  const byCanonical = new Map();
  for (const source of evidence.sources || []) {
    const key = canonicalUrl(source.canonicalUrl || source.requestedUrl);
    if (byCanonical.has(key)) throw new Error(`Duplicate V4 source canonical URL: ${key}`);
    byCanonical.set(key, source);
  }
  const matched = new Set();
  const sourceMapping = [];
  const sources = (packet.sources || []).map((oldSource) => {
    if (oldSource.origin === "common_identity_context" || oldSource.sourceId === "__fixed_cms_nppes_identity_context") {
      return oldSource;
    }
    const key = canonicalUrl(oldSource.canonicalUrl || oldSource.url);
    const fetched = byCanonical.get(key);
    if (!fetched) throw new Error(`Frozen packet source has no exact V4 source: ${oldSource.url}`);
    matched.add(key);
    if (fetched.outcome === "normalization_error") throw new Error(`Invalid V4 normalization reached packet adapter: ${oldSource.url}`);
    let text = "";
    if (fetched.normalizedTextArtifact) {
      text = verifyDescriptor(evidenceRoot, fetched.normalizedTextArtifact,
        `normalized evidence ${oldSource.sourceId}`).body.toString("utf8");
    }
    const rawEvidence = fetched.rawBodyArtifact ? verifyDescriptor(evidenceRoot, fetched.rawBodyArtifact,
      `raw evidence ${oldSource.sourceId}`) : null;
    const semantic = fetched.semanticExtraction || {};
    const manualReviewSignals = semantic.manualReviewSignals || [];
    const manualReviewArtifacts = [];
    if (manualReviewSignals.includes("OVERSIZED_JSON_LD_REQUIRES_MANUAL_REVIEW")) {
      if (!rawEvidence || !packetArtifactRoot) {
        throw new Error(`Oversized JSON-LD requires a bridged raw-body artifact: ${oldSource.url}`);
      }
      if (semantic.sourceBodySha256 && semantic.sourceBodySha256 !== sha256(rawEvidence.body)) {
        throw new Error(`Oversized JSON-LD raw-body hash differs from normalizer audit: ${oldSource.url}`);
      }
      const relative = path.join("manual-source-artifacts", `${sha256(oldSource.sourceId)}.body`);
      const artifactFile = path.join(packetArtifactRoot, relative);
      writeBufferExclusive(artifactFile, rawEvidence.body);
      manualReviewArtifacts.push({
        kind: "complete_raw_source_body_containing_omitted_json_ld",
        path: relative,
        sha256: sha256(rawEvidence.body),
        byteLength: rawEvidence.body.length,
        complete: true,
        omittedJsonLd: semantic.oversizedJsonLd || [],
        totalJsonLdChars: semantic.totalJsonLdChars ?? null,
        maximumAggregateJsonLdChars: semantic.maximumAggregateJsonLdChars ?? null
      });
    }
    const readable = fetched.outcome === "read" && fetched.httpStatus >= 200 && fetched.httpStatus < 300
      && typeof text === "string" && text.length > 0;
    const emptyReadableResponse = fetched.outcome === "read" && !fetched.normalizedTextArtifact
      && semantic.evidenceTextChars === 0;
    const unavailable = ["binary_unavailable", "fetch_error", "http_error", "oversize_unreadable"].includes(fetched.outcome)
      || emptyReadableResponse;
    if (!readable && !unavailable) throw new Error(`Unrecognized V4 source disposition ${fetched.outcome}: ${oldSource.url}`);
    sourceMapping.push({
      oldSourceId: oldSource.sourceId,
      v4SourceId: fetched.sourceId,
      canonicalUrl: key,
      oldNormalizedTextSha256: oldSource.fullTextSha256 || null,
      v4NormalizedTextSha256: fetched.normalizedTextArtifact?.sha256 || null,
      v4RawBodySha256: fetched.rawBodyArtifact?.sha256 || null
    });
    return {
      ...oldSource,
      finalUrl: fetched.finalUrl || null,
      hostReadStatus: readable ? "read" : "unavailable",
      httpStatus: fetched.httpStatus,
      snapshotCoverage: readable ? "full_normalized_snapshot" : "metadata_only_unavailable",
      originalChars: text.length,
      deliveredChars: text.length,
      deliveredFraction: readable ? 1 : 0,
      deliveryMode: readable ? "full_normalized_text" : "metadata_only_unavailable",
      intervals: readable ? [{ start: 0, end: text.length, reasons: ["full_format_aware_v4"] }] : [],
      omittedRanges: [],
      silentlyTruncated: false,
      deliveredContent: readable
        ? `[CHAR_RANGE 0:${text.length}; complete_format_aware_v4]\n${text}` : "",
      fullTextSha256: readable ? sha256(text) : null,
      contentType: fetched.headers?.contentType || null,
      extractionMode: semantic.extractionMode || null,
      normalizationFormat: semantic.normalizationFormat || null,
      normalization: semantic,
      manualReviewArtifacts,
      bodySha256: fetched.rawBodyArtifact?.sha256 || null,
      hostFetch: fetched,
      v4SourceBinding: {
        requestedUrl: fetched.requestedUrl,
        canonicalUrl: fetched.canonicalUrl,
        sourceId: fetched.sourceId,
        outcome: fetched.outcome,
        normalizerModuleSha256: fetched.phase2Evaluator?.normalizerModuleSha256 || null
      }
    };
  });
  if (matched.size !== byCanonical.size) {
    const unmatched = [...byCanonical.keys()].filter((key) => !matched.has(key));
    throw new Error(`V4 evidence contains ${unmatched.length} source(s) absent from frozen packet.`);
  }
  const policyBoundPacket = { ...packet, evaluationPolicy: packet.evaluationPolicy || FIXED_EVALUATION_POLICY };
  const factsBefore = sha256(stableJson(fixedPacketFacts(policyBoundPacket)));
  const result = {
    ...policyBoundPacket,
    sources,
    sourceCoverage: {
      ...(packet.sourceCoverage || {}),
      policy: "arm_specific_no_union_format_aware_v4",
      sourceCount: sources.length,
      completeReadableCount: sources.filter((source) => source.snapshotCoverage === "full_normalized_snapshot").length,
      metadataOnlyCount: sources.filter((source) => source.snapshotCoverage === "metadata_only_unavailable").length,
      invalidNormalizationCount: 0
    },
    packetV4Bindings: {
      schemaVersion: 1,
      fixedFactsSha256: factsBefore,
      productionArtifactSha256: sha256(stableJson(productionArtifact)),
      v4EvidenceSha256: sha256(stableJson(evidence)),
      sourceCardinality: sources.length,
      sourceIdsPreserved: stableJson(sources.map((source) => source.sourceId))
        === stableJson((packet.sources || []).map((source) => source.sourceId)),
      sourcePolicy: "exact_canonical_url_no_union",
      sourceMapping,
      sourceMappingSha256: sha256(stableJson(sourceMapping)),
      sourceMappingOneToOne: new Set(sourceMapping.map((row) => row.oldSourceId)).size === sourceMapping.length
        && new Set(sourceMapping.map((row) => row.v4SourceId)).size === sourceMapping.length,
      zeroInvalidNormalizations: true
    }
  };
  if (!result.packetV4Bindings.sourceIdsPreserved || !result.packetV4Bindings.sourceMappingOneToOne
    || sha256(stableJson(fixedPacketFacts(result))) !== factsBefore) {
    throw new Error("Packet adapter changed frozen facts or source positional identity.");
  }
  delete result.packetSha256;
  result.packetSha256 = sha256(stableJson(result));
  assertPacketIntegrity(result);
  return result;
};

const assertEvidenceReadiness = (evidenceRoot) => {
  const readinessFile = path.join(evidenceRoot, "NORMALIZATION_READY.json");
  const summaryFile = path.join(evidenceRoot, "summary.json");
  if (!fs.existsSync(readinessFile) || !fs.existsSync(summaryFile)) {
    throw new Error("V4 evidence lacks zero-invalid normalization readiness artifacts.");
  }
  const readiness = readJson(readinessFile);
  const summary = readJson(summaryFile);
  if (readiness.status !== "zero_invalid_normalizations" || summary.invalidNormalizationCount !== 0) {
    throw new Error("V4 evidence campaign is not eligible for packet materialization.");
  }
  if (readiness.summarySha256 !== sha256(JSON.stringify(summary))) {
    throw new Error("V4 readiness summary hash does not bind the actual summary.");
  }
  const expectedAuthoritySha256 = process.env.EXPECTED_RUNNER_AUTHORITY_SHA256 || null;
  if (expectedAuthoritySha256) {
    if (readiness.producerAuthoritySha256 !== expectedAuthoritySha256
      || summary.runnerAuthority?.authoritySha256 !== expectedAuthoritySha256) {
      throw new Error("V4 evidence producer authority differs from the unified evaluator authority.");
    }
    const current = evaluatorRunnerAuthority(__dirname);
    if (current.authoritySha256 !== expectedAuthoritySha256
      || !sameEvaluatorAuthority(current, summary.runnerAuthority)) {
      throw new Error("V4 evidence producer authority descriptors differ from the current evaluator bundle.");
    }
  }
  return { readinessFile, summaryFile, readiness, summary };
};

const materializeGeneratedPackets = ({ productionRoot, evidenceRoot, outputRoot, selectedArmId,
  expectedCasesPerArm }) => {
  for (const [label, value] of Object.entries({ productionRoot, evidenceRoot, outputRoot })) {
    if (!value || !fs.existsSync(value)) throw new Error(`${label} is required and must exist.`);
  }
  if (!selectedArmId) throw new Error("ARM_ID is required.");
  const { readinessFile, summary: evidenceSummary } = assertEvidenceReadiness(evidenceRoot);
  const authorityBinding = evidenceSummary.runnerAuthority ? {
    producerAuthoritySha256: evidenceSummary.runnerAuthority.authoritySha256,
    materializerAuthoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256
  } : {};
  const productionCells = path.join(productionRoot, "cells", selectedArmId);
  if (!fs.existsSync(productionCells)) throw new Error(`Production arm is absent: ${selectedArmId}`);
  const caseIds = fs.readdirSync(productionCells).filter((caseId) =>
    fs.existsSync(path.join(productionCells, caseId, "artifact.json"))).sort();
  if (caseIds.length !== expectedCasesPerArm) {
    throw new Error(`${selectedArmId} production case set must contain exactly ${expectedCasesPerArm} cases.`);
  }
  const rows = [];
  const generatedOutcomes = [];
  for (const caseId of caseIds) {
    const artifactFile = path.join(productionCells, caseId, "artifact.json");
    const sourcesFile = path.join(evidenceRoot, "cells", selectedArmId, caseId, "sources.json");
    if (!fs.existsSync(sourcesFile)) throw new Error(`Missing V4 sources for ${selectedArmId}/${caseId}.`);
    const artifact = readJson(artifactFile);
    const evidence = readJson(sourcesFile);
    let packet;
    let outcome = "completed_production_output";
    if (artifact.error) {
      const outcomeClass = classifyEmptyProductionOutcome(artifact);
      if (outcomeClass === "content_filter_no_call") {
        packet = makeOperationalCensorPacket({ artifact, evidence });
        outcome = "operational_censor_content_filter";
      } else if (outcomeClass === "parser_or_contract_failure") {
        packet = makeEmptyProductionPacket({ artifact, evidence });
        outcome = "parser_or_contract_failure_empty_profile";
      } else {
        throw new Error(`Generated packet refuses non-evaluable production failure ${selectedArmId}/${caseId}: ${outcomeClass}`);
      }
    } else {
      packet = makeProductionPacket({ artifact, evidence });
      if (!(artifact.finalProfiles || []).length) outcome = "completed_empty_profile";
    }
    const dir = path.join(outputRoot, selectedArmId, caseId);
    const materialized = materializePacket({ packet, productionArtifact: artifact,
      evidence, evidenceRoot, packetArtifactRoot: dir });
    writeJsonExclusive(path.join(dir, "packet.json"), materialized);
    const seal = {
      schemaVersion: 1, armId: selectedArmId, caseId,
      ...authorityBinding,
      legacyPacketSha256: null,
      generatedBasePacket: true,
      generatedOutcome: outcome,
      productionArtifactSha256: sha256(fs.readFileSync(artifactFile)),
      evidenceSourcesSha256: sha256(fs.readFileSync(sourcesFile)),
      readinessSha256: sha256(fs.readFileSync(readinessFile)),
      materializedPacketSha256: sha256(fs.readFileSync(path.join(dir, "packet.json"))),
      fixedFactsSha256: materialized.packetV4Bindings.fixedFactsSha256,
      sourceMappingSha256: materialized.packetV4Bindings.sourceMappingSha256,
      sourceCardinality: materialized.sources.length
    };
    writeJsonExclusive(path.join(dir, "binding-seal.json"), seal);
    rows.push({ armId: selectedArmId, caseId, sourceCardinality: seal.sourceCardinality,
      packetSha256: materialized.packetSha256, fixedFactsSha256: seal.fixedFactsSha256,
      productionOutcome: outcome });
    generatedOutcomes.push({ caseId, outcome });
  }
  writeJsonExclusive(path.join(outputRoot, "summaries", `${selectedArmId}.json`), {
    schemaVersion: 1,
    status: "format_aware_generated_packets_v4_ready",
    selectedArmId,
    expectedCasesPerArm,
    evaluablePackets: rows.length,
    totalOutcomes: rows.length,
    generatedOutcomes,
    ...authorityBinding,
    evidenceReadinessSha256: sha256(fs.readFileSync(readinessFile)),
    rows
  });
  return rows;
};

const main = () => {
  const productionRoot = path.resolve(process.env.PRODUCTION_ROOT || "");
  const evidenceRoot = path.resolve(process.env.V4_EVIDENCE_ROOT || "");
  const outputRoot = path.resolve(process.env.OUTPUT_ROOT || "");
  const selectedArmId = process.env.ARM_ID;
  const expectedCasesPerArm = Number(process.env.EXPECTED_CASES_PER_ARM || 60);
  if (process.env.GENERATE_BASE_PACKETS === "1") {
    materializeGeneratedPackets({ productionRoot, evidenceRoot, outputRoot, selectedArmId,
      expectedCasesPerArm });
    return;
  }
  const legacyPacketRoot = path.resolve(process.env.LEGACY_PACKET_ROOT || "");
  for (const [label, value] of Object.entries({ legacyPacketRoot, productionRoot, evidenceRoot, outputRoot })) {
    if (!value || !fs.existsSync(value)) throw new Error(`${label} is required and must exist.`);
  }
  if (!selectedArmId) throw new Error("ARM_ID is required; packet roots may contain unrelated arms.");
  const { readinessFile, summary: evidenceSummary } = assertEvidenceReadiness(evidenceRoot);
  const authorityBinding = evidenceSummary.runnerAuthority ? {
    producerAuthoritySha256: evidenceSummary.runnerAuthority.authoritySha256,
    materializerAuthoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256
  } : {};
  const rows = [];
  const emptyProductionOutcomes = [];
  for (const armId of fs.readdirSync(legacyPacketRoot).sort().filter((armId) => armId === selectedArmId)) {
    for (const caseId of fs.readdirSync(path.join(legacyPacketRoot, armId)).sort()) {
      const packetFile = path.join(legacyPacketRoot, armId, caseId, "packet.json");
      if (!fs.existsSync(packetFile)) continue;
      const artifactFile = path.join(productionRoot, "cells", armId, caseId, "artifact.json");
      const sourcesFile = path.join(evidenceRoot, "cells", armId, caseId, "sources.json");
      if (!fs.existsSync(artifactFile) || !fs.existsSync(sourcesFile)) {
        throw new Error(`Missing frozen artifact or V4 sources for ${armId}/${caseId}.`);
      }
      const packet = readJson(packetFile);
      const productionArtifact = readJson(artifactFile);
      const evidence = readJson(sourcesFile);
      const dir = path.join(outputRoot, armId, caseId);
      const materialized = materializePacket({ packet, productionArtifact, evidence, evidenceRoot,
        packetArtifactRoot: dir });
      writeJsonExclusive(path.join(dir, "packet.json"), materialized);
      const seal = {
        schemaVersion: 1, armId, caseId,
        ...authorityBinding,
        legacyPacketSha256: sha256(fs.readFileSync(packetFile)),
        productionArtifactSha256: sha256(fs.readFileSync(artifactFile)),
        evidenceSourcesSha256: sha256(fs.readFileSync(sourcesFile)),
        readinessSha256: sha256(fs.readFileSync(readinessFile)),
        materializedPacketSha256: sha256(fs.readFileSync(path.join(dir, "packet.json"))),
        fixedFactsSha256: materialized.packetV4Bindings.fixedFactsSha256,
        sourceMappingSha256: materialized.packetV4Bindings.sourceMappingSha256,
        sourceCardinality: materialized.sources.length
      };
      writeJsonExclusive(path.join(dir, "binding-seal.json"), seal);
      rows.push({ armId, caseId, sourceCardinality: seal.sourceCardinality,
        packetSha256: materialized.packetSha256, fixedFactsSha256: seal.fixedFactsSha256 });
    }
  }
  const packetKeys = new Set(rows.map((row) => `${row.armId}/${row.caseId}`));
  for (const armId of [selectedArmId]) {
    const productionCells = path.join(productionRoot, "cells", armId);
    if (!fs.existsSync(productionCells)) throw new Error(`Production arm is absent: ${armId}`);
    const productionCaseIds = fs.readdirSync(productionCells).filter((caseId) =>
      fs.existsSync(path.join(productionCells, caseId, "artifact.json"))).sort();
    if (productionCaseIds.length !== expectedCasesPerArm) {
      throw new Error(`${armId} production case set must contain exactly ${expectedCasesPerArm} cases.`);
    }
    for (const caseId of productionCaseIds) {
      const key = `${armId}/${caseId}`;
      if (packetKeys.has(key)) continue;
      const artifactFile = path.join(productionCells, caseId, "artifact.json");
      const artifact = readJson(artifactFile);
      if (!artifact.error || (artifact.finalProfiles || []).length || (artifact.parserProfiles || []).length) {
        throw new Error(`Missing evaluator packet is not an empty parser/contract outcome: ${key}`);
      }
      const sourcesFile = path.join(evidenceRoot, "cells", armId, caseId, "sources.json");
      if (!fs.existsSync(sourcesFile)) throw new Error(`Missing V4 sources for empty production outcome: ${key}`);
      const evidence = readJson(sourcesFile);
      const emptyPacket = makeEmptyProductionPacket({ artifact, evidence });
      const dir = path.join(outputRoot, armId, caseId);
      const materialized = materializePacket({ packet: emptyPacket, productionArtifact: artifact,
        evidence, evidenceRoot, packetArtifactRoot: dir });
      writeJsonExclusive(path.join(dir, "packet.json"), materialized);
      writeJsonExclusive(path.join(dir, "binding-seal.json"), {
        schemaVersion: 1, armId, caseId, legacyPacketSha256: null,
        ...authorityBinding,
        generatedEmptyPacket: true,
        traceClassification: materialized.evaluationGate.traceClassification,
        productionArtifactSha256: sha256(fs.readFileSync(artifactFile)),
        evidenceSourcesSha256: sha256(fs.readFileSync(sourcesFile)),
        readinessSha256: sha256(fs.readFileSync(readinessFile)),
        materializedPacketSha256: sha256(fs.readFileSync(path.join(dir, "packet.json"))),
        fixedFactsSha256: materialized.packetV4Bindings.fixedFactsSha256,
        sourceMappingSha256: materialized.packetV4Bindings.sourceMappingSha256,
        sourceCardinality: materialized.sources.length
      });
      const record = { armId, caseId, status: "EMPTY_PROFILE_EVALUABLE",
        reason: "parser_or_contract_failure_without_profile", packetSha256: materialized.packetSha256 };
      emptyProductionOutcomes.push(record);
      rows.push({ armId, caseId, sourceCardinality: materialized.sources.length,
        packetSha256: materialized.packetSha256,
        fixedFactsSha256: materialized.packetV4Bindings.fixedFactsSha256,
        productionOutcome: record.status });
      packetKeys.add(key);
    }
    const armOutcomes = rows.filter((row) => row.armId === armId).length;
    if (armOutcomes !== expectedCasesPerArm) throw new Error(`${armId} output case-set cardinality mismatch.`);
  }
  writeJsonExclusive(path.join(outputRoot, "summaries", `${selectedArmId}.json`), {
    schemaVersion: 1, status: "format_aware_packets_v4_ready", selectedArmId, expectedCasesPerArm,
    evaluablePackets: rows.length, emptyProductionOutcomes: emptyProductionOutcomes.length,
    totalOutcomes: rows.length,
    evidenceReadinessSha256: sha256(fs.readFileSync(readinessFile)), rows, emptyProductionOutcomes,
    ...authorityBinding
  });
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { assertPacketIntegrity, assertFrozenProductionBinding, canonicalUrl, canonicalUrlSet,
  assertEvidenceReadiness, candidatesForProfiles, classifyEmptyProductionOutcome, expectedFieldsForClaims, fixedPacketFacts,
  FIXED_EVALUATION_POLICY, makeEmptyProductionPacket, makeOperationalCensorPacket, makeProductionPacket, materializeGeneratedPackets,
  materializePacket, productionSourceUrls, verifyDescriptor };

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const adapter = require("./materialize_format_aware_packets_v4.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "packet-v4-test-"));
try {
  const raw = Buffer.from("<html>fixture</html>");
  const text = Buffer.from("# Jane Doe\nPhone 555-0100\n");
  fs.writeFileSync(path.join(directory, "raw.body"), raw);
  fs.writeFileSync(path.join(directory, "text.txt"), text);
  const descriptor = (name, body) => ({ path: name, sha256: sha256(body), byteLength: body.length, complete: true });
  const packet = {
    caseId: "P001",
    identityContext: { request: { npi: "1234567890", name: "Jane Doe" } },
    claims: [{ claimId: "c0", fieldType: "phone", value: "555-0100", sourceId: "s0" }],
    preSanitizerCandidates: [{ candidateFactId: "p0", fieldType: "phone", value: "555-0100", sourceId: "s0" }],
    expectedFields: ["phone", "address", "website", "rating", "specialty"],
    actionTrace: { calls: [], annotations: [] },
    sources: [{ sourceId: "s0", url: "https://example.test/jane", deliveredContent: "stale old text",
      hostReadStatus: "read", snapshotCoverage: "full_normalized_snapshot" }]
  };
  const productionArtifact = { armId: "A", caseId: "P001",
    input: { lineOfCoverage: "Medical", providers: [packet.identityContext.request] },
    cmsBaseline: null, finalProfiles: [], parserProfiles: [],
    trace: { actionSourceUrls: ["https://example.test/jane"], openedUrls: [], citationUrls: [],
      provenanceUrls: ["https://example.test/jane"], output: [] } };
  const evidence = { armId: "A", caseId: "P001", sources: [{
    sourceId: "azure_x", requestedUrl: "https://example.test/jane", canonicalUrl: "https://example.test/jane",
    finalUrl: "https://example.test/jane", outcome: "read", httpStatus: 200,
    headers: { contentType: "text/html" }, rawBodyArtifact: descriptor("raw.body", raw),
    normalizedTextArtifact: descriptor("text.txt", text), semanticExtraction: {
      extractionMode: "parse5_rendered_semantic_v4", normalizationFormat: "rendered_semantic_markdown_v4"
    }
  }] };
  const result = adapter.materializePacket({ packet, productionArtifact, evidence, evidenceRoot: directory });
  assert.equal(result.sources.length, 1);
  assert.match(result.sources[0].deliveredContent, /Phone 555-0100/);
  assert.doesNotMatch(result.sources[0].deliveredContent, /stale old text/);
  assert.equal(result.sources[0].normalizationFormat, "rendered_semantic_markdown_v4");
  assert.equal(result.packetV4Bindings.sourceIdsPreserved, true);
  assert.equal(result.packetV4Bindings.zeroInvalidNormalizations, true);
  assert.equal(result.packetV4Bindings.sourceMappingOneToOne, true);
  assert.deepEqual(result.packetV4Bindings.sourceMapping.map((row) => [row.oldSourceId, row.v4SourceId]),
    [["s0", "azure_x"]]);
  assert.equal(result.evaluationPolicy.ratingPolicy, "schema_compatibility_row_only_never_penalize_omission");
  const emptyReadEvidence = structuredClone(evidence);
  emptyReadEvidence.sources[0].normalizedTextArtifact = null;
  emptyReadEvidence.sources[0].semanticExtraction = {
    extractionMode: "parse5_rendered_semantic_v4", normalizationFormat: "rendered_semantic_markdown_v4",
    evidenceTextChars: 0
  };
  const emptyReadResult = adapter.materializePacket({ packet, productionArtifact,
    evidence: emptyReadEvidence, evidenceRoot: directory });
  assert.equal(emptyReadResult.sources[0].hostReadStatus, "unavailable");
  assert.equal(emptyReadResult.sources[0].snapshotCoverage, "metadata_only_unavailable");
  const artifactRoot = path.join(directory, "packet-artifacts");
  const oversizedEvidence = structuredClone(evidence);
  oversizedEvidence.sources[0].semanticExtraction = {
    ...oversizedEvidence.sources[0].semanticExtraction,
    sourceBodySha256: sha256(raw),
    manualReviewSignals: ["OVERSIZED_JSON_LD_REQUIRES_MANUAL_REVIEW"],
    oversizedJsonLd: [{ chars: 100_001, sha256: "a".repeat(64), reason: "INDIVIDUAL_JSON_LD_LIMIT" }],
    totalJsonLdChars: 100_001,
    maximumAggregateJsonLdChars: 150_000
  };
  const oversizedResult = adapter.materializePacket({ packet, productionArtifact, evidence: oversizedEvidence,
    evidenceRoot: directory, packetArtifactRoot: artifactRoot });
  const bridged = oversizedResult.sources[0].manualReviewArtifacts[0];
  assert.equal(bridged.kind, "complete_raw_source_body_containing_omitted_json_ld");
  assert.equal(fs.readFileSync(path.join(artifactRoot, bridged.path)).toString(), raw.toString());
  assert.equal(bridged.sha256, sha256(raw));
  assert.throws(() => adapter.materializePacket({ packet, productionArtifact,
    evidence: { ...evidence, sources: [...evidence.sources, { ...evidence.sources[0],
      requestedUrl: "https://extra.test/", canonicalUrl: "https://extra.test/" }] }, evidenceRoot: directory }),
  /absent from frozen packet/);
  assert.throws(() => adapter.verifyDescriptor(directory, { ...descriptor("raw.body", raw), complete: false },
    "incomplete"), /not declared complete/);
  assert.throws(() => adapter.assertPacketIntegrity({ ...packet,
    expectedFields: [{ fieldType: "phone" }, { fieldType: "phone" }] }), /duplicate expected fields/);
  const emptyArtifact = { ...productionArtifact, error: "AI provider profile search failed.",
    strata: { entityType: "individual" }, rawResponses: [{ status: "completed", output: [{ type: "message",
      content: [{ type: "output_text", text: "{malformed}" }] }] }] };
  const empty = adapter.makeEmptyProductionPacket({ artifact: emptyArtifact, evidence });
  assert.deepEqual(empty.finalSanitizedProfiles, []);
  assert.equal(empty.evaluationGate.productionOutcome, "empty_profile_after_parser_or_contract_failure");
  assert.equal(adapter.assertFrozenProductionBinding(empty, emptyArtifact), true);
  const filteredArtifact = { ...emptyArtifact, rawResponses: [{ status: "incomplete",
    incomplete_details: { reason: "content_filter" }, output: [] }] };
  const censored = adapter.makeOperationalCensorPacket({ artifact: filteredArtifact, evidence });
  assert.equal(censored.evaluationGate.productionOutcome, "operational_censor_content_filter");
  assert.equal(censored.evaluationGate.qualityDisposition, "paired_operational_censor_not_arm_failure");
  assert.equal(adapter.assertFrozenProductionBinding(censored, filteredArtifact), true);

  const generatedArtifact = structuredClone(productionArtifact);
  generatedArtifact.finalProfiles = [{ specialties: [], locations: [], websites: [], phoneNumbers: [{
    value: "555-0100",
    citation: { sourceUrl: "https://example.test/jane", sourceTitle: "Jane Doe",
      providerIdentitySpan: "Jane Doe", factSpan: "Phone 555-0100", explicitFactDateSpan: null }
  }] }];
  generatedArtifact.parserProfiles = structuredClone(generatedArtifact.finalProfiles);
  generatedArtifact.parserProfiles[0].phoneNumbers.push({ value: "555-0199",
    citation: { sourceUrl: "https://example.test/jane", sourceTitle: "Jane Doe",
      providerIdentitySpan: "Jane Doe", factSpan: "Fax 555-0199", explicitFactDateSpan: null } });
  const generated = adapter.makeProductionPacket({ artifact: generatedArtifact, evidence });
  assert.equal(generated.claims.length, 1);
  assert.equal(generated.claims[0].sourceId, "azure_x");
  assert.equal(generated.claims[0].fieldType, "phone");
  assert.deepEqual(generated.preSanitizerCandidates.map((candidate) => candidate.sanitizerActionObserved),
    ["kept", "stack_withheld"]);
  assert.deepEqual(generated.expectedFields.map((field) => [field.fieldType, field.outputState]), [
    ["phone", "emitted"], ["address", "missing"], ["website", "missing"],
    ["rating", "missing"], ["specialty", "missing"]
  ]);
  assert.equal(adapter.assertFrozenProductionBinding(generated, generatedArtifact), true);

  const trailingSlashEvidence = structuredClone(evidence);
  trailingSlashEvidence.sources[0].requestedUrl = "https://example.test/jane/";
  trailingSlashEvidence.sources[0].canonicalUrl = "https://example.test/jane";
  const trailingSlashArtifact = structuredClone(generatedArtifact);
  trailingSlashArtifact.trace.actionSourceUrls = ["https://example.test/jane/"];
  trailingSlashArtifact.trace.provenanceUrls = ["https://example.test/jane/"];
  trailingSlashArtifact.finalProfiles[0].phoneNumbers[0].citation.sourceUrl = "https://example.test/jane/";
  trailingSlashArtifact.parserProfiles[0].phoneNumbers[0].citation.sourceUrl = "https://example.test/jane/";
  trailingSlashArtifact.parserProfiles[0].phoneNumbers[1].citation.sourceUrl = "https://example.test/jane/";
  const trailingSlashPacket = adapter.makeProductionPacket({ artifact: trailingSlashArtifact,
    evidence: trailingSlashEvidence });
  assert.equal(trailingSlashPacket.sources[0].url, "https://example.test/jane/");
  assert.equal(trailingSlashPacket.sources[0].canonicalUrl, "https://example.test/jane");
  assert.equal(trailingSlashPacket.claims[0].sourceId, "azure_x");
  assert.equal(adapter.assertFrozenProductionBinding(trailingSlashPacket, trailingSlashArtifact), true);

  const trackingEvidence = structuredClone(evidence);
  trackingEvidence.sources[0].requestedUrl = "https://example.test/jane";
  trackingEvidence.sources[0].canonicalUrl = "https://example.test/jane";
  const trackingArtifact = structuredClone(generatedArtifact);
  const trackingUrl = "https://example.test/jane?ref=localdatabase&utm_source=directory";
  trackingArtifact.trace.actionSourceUrls = [trackingUrl];
  trackingArtifact.trace.provenanceUrls = [trackingUrl];
  trackingArtifact.finalProfiles[0].phoneNumbers[0].citation.sourceUrl = trackingUrl;
  trackingArtifact.parserProfiles[0].phoneNumbers[0].citation.sourceUrl = trackingUrl;
  trackingArtifact.parserProfiles[0].phoneNumbers[1].citation.sourceUrl = trackingUrl;
  const trackingPacket = adapter.makeProductionPacket({ artifact: trackingArtifact,
    evidence: trackingEvidence });
  assert.equal(trackingPacket.sources[0].url, "https://example.test/jane");
  assert.equal(trackingPacket.sources[0].canonicalUrl, "https://example.test/jane");
  assert.equal(trackingPacket.claims[0].sourceId, "azure_x");
  assert.equal(adapter.assertFrozenProductionBinding(trackingPacket, trackingArtifact), true);

  const runMainFixture = ({ includeLegacy, artifact, generateBasePackets = false }) => {
    const campaign = fs.mkdtempSync(path.join(os.tmpdir(), "packet-v4-main-"));
    const legacy = path.join(campaign, "legacy");
    const production = path.join(campaign, "production");
    const evidenceRoot = path.join(campaign, "evidence");
    const output = path.join(campaign, "output");
    fs.mkdirSync(path.join(legacy, "A", "P001"), { recursive: true });
    fs.mkdirSync(path.join(production, "cells", "A", "P001"), { recursive: true });
    fs.mkdirSync(path.join(evidenceRoot, "cells", "A", "P001"), { recursive: true });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(evidenceRoot, "raw.body"), raw);
    fs.writeFileSync(path.join(evidenceRoot, "text.txt"), text);
    const campaignEvidence = { ...evidence, sources: evidence.sources.map((row) => ({ ...row,
      rawBodyArtifact: descriptor("raw.body", raw), normalizedTextArtifact: descriptor("text.txt", text) })) };
    fs.writeFileSync(path.join(production, "cells", "A", "P001", "artifact.json"), JSON.stringify(artifact));
    fs.writeFileSync(path.join(evidenceRoot, "cells", "A", "P001", "sources.json"), JSON.stringify(campaignEvidence));
    const summary = { invalidNormalizationCount: 0 };
    fs.writeFileSync(path.join(evidenceRoot, "summary.json"), JSON.stringify(summary));
    fs.writeFileSync(path.join(evidenceRoot, "NORMALIZATION_READY.json"), JSON.stringify({
      status: "zero_invalid_normalizations", summarySha256: sha256(JSON.stringify(summary)) }));
    if (includeLegacy) fs.writeFileSync(path.join(legacy, "A", "P001", "packet.json"), JSON.stringify(packet));
    execFileSync(process.execPath, [path.join(__dirname, "materialize_format_aware_packets_v4.js")], { env: {
      ...process.env, ALLOW_HISTORICAL_REPRODUCTION: "YES",
      LEGACY_PACKET_ROOT: legacy, PRODUCTION_ROOT: production,
      V4_EVIDENCE_ROOT: evidenceRoot, OUTPUT_ROOT: output, ARM_ID: "A", EXPECTED_CASES_PER_ARM: "1",
      GENERATE_BASE_PACKETS: generateBasePackets ? "1" : "0"
    } });
    const seal = JSON.parse(fs.readFileSync(path.join(output, "A", "P001", "binding-seal.json"), "utf8"));
    fs.rmSync(campaign, { recursive: true, force: true });
    return seal;
  };
  const ordinarySeal = runMainFixture({ includeLegacy: true, artifact: productionArtifact });
  assert.notEqual(ordinarySeal.generatedEmptyPacket, true);
  assert.equal(typeof ordinarySeal.legacyPacketSha256, "string");
  const emptySeal = runMainFixture({ includeLegacy: false, artifact: emptyArtifact });
  assert.equal(emptySeal.generatedEmptyPacket, true);
  assert.equal(emptySeal.traceClassification, "parser_or_contract_failure");
  const generatedSeal = runMainFixture({ includeLegacy: false, artifact: productionArtifact,
    generateBasePackets: true });
  assert.equal(generatedSeal.generatedBasePacket, true);
  assert.equal(generatedSeal.generatedOutcome, "completed_empty_profile");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

process.stdout.write("format-aware packet adapter tests passed\n");

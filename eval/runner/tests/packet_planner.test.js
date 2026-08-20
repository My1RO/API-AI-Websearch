#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const planner = require("../core/evaluator_packet_planner.js");

const source = (sourceId, content, extra = {}) => ({
  sourceId,
  url: `https://example.test/${sourceId}`,
  finalUrl: `https://example.test/${sourceId}`,
  hostReadStatus: "read",
  httpStatus: 200,
  snapshotCoverage: "full_normalized_snapshot",
  originalChars: content.length,
  deliveredChars: content.length,
  silentlyTruncated: false,
  omittedRanges: [],
  fullTextSha256: planner.sha256(content),
  deliveredContent: `[CHAR_RANGE 0:${content.length}; complete_semantic_markdown]\n${content}`,
  ...extra
});

const packet = {
  packetSha256: "fixture",
  claims: [{ sourceId: "s1" }],
  preSanitizerCandidates: [],
  actionTrace: {
    calls: [
      { type: "search", sourceIds: ["s1", "s2", "s3"] },
      { type: "open_page", url: "https://example.test/s2", sourceIds: [] }
    ],
    annotations: []
  },
  sources: [source("s1", "a".repeat(40)), source("s2", "b".repeat(35)), source("s3", "c".repeat(30))]
};
const countTokens = (text) => text.length;
const plan = planner.planEvidenceShards(packet, { countTokens, maximumSourceTokens: 850 });
assert.equal(plan.manifest.semanticFiltering, false);
assert.equal(plan.manifest.sourceCount, 3);
assert.equal(plan.manifest.oversizeSourceCount, 0);
assert.equal(planner.verifyPlan(packet, plan), true);
assert.deepEqual(planner.sourceRoles(packet).get("s1"), ["fact_cited", "consulted_search_source"]);
assert.deepEqual(planner.sourceRoles(packet).get("s2"), ["explicitly_opened", "consulted_search_source"]);
assert.deepEqual(planner.sourceRoles(packet).get("s3"), ["consulted_search_source"]);
assert.throws(() => planner.selectNativeContentEvidence(packet), /changes source credit/);
const nativeOnly = planner.selectNativeContentEvidence(packet, { acknowledgeEstimandChange: true });
assert.deepEqual(nativeOnly.included.map((item) => item.sourceId), ["s1", "s2"]);
assert.deepEqual(nativeOnly.excludedSearchOnlyAudit.map((item) => item.sourceId), ["s3"]);
assert.equal(nativeOnly.excludedSearchOnlyAudit[0].fullTextSha256, packet.sources[2].fullTextSha256);

const oversize = planner.planEvidenceShards(packet, { countTokens, maximumSourceTokens: 100 });
assert.equal(oversize.manifest.plannedSourceCount, 0);
assert.equal(oversize.manifest.oversizeSourceCount, 3);
assert(oversize.manifest.oversizeSources.every((item) => item.disposition === "HONEST_NO_CALL_NO_TRUNCATION"));

const truncated = structuredClone(packet);
truncated.sources[0].silentlyTruncated = true;
assert.throws(() => planner.planEvidenceShards(truncated, { countTokens }), /truncated/);

const mutated = structuredClone(plan);
mutated.shards[0].sources[0].deliveredContent += "changed";
assert.throws(() => planner.verifyPlan(packet, mutated), /lost or changed/);

const longSource = source("long", ["# Provider", "A".repeat(120), "## Phone", "B".repeat(120)].join("\n"));
const chunked = planner.planSourceChunks(longSource, {
  countTokens: (text) => text.length,
  maximumChunkTokens: 190,
  wrapperTokens: 20,
  overlapChars: 12
});
assert.equal(chunked.status, "chunked");
assert(chunked.chunks.length > 1);
assert.equal(chunked.intervalUnionVerified, true);
assert.equal(planner.verifyIntervalCoverage(longSource.deliveredChars, chunked.chunks), true);
assert(chunked.chunks.slice(1).every((chunk) => chunk.overlapPrefixChars > 0));

const singleLineHtml = source("single-line-html", JSON.stringify({
  css: "A".repeat(500), content: "Provider office phone 555-0100"
}), {
  contentType: "text/html;charset=utf-8",
  normalizationFormat: "rendered_semantic_markdown_v4",
  extractionMode: "parse5_rendered_semantic_v4"
});
const singleLineChunks = planner.planSourceChunks(singleLineHtml, {
  countTokens: (text) => text.length,
  maximumChunkChars: 120,
  maximumChunkTokens: 160,
  wrapperTokens: 20,
  overlapChars: 12
});
assert.equal(singleLineChunks.status, "chunked");
assert(singleLineChunks.chunks.length > 1);
assert(singleLineChunks.chunks.some((chunk) => chunk.boundaryMode === "lossless_character_fallback"));
assert.equal(planner.verifyIntervalCoverage(singleLineHtml.deliveredChars, singleLineChunks.chunks), true);
const singleLineText = singleLineHtml.deliveredContent.replace(/^\[CHAR_RANGE[^\n]*\]\n/, "");
assert.equal(singleLineChunks.chunks.map((chunk) => singleLineText
  .slice(chunk.coreStart, chunk.coreEnd)).join(""), singleLineText);

const duplicateEvidence = [
  { sourceId: "s", absoluteStart: 10, absoluteEnd: 20, quote: "same" },
  { sourceId: "s", absoluteStart: 10, absoluteEnd: 20, quote: "same" },
  { sourceId: "s", absoluteStart: 12, absoluteEnd: 22, quote: "different" }
];
assert.deepEqual(planner.stableDedupeEvidence(duplicateEvidence), [duplicateEvidence[0], duplicateEvidence[2]]);

const badWorkbook = source("book", "PK binary", { url: "https://example.test/data.xlsx" });
const rejected = planner.planSourceChunks(badWorkbook, { countTokens });
assert.equal(rejected.status, "INVALID_NORMALIZATION");
assert(rejected.defects.includes("WORKBOOK_NORMALIZATION_FORMAT_UNDECLARED"));

const unavailable = source("empty", "", {
  snapshotCoverage: "metadata_only_unavailable", hostReadStatus: "unavailable", deliveredContent: ""
});
const unavailablePlan = planner.planSourceChunks(unavailable, { countTokens });
assert.equal(unavailablePlan.chunks.length, 1);
assert.deepEqual([unavailablePlan.chunks[0].coreStart, unavailablePlan.chunks[0].coreEnd], [0, 0]);

const workbookText = [
  "# Complete workbook text", "Workbook SHA-256: fixture", "",
  "## Sheet: Providers", "Declared dimensions: A1:C8",
  "ROW 1: A1=\"NPI\" | B1=\"Provider name\" | C1=\"Specialty\" | D1=\"Phone\"",
  "ROW 2: A2=\"1111111111\" | B2=\"Other Person\" | C2=\"Cardiology\"",
  "ROW 7: A7=\"1972001204\" | B7=\"KHAI BROWN\" | C7=\"96-Behavioral Health Para-Professionals\" | D7=\"2163614400\"",
  "ROW 8: A8=\"2222222222\" | B8=\"Another Person\" | C8=\"Family Medicine\"", ""
].join("\n");
const workbookSource = source("workbook", workbookText, {
  url: "https://example.test/providers.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalizationFormat: "workbook_rows_v1",
  extractionMode: "openpyxl_complete_nonempty_cells"
});
const workbookPacket = {
  identityContext: { request: { npi: "1972001204", name: "KHAI BROWN" } },
  claims: [{ sourceId: "workbook", fieldType: "specialty", value: "96-Behavioral Health Para-Professionals" }],
  preSanitizerCandidates: [], actionTrace: { calls: [], annotations: [] }, sources: [workbookSource]
};
const projected = planner.planWorkbookProjection(workbookSource, workbookPacket, { headerRowsPerSheet: 1 });
assert.equal(projected.applied, true);
assert.equal(projected.audit.scannedRows, 4);
assert.equal(projected.audit.scannedCells, 14);
assert.equal(projected.audit.requiresManualReview, false);
assert.deepEqual(projected.audit.npiColumnsBySheet, { Providers: ["A"] });
assert.match(projected.source.deliveredContent, /ROW 7:.*1972001204/);
assert.match(projected.source.deliveredContent, /ROW 1:.*Provider name/);
assert.doesNotMatch(projected.source.deliveredContent, /ROW 8:/);
assert.equal(projected.source.originalChars, workbookText.length);
assert.equal(projected.source.fullTextSha256, planner.sha256(workbookText));
assert.equal(projected.source.fullOriginalSourceModelRead, false);
assert.equal(projected.audit.modelFacingCoverage, "deterministic_index_projection_not_full_source");
assert(projected.audit.omittedOriginalRanges.length > 0);
assert.equal(planner.planSourceChunks(projected.source, { countTokens }).status, "chunked");

const candidateOnlyPacket = { ...workbookPacket, identityContext: { request: { npi: "9999999999", name: "Missing Name" } },
  claims: [{ sourceId: "workbook", fieldType: "specialty", value: "Cardiology" }] };
const candidateOnly = planner.planWorkbookProjection(workbookSource, candidateOnlyPacket);
assert.equal(candidateOnly.audit.requiresManualReview, true);
assert.equal(candidateOnly.audit.manualReviewReason, "NO_EXACT_REQUESTED_NPI_IN_RECOGNIZED_NPI_COLUMN");
const noMatchPacket = { ...candidateOnlyPacket, claims: [] };
const recognizedNoMatch = planner.planWorkbookProjection(workbookSource, noMatchPacket);
assert.equal(recognizedNoMatch.audit.recognizedNpiColumnCount, 1);
assert.equal(recognizedNoMatch.audit.requiresManualReview, true,
  "even exhaustive absence remains a manual case because workbook relevance may depend on semantic variants");
const unstructuredText = workbookText.replace('A1="NPI"', 'A1="License identifier"');
const unstructuredSource = source("unstructured", unstructuredText, {
  url: "https://example.test/unstructured.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalizationFormat: "workbook_rows_v1", extractionMode: "openpyxl_complete_nonempty_cells"
});
const unstructured = planner.planWorkbookProjection(unstructuredSource, noMatchPacket);
assert.equal(unstructured.audit.recognizedNpiColumnCount, 0);
assert.equal(unstructured.audit.requiresManualReview, true);
assert.equal(unstructured.audit.manualReviewReason, "NO_EXACT_REQUESTED_NPI_IN_RECOGNIZED_NPI_COLUMN");

const longTitleWorkbook = workbookText.replace('A1="NPI"', 'A1="Title"')
  .replace('ROW 7:', 'ROW 6: A6="National Provider Identifier" | B6="Provider name"\nROW 7:');
const longTitleSource = source("long-title", longTitleWorkbook, {
  url: "https://example.test/long-title.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalizationFormat: "workbook_rows_v1", extractionMode: "openpyxl_complete_nonempty_cells"
});
const longTitleProjected = planner.planWorkbookProjection(longTitleSource, {
  ...workbookPacket, sources: [longTitleSource], claims: [{ ...workbookPacket.claims[0], sourceId: "long-title" }]
}, { headerRowsPerSheet: 1 });
assert.deepEqual(longTitleProjected.audit.npiColumnsBySheet, { Providers: ["A"] });
assert.equal(longTitleProjected.audit.requiresManualReview, false);

const lateHeaderWorkbook = workbookText.replace('A1="NPI"', 'A1="Unlabeled identifier"')
  .replace('ROW 8:', 'ROW 8: A8="NPI" | B8="Provider name"\nROW 9:');
const lateHeaderSource = source("late-header", lateHeaderWorkbook, {
  url: "https://example.test/late-header.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalizationFormat: "workbook_rows_v1", extractionMode: "openpyxl_complete_nonempty_cells"
});
const lateHeaderProjected = planner.planWorkbookProjection(lateHeaderSource, {
  ...workbookPacket, sources: [lateHeaderSource], claims: [{ ...workbookPacket.claims[0], sourceId: "late-header" }]
}, { headerRowsPerSheet: 1 });
assert.equal(lateHeaderProjected.audit.exactRequestedNpiColumnMatches.length, 0,
  "a late header must not retroactively bless an earlier value in the same column");
assert(lateHeaderProjected.audit.manualReviewReasons.includes("REQUESTED_NPI_OUTSIDE_RECOGNIZED_TABLE_REGION"));
assert.equal(lateHeaderProjected.audit.requiresManualReview, true);

const interveningTableWorkbook = [
  "# Complete workbook text", "Workbook SHA-256: fixture", "", "## Sheet: Mixed",
  "Declared dimensions: A1:B8", 'ROW 1: A1="NPI" | B1="Provider name"',
  'ROW 2: A2="1111111111" | B2="Other Person"',
  'ROW 6: A6="Phone number" | B6="Type"',
  'ROW 7: A7="1972001204" | B7="Office"', ""
].join("\n");
const interveningTableSource = source("intervening-table", interveningTableWorkbook, {
  url: "https://example.test/intervening-table.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalizationFormat: "workbook_rows_v1", extractionMode: "openpyxl_complete_nonempty_cells"
});
const interveningProjected = planner.planWorkbookProjection(interveningTableSource, {
  ...workbookPacket, sources: [interveningTableSource],
  claims: [{ sourceId: "intervening-table", fieldType: "phone", value: "1972001204" }]
});
assert.equal(interveningProjected.audit.npiRegionsBySheet.Mixed[0].endRowExclusive, 6);
assert.equal(interveningProjected.audit.exactRequestedNpiColumnMatches.length, 0,
  "an intervening non-NPI table header must terminate the earlier NPI region");
assert(interveningProjected.audit.manualReviewReasons.includes("REQUESTED_NPI_OUTSIDE_RECOGNIZED_TABLE_REGION"));

const singleHeaderBoundaryWorkbook = interveningTableWorkbook.replace(
  'ROW 6: A6="Phone number" | B6="Type"', 'ROW 6: A6="Phone"');
const singleHeaderBoundarySource = source("single-header-boundary", singleHeaderBoundaryWorkbook, {
  url: "https://example.test/single-header-boundary.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalizationFormat: "workbook_rows_v1", extractionMode: "openpyxl_complete_nonempty_cells"
});
const singleHeaderBoundaryProjected = planner.planWorkbookProjection(singleHeaderBoundarySource, {
  ...workbookPacket, sources: [singleHeaderBoundarySource],
  claims: [{ sourceId: "single-header-boundary", fieldType: "phone", value: "1972001204" }]
});
assert.equal(singleHeaderBoundaryProjected.audit.npiRegionsBySheet.Mixed[0].endRowExclusive, 6);
assert.equal(singleHeaderBoundaryProjected.audit.exactRequestedNpiColumnMatches.length, 0);
assert(singleHeaderBoundaryProjected.audit.manualReviewReasons
  .includes("REQUESTED_NPI_OUTSIDE_RECOGNIZED_TABLE_REGION"));

process.stdout.write("evaluator packet planner tests passed\n");

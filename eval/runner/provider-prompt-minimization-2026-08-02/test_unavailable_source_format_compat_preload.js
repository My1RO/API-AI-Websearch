"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const planner = require("./evaluator_packet_planner.js");
const { qualifiesUnavailableSource } = require("./unavailable_source_format_compat_preload.js");

const source = {
  sourceId: "unavailable-workbook",
  url: "https://example.test/unrelated.xlsx",
  deliveredContent: "",
  originalChars: 0,
  deliveredChars: 0,
  snapshotCoverage: "metadata_only_unavailable",
  hostReadStatus: "unavailable",
  rawBodyArtifact: null,
  normalizedTextArtifact: null,
  bodySha256: null,
  hostFetch: {
    bytesObserved: 0,
    bytesRetained: 0,
    retentionClass: "metadata_only_unavailable",
    outcome: "fetch_error",
    error: "fetch failed",
    rawBodyArtifact: null,
    normalizedTextArtifact: null
  }
};
assert.equal(qualifiesUnavailableSource(source), true);
const planned = planner.planSourceChunks(source, { countTokens: (text) => Buffer.byteLength(text) });
assert.equal(planned.status, "chunked");
assert.equal(planned.sourceChars, 0);
assert.deepEqual([planned.chunks[0].coreStart, planned.chunks[0].coreEnd], [0, 0]);

assert.equal(qualifiesUnavailableSource({ ...source, url: "https://example.test/unavailable.html" }), false);

const mutations = [
  (row) => { row.deliveredContent = "PK"; },
  (row) => { row.hostFetch.bytesObserved = 1; },
  (row) => { row.hostFetch.bytesRetained = 1; },
  (row) => { row.snapshotCoverage = "complete"; },
  (row) => { row.hostReadStatus = "read"; },
  (row) => { row.hostFetch.rawBodyArtifact = { path: "body.bin" }; },
  (row) => { row.hostFetch.normalizedTextArtifact = { path: "book.txt" }; },
  (row) => { row.hostFetch.outcome = "success"; row.hostFetch.error = null; }
];
for (const mutate of mutations) {
  const row = JSON.parse(JSON.stringify(source));
  mutate(row);
  assert.equal(qualifiesUnavailableSource(row), false);
  const rejected = planner.planSourceChunks(row, { countTokens: (text) => Buffer.byteLength(text) });
  assert.equal(rejected.status, "INVALID_NORMALIZATION");
  assert(rejected.defects.includes("WORKBOOK_NORMALIZATION_FORMAT_UNDECLARED"));
}

process.stdout.write(`unavailable source compatibility tests passed (${path.basename(__filename)})\n`);

"use strict";

// Explicit successor compatibility adapter. The historical planner infers a
// workbook solely from a .xlsx URL even when the fetch returned no bytes and
// no evidence. For that exact unavailable-source state only, present a null
// URL to format inspection while leaving the packet, source URL, chunks,
// categorical rubric, schema, and scoring untouched.

const fs = require("node:fs");
const path = require("node:path");
const planner = require("./evaluator_packet_planner.js");
const formatPolicy = require("./source_format_policy.js");

const qualifiesUnavailableSource = (source) => {
  const fetch = source?.hostFetch || {};
  const empty = source?.deliveredContent === "";
  const zeroBytes = fetch.bytesObserved === 0 && fetch.bytesRetained === 0
    && source?.originalChars === 0 && source?.deliveredChars === 0;
  const unavailable = source?.snapshotCoverage === "metadata_only_unavailable"
    && source?.hostReadStatus === "unavailable"
    && fetch.retentionClass === "metadata_only_unavailable";
  const noArtifacts = (source?.rawBodyArtifact ?? null) === null
    && (source?.normalizedTextArtifact ?? null) === null
    && (source?.bodySha256 ?? null) === null
    && (fetch.rawBodyArtifact ?? null) === null
    && (fetch.normalizedTextArtifact ?? null) === null;
  const failed = ["fetch_error", "unavailable"].includes(fetch.outcome)
    && /fetch|unavailable/i.test(String(fetch.error || fetch.outcome));
  const workbookInferredFromMetadata = formatPolicy.isWorkbook({
    url: source?.url,
    contentType: source?.contentType
  });
  return Boolean(workbookInferredFromMetadata && empty && zeroBytes && unavailable && noArtifacts && failed);
};

if (!planner.__unavailableSourceFormatCompatibilityApplied) {
  const original = planner.planSourceChunks;
  planner.planSourceChunks = (source, options) => {
    if (!qualifiesUnavailableSource(source)) return original(source, options);
    const logFile = process.env.UNAVAILABLE_SOURCE_COMPAT_LOG;
    if (logFile) fs.appendFileSync(path.resolve(logFile), `${JSON.stringify({
      schemaVersion: 1,
      event: "metadata_only_unavailable_format_inference_bypassed",
      sourceId: source.sourceId,
      url: source.url,
      predicates: {
        bytesObserved: source.hostFetch.bytesObserved,
        bytesRetained: source.hostFetch.bytesRetained,
        originalChars: source.originalChars,
        deliveredChars: source.deliveredChars,
        snapshotCoverage: source.snapshotCoverage,
        hostReadStatus: source.hostReadStatus,
        retentionClass: source.hostFetch.retentionClass,
        fetchOutcome: source.hostFetch.outcome,
        rawBodyArtifact: source.hostFetch.rawBodyArtifact,
        normalizedTextArtifact: source.hostFetch.normalizedTextArtifact
      }
    })}\n`);
    const planned = original({ ...source, url: null }, options);
    if (planned.status !== "chunked" || planned.sourceChars !== 0
      || planned.chunks?.length !== 1 || planned.chunks[0].coreStart !== 0
      || planned.chunks[0].coreEnd !== 0) {
      throw new Error(`Unavailable-source compatibility produced a nonempty plan for ${source.sourceId}.`);
    }
    return planned;
  };
  Object.defineProperty(planner, "__unavailableSourceFormatCompatibilityApplied", { value: true });
}

module.exports = { qualifiesUnavailableSource };

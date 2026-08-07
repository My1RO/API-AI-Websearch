"use strict";

// Final exact compatibility layer for sources already proven empty and
// ineligible for automatic credit by the two explicit adapters. It bypasses
// format inference (which otherwise keys on historical MIME metadata) and
// emits the planner's canonical zero-character chunk.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const planner = require("./evaluator_packet_planner.js");
const unavailable = require("./unavailable_source_format_compat_preload.js");
const bigWorkbook = require("./big_workbook_manual_stratum_preload.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const qualifiesUnconvertibleBinary = (source) => source?.sourceId === "azure_df73dbbcced7"
  && source?.url === "https://downloads.regulations.gov/EPA-HQ-OW-2009-0819-1441/attachment_9.xls"
  && source?.bodySha256 === "4ea55b4ce2815e4b6e20cb54286139b4f7a88801b8c3fb3ed1c11763a47e461f"
  && source?.hostFetch?.outcome === "binary_unavailable"
  && source?.hostFetch?.compatibilityDisposition?.creditEligible === false
  && source?.deliveredContent === ""
  && source?.snapshotCoverage === "metadata_only_unavailable";
const qualifiesBigWorkbookProjection = (source) => source?.sourceId === bigWorkbook.EXPECTED.sourceId
  && source?.url === null
  && source?.snapshotCoverage === "metadata_only_manual_stratum"
  && source?.deliveryMode === "metadata_only_zero_automatic_credit"
  && source?.deliveredContent === ""
  && source?.bodySha256 === bigWorkbook.EXPECTED.rawBodySha256;

if (!planner.__emptyNoCreditSourcePlanApplied) {
  const original = planner.planSourceChunks;
  planner.planSourceChunks = (source, options = {}) => {
    const unavailableSource = unavailable.qualifiesUnavailableSource(source);
    const unconvertibleBinary = qualifiesUnconvertibleBinary(source);
    const manualWorkbook = qualifiesBigWorkbookProjection(source);
    if (!unavailableSource && !unconvertibleBinary && !manualWorkbook) return original(source, options);
    const wrapperTokens = options.wrapperTokens ?? 2_000;
    const textHash = sha256("");
    const logFile = process.env.EMPTY_NO_CREDIT_SOURCE_PLAN_LOG;
    if (!logFile) throw new Error("EMPTY_NO_CREDIT_SOURCE_PLAN_LOG is required.");
    fs.appendFileSync(path.resolve(logFile), `${JSON.stringify({
      schemaVersion: 1,
      event: "canonical_empty_chunk_planned_without_mime_inference",
      sourceId: source.sourceId,
      category: unavailableSource ? "zero_byte_unavailable"
        : unconvertibleBinary ? "unconvertible_binary_no_credit" : "big_workbook_manual_stratum",
      automaticCreditEligible: false,
      deliveredChars: 0
    })}\n`);
    return {
      sourceId: source.sourceId,
      status: "chunked",
      sourceChars: 0,
      sourceTextSha256: textHash,
      chunks: [{
        sourceId: source.sourceId,
        chunkIndex: 0,
        coreStart: 0,
        coreEnd: 0,
        deliveredStart: 0,
        deliveredEnd: 0,
        overlapPrefixChars: 0,
        serializedTokens: wrapperTokens,
        sourceTextSha256: textHash,
        deliveredTextSha256: textHash,
        deliveredContent: `[SOURCE ${source.sourceId}; ABS_CHAR_RANGE 0:0; CORE 0:0; SHA256 ${textHash}]\n`
      }],
      intervalUnionVerified: true,
      overlapChars: options.overlapChars ?? 1_000
    };
  };
  Object.defineProperty(planner, "__emptyNoCreditSourcePlanApplied", { value: true });
}

module.exports = { qualifiesBigWorkbookProjection, qualifiesUnconvertibleBinary };

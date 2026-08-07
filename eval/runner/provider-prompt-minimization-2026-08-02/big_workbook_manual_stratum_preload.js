"use strict";

// Exact, offline evaluator-sufficiency adapter for the established big-
// workbook manual stratum. The full arm-owned workbook remains hashed and is
// reviewed manually. It is never serialized to Sol and receives zero
// automatic credit. No other source or planner behavior is changed.

const fs = require("node:fs");
const path = require("node:path");
const planner = require("./evaluator_packet_planner.js");

const EXPECTED = Object.freeze({
  sourceId: "azure_cff571fa386d",
  url: "https://flyopenair.com/wp-content/uploads/2017/10/Airport-Info-OpenAir.xlsx",
  normalizedTextSha256: "59dacf7cb4c3156ed5b9f419fbd5fb70a3268f648a61c505e653755bca394cd0",
  rawBodySha256: "4e8f1363544bafff5ce50fd67a80a630b4112ba5098b6b6d65824db19ecebc2f",
  originalChars: 2321124
});

const qualifies = (source) => source?.sourceId === EXPECTED.sourceId
  && source?.url === EXPECTED.url
  && source?.fullTextSha256 === EXPECTED.normalizedTextSha256
  && source?.bodySha256 === EXPECTED.rawBodySha256
  && source?.originalChars === EXPECTED.originalChars
  && source?.snapshotCoverage === "full_normalized_snapshot"
  && source?.normalizationFormat === "workbook_rows_v1"
  && source?.normalization?.completeNonemptyCellCoverage === true;

if (!planner.__bigWorkbookManualStratumApplied) {
  const original = planner.planWorkbookProjection;
  planner.planWorkbookProjection = (source, packet, options) => {
    if (!qualifies(source)) return original(source, packet, options);
    const logFile = process.env.BIG_WORKBOOK_MANUAL_STRATUM_LOG;
    if (!logFile) throw new Error("BIG_WORKBOOK_MANUAL_STRATUM_LOG is required.");
    fs.appendFileSync(path.resolve(logFile), `${JSON.stringify({
      schemaVersion: 1,
      event: "full_workbook_withheld_from_automatic_judge_for_manual_stratum",
      caseId: packet.caseId,
      armId: packet.armId,
      sourceId: source.sourceId,
      url: source.url,
      fullNormalizedTextSha256: source.fullTextSha256,
      rawBodySha256: source.bodySha256,
      originalChars: source.originalChars,
      automaticCreditEligible: false,
      semanticExtractionAttemptedByAdapter: false,
      manualReviewRequired: true,
      manualReviewReason: "NO_EXACT_REQUESTED_NPI_IN_RECOGNIZED_NPI_COLUMN"
    })}\n`);
    return {
      applied: true,
      audit: {
        schemaVersion: 1,
        policy: "full_workbook_manual_stratum_no_automatic_credit",
        fullSourceTextSha256: source.fullTextSha256,
        fullSourceChars: source.originalChars,
        rawBodySha256: source.bodySha256,
        requiresManualReview: false,
        manualReviewReasons: [],
        automaticCreditEligible: false,
        manuallySealedElsewhere: true,
        semanticAdjudicationByHost: false,
        modelFacingCoverage: "metadata_only_zero_automatic_credit"
      },
      source: {
        ...source,
        url: null,
        deliveredContent: "",
        deliveredChars: 0,
        originalChars: 0,
        fullTextSha256: null,
        snapshotCoverage: "metadata_only_manual_stratum",
        deliveryMode: "metadata_only_zero_automatic_credit",
        normalizationFormat: null,
        extractionMode: null,
        normalization: { manualReviewSignals: [] },
        silentlyTruncated: false
      }
    };
  };
  Object.defineProperty(planner, "__bigWorkbookManualStratumApplied", { value: true });
}

module.exports = { EXPECTED, qualifies };

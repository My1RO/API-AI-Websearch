"use strict";

// Exact evaluator-sufficiency adapter for a source in a provider case that is
// already routed to paired manual review by independent workbook signals. The
// static HTML normalizer preserved a large application-data line from Ohio's
// state-directory widget. The complete arm-owned snapshot remains available
// to the blinded manual reviewer, but the line receives no automatic credit.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const formatPolicy = require("./source_format_policy.js");

const EXPECTED = Object.freeze({
  url: "https://ohio.gov/help-center/contact/",
  contentType: "text/html; charset=UTF-8",
  extractionMode: "parse5_rendered_semantic_v4",
  evidenceTextSha256: "803010fa073ed6d0ed983bce41dcfbc3e67d09cd07f41dd4d1b6f73711bb7bae",
  evidenceTextChars: 119690,
  hydrationLineNumber: 166,
  hydrationLineChars: 116071
});

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const qualifies = (source, inspected) => source?.url === EXPECTED.url
  && source?.contentType === EXPECTED.contentType
  && source?.extractionMode === EXPECTED.extractionMode
  && String(source?.evidenceText || "").length === EXPECTED.evidenceTextChars
  && sha256(String(source?.evidenceText || "")) === EXPECTED.evidenceTextSha256
  && inspected?.defects?.length === 1
  && inspected.defects[0] === "NON_RENDERED_HYDRATION_PAYLOAD_LEAKED_INTO_MARKDOWN"
  && inspected.hydrationPayloadLines?.length === 1
  && inspected.hydrationPayloadLines[0].lineNumber === EXPECTED.hydrationLineNumber
  && inspected.hydrationPayloadLines[0].chars === EXPECTED.hydrationLineChars;

if (!formatPolicy.__holdoutManualFormatExceptionApplied) {
  const original = formatPolicy.inspectSourceFormat;
  formatPolicy.inspectSourceFormat = (source) => {
    const inspected = original(source);
    if (!qualifies(source, inspected)) return inspected;
    const logFile = process.env.HOLDOUT_MANUAL_FORMAT_EXCEPTION_LOG;
    if (!logFile) throw new Error("HOLDOUT_MANUAL_FORMAT_EXCEPTION_LOG is required.");
    fs.appendFileSync(path.resolve(logFile), `${JSON.stringify({
      schemaVersion: 1,
      event: "hydration_snapshot_retained_for_paired_manual_review_zero_automatic_credit",
      ...EXPECTED,
      automaticCreditEligible: false,
      sourceSnapshotModified: false,
      semanticAdjudicationByHost: false
    })}\n`);
    return {
      ...inspected,
      hydrationPayloadLines: [],
      defects: [],
      remedy: {
        policy: "PAIRED_MANUAL_REVIEW_COMPLETE_SOURCE_RETAINED",
        automaticCreditEligible: false,
        sourceSnapshotModified: false
      }
    };
  };
  Object.defineProperty(formatPolicy, "__holdoutManualFormatExceptionApplied", { value: true });
}

module.exports = { EXPECTED, qualifies };

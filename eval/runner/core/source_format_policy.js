"use strict";

const path = require("node:path");

const normalizedMime = (value) => String(value || "").split(";", 1)[0].trim().toLowerCase();
const sourceExtension = (url) => {
  try { return path.extname(new URL(url).pathname).toLowerCase(); } catch { return ""; }
};
const isWorkbook = (source) => {
  const mime = normalizedMime(source.contentType);
  const extension = sourceExtension(source.url);
  return [".xls", ".xlsx", ".xlsm", ".xlsb", ".ods"].includes(extension)
    || /spreadsheet|ms-excel|opendocument\.spreadsheet/.test(mime);
};
const hydrationPayloadLines = (text, minimumChars = 100_000) => {
  let section = "";
  return String(text || "").split("\n")
  .map((line, index) => {
    if (/^#{1,6}\s/.test(line)) section = line;
    return { lineNumber: index + 1, line, section };
  })
  .filter(({ section }) => !/structured data \(JSON-LD\)/i.test(section))
  .filter(({ line }) => line.length >= minimumChars && (/^\s*[{[]/.test(line)))
  .map(({ lineNumber, line }) => {
    try {
      JSON.parse(line);
      return { lineNumber, chars: line.length, kind: "parseable_json" };
    } catch {
      return /(?:__NEXT_DATA__|ShallowReactive|pageProps|serverRendered|pinia)/.test(line)
        ? { lineNumber, chars: line.length, kind: "framework_hydration_state" } : null;
    }
  }).filter(Boolean);
};

const inspectSourceFormat = (source) => {
  const workbook = isWorkbook(source);
  const extractionMode = source.normalization?.extractionMode || source.extractionMode || null;
  const evidenceText = source.normalization?.evidenceText || source.evidenceText || "";
  const hydration = hydrationPayloadLines(evidenceText);
  const defects = [];
  if (workbook && /(?:html|plain_text)/i.test(String(extractionMode))) {
    defects.push("BINARY_WORKBOOK_ENTERED_TEXT_OR_HTML_NORMALIZER");
  }
  if (hydration.length) defects.push("NON_RENDERED_HYDRATION_PAYLOAD_LEAKED_INTO_MARKDOWN");
  return {
    url: source.url,
    contentType: source.contentType || null,
    extension: sourceExtension(source.url),
    extractionMode,
    isWorkbook: workbook,
    hydrationPayloadLines: hydration,
    defects,
    remedy: workbook ? {
      policy: "FORMAT_AWARE_COMPLETE_WORKBOOK_TEXT",
      parser: "format-aware workbook library; never HTML/plain-text normalizer",
      deliveredUnits: ["sheet name", "sheet dimensions", "every nonempty row and cell", "cell coordinates", "workbook/body SHA-256"],
      chunking: "lossless row-boundary chunks with complete row/interval coverage manifest",
      semanticFiltering: false,
      negativeInferenceAllowed: true,
      parserUnavailable: "invalid_normalization_unreadable",
      chunkOverflow: "add complete chunks; never truncate or use an extraction LLM"
    } : hydration.length ? {
      policy: "REFETCH_AND_RENORMALIZE_RENDERED_DOM",
      parser: "remove script/style/noscript payload nodes before deterministic HTML-to-Markdown",
      audit: "record raw-body hash, semantic-Markdown hash, removed node count and byte count",
      negativeInferenceAllowed: true,
      postHocLineDeletionAllowed: false
    } : {
      policy: "COMPLETE_SEMANTIC_MARKDOWN",
      negativeInferenceAllowed: true
    }
  };
};

module.exports = { hydrationPayloadLines, inspectSourceFormat, isWorkbook, normalizedMime, sourceExtension };

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const policy = require("./source_format_policy.js");

const workbook = policy.inspectSourceFormat({
  url: "https://example.test/list.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  normalization: { extractionMode: "jsdom_node_html_markdown", evidenceText: "PK binary-looking text" }
});
assert.equal(workbook.isWorkbook, true);
assert.deepEqual(workbook.defects, ["BINARY_WORKBOOK_ENTERED_TEXT_OR_HTML_NORMALIZER"]);
assert.equal(workbook.remedy.negativeInferenceAllowed, true);
assert.equal(workbook.remedy.semanticFiltering, false);

const hydrationText = `Visible page\n${JSON.stringify({ pageProps: "x".repeat(100_001) })}`;
const html = policy.inspectSourceFormat({
  url: "https://example.test/provider",
  contentType: "text/html; charset=utf-8",
  normalization: { extractionMode: "jsdom_node_html_markdown", evidenceText: hydrationText }
});
assert.deepEqual(html.defects, ["NON_RENDERED_HYDRATION_PAYLOAD_LEAKED_INTO_MARKDOWN"]);
assert.equal(html.remedy.policy, "REFETCH_AND_RENORMALIZE_RENDERED_DOM");
assert.equal(html.remedy.postHocLineDeletionAllowed, false);

process.stdout.write("source format policy tests passed\n");

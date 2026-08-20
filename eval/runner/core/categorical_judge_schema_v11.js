"use strict";

// Additive no-plan schema-policy correction over the frozen V9 schema.
// factSpanFidelity measures the submitted span against the exact cited
// snapshot. Semantic support for the emitted structured value remains in
// citedSourceSupport/exactSupport; field contract fidelity separately records
// whether a faithful span establishes every material emitted component.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

const PREDECESSOR = path.join(__dirname, "categorical_judge_schema_v9.js");
const PREDECESSOR_SHA256 = "9637df23c6e7068d9443e5e357f290f46c6ffa7babd9188bdb27620d33afe748";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let source = fs.readFileSync(PREDECESSOR, "utf8");
if (sha256(source) !== PREDECESSOR_SHA256) {
  throw new Error("Categorical judge V13 predecessor schema hash mismatch.");
}
const nestedPredecessorBefore =
  'const PREDECESSOR = path.join(__dirname, "categorical_judge_schema_v8.js");';
const nestedPredecessorAfter =
  'const PREDECESSOR = path.join(__dirname, "categorical_judge_schema_v8.js");';
if (source.split(nestedPredecessorBefore).length - 1 !== 1) {
  throw new Error("Categorical judge V13 nested predecessor anchor mismatch.");
}
source = source.replace(nestedPredecessorBefore, nestedPredecessorAfter);

const compileAnchor = "const compiled = new Module(__filename, module);";
if (source.split(compileAnchor).length - 1 !== 1) {
  throw new Error("Categorical judge V13 compile anchor cardinality mismatch.");
}
source = source.replace(compileAnchor, `
replaceOnce(
  '  planNetworkAuthority: z.enum(["preserved", "not_claimed", "overridden_by_ai", "ambiguous"]),\\n',
  '',
  "plan-network assessment removal"
);
replaceOnce(
  '  "PLAN_NETWORK_STATUS_OVERRIDDEN",\\n',
  '',
  "plan-network critical finding removal"
);
replaceOnce(
  '"For phone, address, rating, and specialty, the span must establish the emitted value itself. Treat " +\\n    "punctuation, whitespace, and rendered-Markdown-only differences as exact. Omission of a material address " +\\n    "component present in the emitted value, including ZIP, remains partial."',
  '"Text-to-source fidelity only: compare the supplied factSpan with deliveredContent from its exact cited " +\\n    "snapshot. exact means verbatim or faithfully rendered-equivalent text after punctuation, whitespace, " +\\n    "Unicode typography, and rendered-Markdown normalization. Do not compare the span spelling with the " +\\n    "structured emitted value here; citedSourceSupport and exactSupport own that semantic comparison. A " +\\n    "source-verbatim span remains exact when the structured value faithfully normalizes Street to St or West " +\\n    "Virginia to WV. A source-verbatim span that omits a material emitted component is still fidelity-exact; " +\\n    "record insufficient direct-value coverage in citedSourceSupport, fieldValidity, and contractFidelity."',
  "claim fact-span axis separation"
);
replaceOnce(
  '"Other field spans must establish their emitted candidate value. Treat punctuation, whitespace, and " +\\n    "rendered-Markdown-only differences as exact; omission of a material address component such as ZIP is partial."',
  '"Text-to-source fidelity only: compare the supplied candidate factSpan with deliveredContent from its exact " +\\n    "cited snapshot. exact means verbatim or faithfully rendered-equivalent text after punctuation, whitespace, " +\\n    "Unicode typography, and rendered-Markdown normalization. Structured-value semantic support belongs in " +\\n    "citedSourceSupport and exactSupport. Street versus St and West Virginia versus WV do not make a faithful " +\\n    "source span nonexact. Material direct-value omissions belong in fieldValidity and contractFidelity."',
  "candidate fact-span axis separation"
);
replaceOnce(
  '"on that page. The URL need not appear in factSpan. Other fields use their ordinary direct-value contract."',
  '"on that page. The URL need not appear in factSpan. For other emitted fields, contractFidelity conforms only " +\\n    "when the own source is readable, semantic support is exact, the submitted span is faithful to that source, " +\\n    "and the span establishes every material emitted component under ordinary professional normalization. A " +\\n    "source-faithful span may therefore be factSpanFidelity exact while contractFidelity violates for incomplete " +\\n    "coverage. Street/St and West Virginia/WV are faithful normalizations, not incomplete coverage."',
  "field contract axis separation"
);

${compileAnchor}`);

const compiled = new Module(__filename, module);
compiled.filename = __filename;
compiled.paths = module.paths;
compiled._compile(source, __filename);

module.exports = {
  ...compiled.exports,
  SCHEMA_POLICY_VERSION: "v11-no-plan-source-span-axis-separation",
  PREDECESSOR_PATH: PREDECESSOR,
  PREDECESSOR_SHA256
};

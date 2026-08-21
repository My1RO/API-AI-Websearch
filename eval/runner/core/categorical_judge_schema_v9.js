"use strict";

// Additive schema-policy successor. Keep the proven V8 shape byte-for-byte
// compatible while strengthening descriptions before OpenAI generates the
// native Structured Outputs JSON Schema.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

const PREDECESSOR = path.join(__dirname, "categorical_judge_schema_v8.js");
const PREDECESSOR_SHA256 = "07c0651f9b3f0b0b455dfb32716d969c3c62752de9e6e07b05cb502c1db02c3f";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let source = fs.readFileSync(PREDECESSOR, "utf8");
if (sha256(source) !== PREDECESSOR_SHA256) {
  throw new Error("Categorical judge V9 predecessor schema hash mismatch.");
}

const replaceOnce = (before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Categorical judge V9 ${label} patch cardinality mismatch.`);
  }
  source = source.replace(before, after);
};

replaceOnce(
  '"How readable evidence resolves the exact candidate for the requested NPI. exact_requested_npi and " +\n  "explicit_shared_or_concurrent_use require affirmative evidence; absence of exclusivity is not shared use."',
  '"How readable evidence resolves the exact candidate for the requested NPI. exact_requested_npi and " +\n  "explicit_shared_or_concurrent_use require affirmative evidence; absence of exclusivity is not shared use. " +\n  "A provider-specific first-party page that identifies the exact provider by name and compatible professional " +\n  "location and presents a facility, office, clinic, or scheduling phone in that provider section affirmatively " +\n  "attaches the shared professional phone to the requested provider unless readable evidence establishes " +\n  "exclusivity, a different purpose, or an incompatible operation."',
  "requested-NPI resolution"
);

replaceOnce(
  'exactSupport: z.enum(["exact", "partial", "not_found", "contradicted", "unreadable"]),',
  'exactSupport: z.enum(["exact", "partial", "not_found", "contradicted", "unreadable"]).describe(\n    "Judge semantic support, allowing ordinary professional abbreviations and evidence-backed refinements. " +\n    "PA-C is semantically equivalent to Physician Assistant, and Family may be an evidence-backed shortening " +\n    "of Family Nurse Practitioner. Ratings are source-specific products: different values from different rating " +\n    "sites do not contradict one another. A host-unreadable own citation is unreadable, not contradicted merely " +\n    "because another site reports a different value."\n  ),',
  "factual support"
);

replaceOnce(
  '"For phone, address, rating, and specialty, the span must establish the emitted value itself."',
  '"For phone, address, rating, and specialty, the span must establish the emitted value itself. Treat " +\n    "punctuation, whitespace, and rendered-Markdown-only differences as exact. Omission of a material address " +\n    "component present in the emitted value, including ZIP, remains partial."',
  "claim span fidelity"
);

replaceOnce(
  '"Other field spans must establish their emitted candidate value."',
  '"Other field spans must establish their emitted candidate value. Treat punctuation, whitespace, and " +\n    "rendered-Markdown-only differences as exact; omission of a material address component such as ZIP is partial."',
  "candidate span fidelity"
);

replaceOnce(
  'ratingSourceNeutrality: z.enum(["conforms", "violates", "not_applicable", "indeterminate"]),',
  'ratingSourceNeutrality: z.enum(["conforms", "violates", "not_applicable", "indeterminate"]).describe(\n    "Ratings are source-specific. Different sites may legitimately publish different scores or scales and those " +\n    "values do not contradict one another. Judge each emitted rating only against its own cited rating source; " +\n    "when that source is unreadable, use indeterminate unless the same source is otherwise readably contradicted."\n  ),',
  "rating neutrality"
);

const compiled = new Module(__filename, module);
compiled.filename = __filename;
compiled.paths = module.paths;
compiled._compile(source, __filename);

module.exports = {
  ...compiled.exports,
  SCHEMA_POLICY_VERSION: "v9-corrected-source-specific-semantics",
  PREDECESSOR_PATH: PREDECESSOR,
  PREDECESSOR_SHA256
};

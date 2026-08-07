"use strict";

// Additive clarification over V13. The category set and root output shape are
// unchanged; only citedSourceSupport gains an explicit whole-page definition.
const path = require("node:path");
const predecessor = require(path.join(__dirname,
  "../frozen-v13-r9/categorical_judge_schema_v11_span_semantics.js"));
const { z } = require(path.join(__dirname,
  "../../../API-AI-Websearch/node_modules/zod"));

const CitedSourceSupport = z.enum([
  "exact", "partial", "not_found", "contradicted", "unreadable"
]).describe(
  "Whole-page semantic support for the emitted structured value from the exact cited source snapshot. " +
  "Inspect all deliveredContent for that cited source, not only providerIdentitySpan or factSpan. " +
  "Use exact when the readable page establishes every material emitted component anywhere on the page, " +
  "even if a submitted span is incomplete. Use partial only when the complete readable page itself omits " +
  "a material component. Use not_found only for a complete readable substantive page. A metadata-only, " +
  "challenge, unavailable, or otherwise non-substantive snapshot is unreadable. Span completeness belongs " +
  "only to factSpanFidelity and contractFidelity and must not lower citedSourceSupport."
);

const predecessorRoot = predecessor.CategoricalJudgeSchema;
const predecessorClaim = predecessorRoot.shape.claimAssessments.element;
const ClaimAssessment = predecessorClaim.extend({
  citedSourceSupport: CitedSourceSupport,
  fieldValidity: z.enum(["valid", "partial", "invalid", "not_applicable", "unreadable"])
    .describe(
      "Validity of the emitted structured value itself. Judge the value against readable semantic evidence, " +
      "independently of whether the submitted providerIdentitySpan or factSpan is complete. An incomplete but " +
      "verbatim submitted span does not make an otherwise fully supported emitted value partial."
    )
}).strict();
const CategoricalJudgeSchema = predecessorRoot.extend({
  claimAssessments: z.array(ClaimAssessment)
}).strict();

module.exports = {
  ...predecessor,
  CategoricalJudgeSchema,
  SCHEMA_POLICY_VERSION: "v12-no-plan-whole-page-cited-source-support"
};

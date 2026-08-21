"use strict";

// Bounded-synthesis clarification over the frozen V14 output contract. The
// category sets and public output shape are unchanged. This file only makes
// the already separate whole-packet and own-citation axes unambiguous.
const path = require("node:path");
const predecessor = require("./atomic_judge_schema.js");
const nodeModules = process.env.PROVIDER_EVAL_NODE_MODULES
  || path.resolve(__dirname, "../../../node_modules");
const { z } = require(path.join(nodeModules, "zod"));

const WholePacketExactSupport = z.enum([
  "exact", "partial", "not_found", "contradicted", "unreadable"
]).describe(
  "Whole-packet semantic support for the emitted structured value using all eligible readable evidence " +
  "returned by this arm, not only the claim's own cited source. Use exact when eligible arm-owned evidence " +
  "supports every material emitted component and no stronger applicable evidence contradicts it; partial when " +
  "support omits a material component; not_found when readable relevant arm evidence does not establish the " +
  "value; contradicted when readable applicable arm evidence materially contradicts it; and unreadable only " +
  "when the arm has no readable evidence capable of assessing the value. An unreadable own citation does not " +
  "make exactSupport unreadable when another eligible readable source returned by the same arm assesses the " +
  "value. citedSourceSupport alone owns support from the exact cited source."
);

const predecessorRoot = predecessor.CategoricalJudgeSchema;
const ClaimAssessment = predecessorRoot.shape.claimAssessments.element.extend({
  exactSupport: WholePacketExactSupport
}).strict();
const CandidateDecisionAssessment = predecessorRoot.shape.candidateDecisionAssessments.element.extend({
  exactSupport: WholePacketExactSupport
}).strict();
const CategoricalJudgeSchema = predecessorRoot.extend({
  claimAssessments: z.array(ClaimAssessment),
  candidateDecisionAssessments: z.array(CandidateDecisionAssessment)
}).strict();

module.exports = {
  ...predecessor,
  CategoricalJudgeSchema,
  SCHEMA_POLICY_VERSION: "v13-bounded-synthesis-whole-packet-vs-own-citation"
};

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const atomic = require("./run_atomic_evaluator.js");
const planner = require("./evaluator_packet_planner.js");

const cellsRoot = process.argv[2];
const tokenizerModule = process.argv[3];
const requestedCaseIds = process.argv.slice(4);
if (!cellsRoot || !tokenizerModule) {
  throw new Error("Usage: analyze_evaluator_input_parsimony.js <arm-cells-root> <js-tiktoken-module-dir> [caseId ...]");
}
const { getEncoding } = require(tokenizerModule);
const encoding = getEncoding("o200k_base");
const countTokens = (value) => encoding.encode(value).length;
const measure = (value) => {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return { bytes: Buffer.byteLength(serialized), tokens: countTokens(serialized) };
};
const stripContent = (source) => {
  const result = { ...source };
  delete result.deliveredContent;
  return result;
};
const parseLockedInput = (request) => {
  const marker = "Locked candidate-local positional evidence: ";
  const index = request.input.indexOf(marker);
  if (index < 0) throw new Error("Legacy request lacks the locked packet marker.");
  return JSON.parse(request.input.slice(index + marker.length));
};
const priorAtomicInput = (packet, plannedRequest) => ({
  schemaVersion: 1,
  identityContext: packet.identityContext,
  claims: packet.claims.map((claim, claimIndex) => ({ claimIndex, fieldType: claim.fieldType,
    value: claim.value, citedSourceId: claim.sourceId, modelCitation: claim.modelCitation })),
  candidates: (packet.preSanitizerCandidates || []).map((candidate, candidateIndex) => ({
    candidateIndex, fieldType: candidate.fieldType, value: candidate.value,
    citedSourceId: candidate.sourceId, modelCitation: candidate.modelCitation,
    sanitizerActionObserved: candidate.sanitizerActionObserved,
    sanitizerReasonCode: candidate.sanitizerReasonCode
  })),
  sourceChunks: plannedRequest.units.map((unit, chunkIndex) => ({
    chunkIndex, sourceIndex: unit.sourceIndex, canonicalUrl: planner.canonicalUrl(unit.sourceUrl),
    host: (() => { try { return new URL(unit.sourceUrl).hostname.toLowerCase(); } catch { return null; } })(),
    roles: unit.sourceRoles,
    absoluteCoreRange: [unit.coreStart, unit.coreEnd],
    absoluteDeliveredRange: [unit.deliveredStart, unit.deliveredEnd],
    sourceTextSha256: unit.sourceTextSha256,
    deliveredTextSha256: unit.deliveredTextSha256,
    deliveredContent: unit.deliveredContent
  }))
});

const defaultCases = ["H003", "H005", "H035", "H037", "H038", "H057", "H001", "H002"];
const caseIds = requestedCaseIds.length ? requestedCaseIds : defaultCases;
const rows = [];
for (const caseId of caseIds) {
  const dir = path.join(cellsRoot, caseId);
  const files = Object.fromEntries(["packet", "request", "preflight"].map((name) =>
    [name, path.join(dir, `${name}.json`)]));
  if (Object.values(files).some((file) => !fs.existsSync(file))) throw new Error(`Missing real artifact for ${caseId}.`);
  const packet = JSON.parse(fs.readFileSync(files.packet, "utf8"));
  const request = JSON.parse(fs.readFileSync(files.request, "utf8"));
  const preflight = JSON.parse(fs.readFileSync(files.preflight, "utf8"));
  const locked = parseLockedInput(request);
  const sourceContent = locked.sources.map((source) => source.deliveredContent || "");
  const sourceContentRows = locked.sources.map((source, sourceIndex) => ({
    sourceIndex,
    url: source.literalUrl || source.url,
    ...measure(source.deliveredContent || "")
  })).sort((left, right) => right.tokens - left.tokens || left.sourceIndex - right.sourceIndex);
  const plan = atomic.buildAtomicPlan(packet, { countTokens });
  const priorAtomicPayloads = plan.requests.map((requestRow) => measure(priorAtomicInput(packet, requestRow)));
  const currentAtomicPayloads = plan.requests.map((requestRow) => measure(requestRow.input));
  rows.push({
    caseId,
    artifactDirectory: dir,
    legacy: {
      failureCode: preflight.failureCode || null,
      completeRequest: measure(request),
      preflightTokens: preflight.localEncodedTokens,
      instructions: measure(request.instructions),
      inputEnvelope: measure(request.input),
      identityContext: measure(locked.identityContext),
      actionTrace: measure(locked.actionTrace),
      evaluationControls: measure({ guidance: locked.evaluationGuidance, gate: locked.evaluationGate }),
      factsAndFields: measure({ claims: locked.claims, candidates: locked.candidates, fields: locked.fields }),
      sourceDescriptors: measure(locked.sources.map(stripContent)),
      sourceContent: measure(sourceContent),
      largestSourceContents: sourceContentRows.slice(0, 5)
    },
    atomic: {
      requestCount: plan.requestCount,
      maximumRequestTokens: plan.maximumRequestTokens,
      totalRequestTokens: plan.requests.reduce((sum, item) => sum + item.requestTokens, 0),
      priorInputPayloadTokens: {
        maximum: Math.max(0, ...priorAtomicPayloads.map((item) => item.tokens)),
        total: priorAtomicPayloads.reduce((sum, item) => sum + item.tokens, 0)
      },
      currentInputPayloadTokens: {
        maximum: Math.max(0, ...currentAtomicPayloads.map((item) => item.tokens)),
        total: currentAtomicPayloads.reduce((sum, item) => sum + item.tokens, 0)
      },
      contextOverflowCount: plan.contextOverflowCount,
      invalidNormalizations: plan.invalidNormalizations,
      uniqueFactTargetCount: plan.uniqueFactTargetCount,
      intendedSourceByUniqueFactComparisonCount: plan.intendedSourceByUniqueFactComparisonCount,
      plannedSourceByUniqueFactComparisonCount: plan.plannedSourceByUniqueFactComparisonCount,
      sourceByUniqueFactComparisonMatrixComplete: plan.sourceByUniqueFactComparisonMatrixComplete,
      maximumRequestSections: [...plan.requests]
        .sort((left, right) => right.requestTokens - left.requestTokens)[0]?.sectionMetrics || null
    }
  });
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, tokenizer: "o200k_base", rows }, null, 2)}\n`);

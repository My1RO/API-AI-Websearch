#!/usr/bin/env node
"use strict";

// Offline-only compiler view for two historical runner/compiler interface
// mismatches. The unified runner admits explicit manualReview.triggerFiles,
// while the frozen compiler discovers only automatic/consistency triggers.
// Historical production traces also wrap the Azure body at request.body.
// Neither adaptation mutates a production, evidence, judge, or manual artifact.

const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const manifestFile = path.resolve(process.argv[2] || "");
const outputRoot = path.resolve(process.argv[3] || "");
assert(manifestFile && fs.existsSync(manifestFile) && outputRoot,
  "Usage: compile_explicit_manual_transport_compat.js manifest.json output-root");
assert(!fs.existsSync(outputRoot) || fs.readdirSync(outputRoot).length === 0,
  `Compatibility output root must be absent or empty: ${outputRoot}`);

const compilerFile = path.join(__dirname, "compile_corrected_campaign.js");
const originalSource = fs.readFileSync(compilerFile, "utf8");
const patchAnchor = "  const known = new Set(caseIds); const cases = new Map();\n  const add = (caseId, reason) => {";
assert(originalSource.split(patchAnchor).length - 1 === 1,
  "Frozen compiler manual-trigger patch anchor changed.");
const patchText = "  const known = new Set(caseIds); const cases = new Map();\n  const add = (caseId, reason) => {";
const loopAnchor = "  for (const root of [config.paths.atomicRoot, config.paths.synthesisRoot]) {";
assert(originalSource.split(loopAnchor).length - 1 === 1,
  "Frozen compiler automatic-trigger loop anchor changed.");
const injectedLoop = [
  "  for (const file of config.__explicitManualTriggerFiles || []) {",
  "    const artifact = reader.read(file);",
  "    assert(artifact.status === 'EVALUATOR_MANUAL_REVIEW_REQUIRED',",
  "      `Explicit manual trigger ${file} has invalid status.`);",
  "    for (const row of artifact.cells || []) {",
  "      assert(expectedArms.includes(row.armId), `Explicit manual trigger names unknown arm ${row.armId}.`);",
  "      const reasons = row.reasons || [row.reason];",
  "      for (const reason of reasons.filter(Boolean)) add(row.caseId,",
  "        typeof reason === 'string' ? reason : reason.reason);",
  "    }",
  "    for (const caseId of artifact.caseIds || []) {",
  "      assert(cases.has(caseId), `Explicit manual trigger case ${caseId} lacks a deterministic reason.`);",
  "    }",
  "  }",
  loopAnchor
].join("\n");
const adaptedSource = originalSource.replace(loopAnchor, injectedLoop);
const compiledModule = new Module(compilerFile, module);
compiledModule.filename = compilerFile;
compiledModule.paths = Module._nodeModulePaths(path.dirname(compilerFile));
compiledModule._compile(adaptedSource, compilerFile);
const compiler = compiledModule.exports;

const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const base = path.dirname(manifestFile);
raw.__explicitManualTriggerFiles = (raw.manualReview?.triggerFiles || []).map((file) =>
  path.isAbsolute(file) ? path.normalize(file) : path.resolve(base, file));
const config = compiler.normalizeConfig(raw, manifestFile, outputRoot);
const baseReader = compiler.createAuditedReader();
const transformed = [];
const read = (file, required = true) => {
  const value = baseReader.read(file, required);
  if (!value || path.basename(file) !== "artifact.json" || !Array.isArray(value.sends)) return value;
  let changed = false;
  const captures = [];
  value.sends = value.sends.map((send, sendIndex) => {
    const envelope = send?.request;
    if (!envelope || !envelope.body || typeof envelope.body !== "object" || Array.isArray(envelope.body)) return send;
    assert(envelope.method === "POST", `${file} send ${sendIndex + 1} is not a captured POST.`);
    assert(envelope.url === config.productionEndpoint,
      `${file} send ${sendIndex + 1} captured endpoint differs.`);
    const serialized = JSON.stringify(envelope.body);
    const bodySha256 = sha256(serialized);
    const bodyBytes = Buffer.byteLength(serialized);
    if (envelope.bodySha256 != null) assert(envelope.bodySha256 === bodySha256,
      `${file} send ${sendIndex + 1} captured body SHA-256 differs.`);
    if (envelope.bodyBytes != null) assert(envelope.bodyBytes === bodyBytes,
      `${file} send ${sendIndex + 1} captured body byte length differs.`);
    changed = true;
    captures.push({ sendIndex, method: envelope.method, url: envelope.url, bodySha256, bodyBytes });
    return { ...send, request: envelope.body, url: envelope.url };
  });
  if (changed) {
    const descriptor = baseReader.descriptors.get(path.resolve(file));
    transformed.push({ path: path.resolve(file), originalArtifactSha256: descriptor.sha256,
      originalArtifactByteLength: descriptor.byteLength, captures });
  }
  return value;
};
const reader = { read, audit: baseReader.audit, descriptors: baseReader.descriptors };
const result = compiler.compile(config, reader);
const completion = compiler.emit(config, result, reader, manifestFile);
const compatibility = {
  schemaVersion: 1,
  status: "OFFLINE_EXPLICIT_MANUAL_AND_TRANSPORT_COMPATIBILITY_COMPILE",
  networkCallsMade: 0, paidCallsMade: 0, inputArtifactsMutated: false,
  sealedEvaluatorAuthorityClaim: false,
  compilerSourceSha256: sha256(originalSource),
  explicitManualTriggerFiles: raw.__explicitManualTriggerFiles.map((file) => ({
    path: file, sha256: sha256(fs.readFileSync(file)), byteLength: fs.statSync(file).size
  })),
  transportEnvelopeTransformations: transformed.sort((a, b) => a.path.localeCompare(b.path)),
  compilerCompletion: completion
};
fs.writeFileSync(path.join(outputRoot, "OFFLINE_COMPATIBILITY_COMPILE.json"),
  `${JSON.stringify(compatibility, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, "OFFLINE_COMPATIBILITY_COMPILE.md"), [
  "# Offline explicit-manual and transport compatibility compile", "",
  "This compiler view made zero network or paid model calls and mutated no input artifact.",
  "It does not claim to be a compile by the historical sealed evaluator authority.", "",
  "It bridges two runner/compiler interface mismatches only:",
  "1. `manualReview.triggerFiles`, already admitted and consumed by the unified manual harness, are also presented to the compiler.",
  "2. Historical `sends[i].request.body` payloads are presented as `sends[i].request` after verifying URL, body hash, and byte length.", "",
  "All original artifact paths, hashes, and byte lengths remain in the compiler evidence manifest and compatibility ledger.", ""
].join("\n"));
process.stdout.write(`${JSON.stringify(compatibility, null, 2)}\n`);

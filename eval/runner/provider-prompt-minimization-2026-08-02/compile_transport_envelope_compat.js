#!/usr/bin/env node
"use strict";

// Offline-only compatibility adapter for immutable production artifacts whose
// HTTP trace stores the Azure JSON payload at sends[].request.body. It does not
// alter source files, evaluator judgments, or the sealed evaluator authority.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const compiler = require("./compile_corrected_campaign.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const manifestFile = path.resolve(process.argv[2] || "");
assert(manifestFile && fs.existsSync(manifestFile),
  "Usage: compile_transport_envelope_compat.js manifest.json [output-root]");
const outputRoot = path.resolve(process.argv[3]
  || "/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/compact25-individual-location-hard-gate-development-pilot-analysis-transport-compat-v1");
assert(!fs.existsSync(outputRoot) || fs.readdirSync(outputRoot).length === 0,
  `Compatibility output root must be absent or empty: ${outputRoot}`);

const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const config = compiler.normalizeConfig(raw, manifestFile, outputRoot);
const base = compiler.createAuditedReader();
const transformed = [];
const read = (file, required = true) => {
  const value = base.read(file, required);
  if (!value || path.basename(file) !== "artifact.json" || !Array.isArray(value.sends)) return value;
  let changed = false;
  const captures = [];
  value.sends = value.sends.map((send, sendIndex) => {
    const envelope = send?.request;
    if (!envelope || !envelope.body || typeof envelope.body !== "object" || Array.isArray(envelope.body)) return send;
    assert(envelope.method === "POST", `${file} send ${sendIndex + 1} is not a captured POST.`);
    assert(typeof envelope.url === "string" && envelope.url === config.productionEndpoint,
      `${file} send ${sendIndex + 1} captured endpoint differs.`);
    const serialized = JSON.stringify(envelope.body);
    const observedSha256 = sha256(serialized);
    const observedBytes = Buffer.byteLength(serialized);
    if (envelope.bodySha256 != null) assert(envelope.bodySha256 === observedSha256,
      `${file} send ${sendIndex + 1} captured body SHA-256 differs.`);
    if (envelope.bodyBytes != null) assert(envelope.bodyBytes === observedBytes,
      `${file} send ${sendIndex + 1} captured body byte length differs.`);
    changed = true;
    captures.push({ sendIndex, method: envelope.method, url: envelope.url,
      bodySha256: observedSha256, bodyBytes: observedBytes });
    return { ...send, request: envelope.body, url: envelope.url };
  });
  if (changed) {
    const descriptor = base.descriptors.get(path.resolve(file));
    transformed.push({ path: path.resolve(file), originalArtifactSha256: descriptor.sha256,
      originalArtifactByteLength: descriptor.byteLength, captures });
  }
  return value;
};
const reader = { read, audit: base.audit, descriptors: base.descriptors };
const compiled = compiler.compile(config, reader);
const completion = compiler.emit(config, compiled, reader, manifestFile);

const transformation = {
  schemaVersion: 1,
  status: "OFFLINE_TRANSPORT_COMPATIBILITY_COMPILE",
  networkCallsMade: 0,
  paidCallsMade: 0,
  sealedEvaluatorAuthorityClaim: false,
  inputArtifactsMutated: false,
  originalArtifactHashesPreservedInCompilerEvidenceManifest: true,
  soleTransformation: {
    match: "production artifact sends[i].request = {method, url, body, bodySha256, bodyBytes, ...}",
    compilerView: "sends[i].request = original sends[i].request.body; sends[i].url = original sends[i].request.url",
    untouched: ["expectedRequests", "responses", "usage", "profiles", "judgments", "source snapshots"]
  },
  transformedArtifactCount: transformed.length,
  transformedArtifacts: transformed.sort((a, b) => a.path.localeCompare(b.path)),
  compilerCompletion: completion
};
fs.writeFileSync(path.join(outputRoot, "OFFLINE_COMPATIBILITY_COMPILE.json"),
  `${JSON.stringify(transformation, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, "OFFLINE_COMPATIBILITY_COMPILE.md"), [
  "# Offline transport-envelope compatibility compile",
  "",
  "This is not represented as a compile by the historical sealed evaluator authority.",
  "It made zero network or paid model calls and did not mutate any input artifact.",
  "",
  "The sole compatibility transformation was a lossless view change for production HTTP traces:",
  "`sends[i].request.body` was presented to the historical compiler as `sends[i].request`, and",
  "`sends[i].request.url` was presented as `sends[i].url`. Captured body hashes and byte lengths",
  "were verified before compilation. All original artifact hashes remain in the compiler evidence manifest",
  "and are listed in `OFFLINE_COMPATIBILITY_COMPILE.json`.",
  ""
].join("\n"));
process.stdout.write(`${JSON.stringify(transformation, null, 2)}\n`);

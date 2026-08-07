#!/usr/bin/env node
"use strict";

// Lossless adapter from the production runner's transport-capture envelope to
// the older compiler's direct Responses-request surface. Originals are never
// modified; every input/output artifact is SHA-bound in an audit manifest.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const INPUT_ROOT = path.resolve(process.env.INPUT_ROOT || "");
const OUTPUT_ROOT = path.resolve(process.env.OUTPUT_ROOT || "");
if (!process.env.INPUT_ROOT || !process.env.OUTPUT_ROOT || !fs.existsSync(INPUT_ROOT)) {
  throw new Error("INPUT_ROOT and fresh OUTPUT_ROOT are required.");
}
if (fs.existsSync(OUTPUT_ROOT)) throw new Error("OUTPUT_ROOT must be fresh.");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const stableKeys = (value) => JSON.stringify(Object.keys(value || {}).sort());
const expectedEnvelopeKeys = JSON.stringify([
  "body", "bodyBytes", "bodySha256", "headers", "method", "url"
].sort());
const rows = [];

for (const armId of fs.readdirSync(path.join(INPUT_ROOT, "cells")).sort()) {
  const armRoot = path.join(INPUT_ROOT, "cells", armId);
  if (!fs.statSync(armRoot).isDirectory()) continue;
  for (const caseId of fs.readdirSync(armRoot).sort()) {
    const inputFile = path.join(armRoot, caseId, "artifact.json");
    if (!fs.existsSync(inputFile)) continue;
    const inputBytes = fs.readFileSync(inputFile);
    const artifact = JSON.parse(inputBytes);
    const envelopes = [];
    artifact.sends = artifact.sends.map((send, sendIndex) => {
      const envelope = send.request;
      if (stableKeys(envelope) !== expectedEnvelopeKeys) {
        throw new Error(`${armId}/${caseId} send ${sendIndex + 1} is not the exact transport envelope.`);
      }
      const serialized = JSON.stringify(envelope.body);
      if (envelope.method !== "POST" || !/^https:\/\/[^/]+\/openai\/v1\/responses$/.test(envelope.url)
        || envelope.bodyBytes !== Buffer.byteLength(serialized)
        || envelope.bodySha256 !== sha256(serialized)) {
        throw new Error(`${armId}/${caseId} send ${sendIndex + 1} transport integrity check failed.`);
      }
      envelopes.push(envelope);
      return { ...send, url: envelope.url, request: envelope.body };
    });
    artifact.transportCaptureAudit = {
      schemaVersion: 1,
      sourceArtifactSha256: sha256(inputBytes),
      adaptation: "verified_transport_envelope_body_projection",
      originalRequests: envelopes
    };
    const outputFile = path.join(OUTPUT_ROOT, "cells", armId, caseId, "artifact.json");
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    const outputBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
    fs.writeFileSync(outputFile, outputBytes, { flag: "wx" });
    rows.push({ armId, caseId, inputFile, inputSha256: sha256(inputBytes),
      outputFile, outputSha256: sha256(outputBytes), sends: envelopes.length });
  }
}

const audit = { schemaVersion: 1, status: "TRANSPORT_CAPTURE_COMPILER_VIEW_READY",
  inputRoot: INPUT_ROOT, outputRoot: OUTPUT_ROOT, artifacts: rows.length,
  adaptation: "request={method,url,headers,body,bodyBytes,bodySha256} -> request=body; send.url=url",
  semanticFieldsChanged: false, rows };
audit.sealSha256 = sha256(JSON.stringify(audit));
fs.writeFileSync(path.join(OUTPUT_ROOT, "TRANSPORT_CAPTURE_ADAPTER_AUDIT.json"),
  `${JSON.stringify(audit, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: audit.status, artifacts: rows.length,
  sealSha256: audit.sealSha256 }, null, 2)}\n`);

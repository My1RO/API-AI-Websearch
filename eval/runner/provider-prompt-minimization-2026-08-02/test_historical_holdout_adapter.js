#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const adapter = require("./historical_holdout_adapter.js");

assert.deepEqual(adapter.providerFromWireInput("Header\nProviders: [{\"npi\":\"1234567890\"}]"),
  { npi: "1234567890" });
assert.throws(() => adapter.providerFromWireInput("no provider marker"), /Providers marker/);
assert.deepEqual(adapter.orderedRawResponses({ semanticAttempts: [
  { semanticAttempt: 2, httpSends: [{ sendIndex: 2, rawResponse: { id: "second" } }] },
  { semanticAttempt: 1, httpSends: [{ sendIndex: 1, rawResponse: { id: "first" } }] }
] }).map((row) => row.id), ["first", "second"]);

const manifest = adapter.buildCombinedManifest();
assert.equal(manifest.manifestSha256, "5620ff66ab0f14d7ab53cce51bc0a0262243444dbe2b75a2b4e63b8a535581e5");
assert.equal(manifest.dryRunOnly, true);
assert.equal(manifest.sourceMutation, false);
assert.equal(manifest.paidCallsMade, 0);
assert.equal(manifest.rows.length, 180);
assert.deepEqual(manifest.arms, ["D36", "SUCCESSOR", "CANDIDATE72"]);
assert.deepEqual(manifest.caseIds, Array.from({ length: 60 }, (_, index) =>
  `H${String(index + 1).padStart(3, "0")}`));
assert.deepEqual(manifest.emptyPacketReconstructions, ["SUCCESSOR/H006", "SUCCESSOR/H027"]);
for (const armId of manifest.arms) assert.equal(manifest.rows.filter((row) => row.armId === armId).length, 60);
for (const caseId of manifest.caseIds) {
  const rows = manifest.rows.filter((row) => row.caseId === caseId);
  assert.equal(new Set(rows.map((row) => row.requestSha256)).size, 1);
  assert.equal(new Set(rows.map((row) => row.fixedContextSha256)).size, 1);
}

const preregistration = JSON.parse(fs.readFileSync(adapter.PATHS.preregistration, "utf8"));
const h010 = preregistration.cases.find((row) => row.caseId === "H010");
const preregistrationDescriptor = { path: adapter.PATHS.preregistration,
  sha256: require("node:crypto").createHash("sha256")
    .update(fs.readFileSync(adapter.PATHS.preregistration)).digest("hex"),
  byteLength: fs.statSync(adapter.PATHS.preregistration).size };
const adaptedH010 = adapter.adaptFullCase({ caseId: "H010", preregisteredCase: h010,
  preregistrationDescriptor });
assert.equal(adaptedH010.artifact.rawResponses.length, 2);
assert.equal(adaptedH010.artifact.rawResponses[0].status, "incomplete");
assert.equal(adaptedH010.artifact.rawResponses[0].incomplete_details.reason, "content_filter");
assert.equal(adaptedH010.artifact.rawResponses[1].status, "completed");
assert.equal(adaptedH010.artifact.adaptation.policy,
  "read_only_shape_adapter_no_reparse_no_resanitize_no_source_mutation");

const sourceHashBefore = preregistrationDescriptor.sha256;
const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "historical-holdout-adapter-"));
const materializedRoot = path.join(temporaryParent, "derived");
const materialized = adapter.materializeDerivedOutput(materializedRoot);
assert.equal(materialized.manifest.rows.length, 180);
assert.equal(materialized.manifest.rows.filter((row) => row.armId === "D36").length, 60);
assert.equal(fs.existsSync(path.join(materializedRoot, "cells", "D36", "H010", "artifact.json")), true);
assert.equal(fs.existsSync(path.join(materializedRoot, "cells", "D36", "H010", "binding-seal.json")), true);
assert.equal(JSON.parse(fs.readFileSync(path.join(materializedRoot, "ADAPTER_READY.json"), "utf8"))
  .paidCallsMade, 0);
assert.equal(require("node:crypto").createHash("sha256")
  .update(fs.readFileSync(adapter.PATHS.preregistration)).digest("hex"), sourceHashBefore);
fs.rmSync(temporaryParent, { recursive: true, force: true });

const denied = spawnSync(process.execPath, [path.join(__dirname, "historical_holdout_adapter.js")], {
  env: { ...process.env, DRY_RUN: "0" }, encoding: "utf8"
});
assert.notEqual(denied.status, 0);
assert.match(denied.stderr, /intentionally dry-run-only/);

process.stdout.write("historical holdout adapter tests passed\n");

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { audit } = require("./audit_identical_input_consistency.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "identical-input-audit-"));
try {
  const packetRoot = path.join(root, "packets");
  const synthesisRoot = path.join(root, "synthesis");
  const source = { sourceId: "s0", bodySha256: "a".repeat(64), hostReadStatus: "read",
    snapshotCoverage: "full_normalized_snapshot", normalizationFormat: "rendered_semantic_markdown_v4" };
  const claim = { fieldType: "phone", value: "212-555-0100", sourceId: "s0",
    modelCitation: { providerIdentitySpan: "NPI 1234567890", factSpan: "212-555-0100",
      explicitFactDateSpan: null } };
  for (const [armId, citedSourceSupport] of [["A", "exact"], ["B", "partial"]]) {
    const packetDir = path.join(packetRoot, armId, "P001");
    const synthesisDir = path.join(synthesisRoot, "cells", armId, "P001");
    fs.mkdirSync(packetDir, { recursive: true }); fs.mkdirSync(synthesisDir, { recursive: true });
    const armClaim = armId === "B" ? { ...claim, value: "(212) 555-0100" } : claim;
    fs.writeFileSync(path.join(packetDir, "packet.json"), JSON.stringify({ claims: [armClaim], sources: [source] }));
    fs.writeFileSync(path.join(synthesisDir, "parsed-v14.json"), JSON.stringify({ claimAssessments: [{
      citedSourceSupport, providerIdentitySpanFidelity: "exact", factSpanFidelity: "exact",
      explicitDateSpanFidelity: "no_date_claimed"
    }] }));
  }
  const result = audit({ packetRoot, synthesisRoot });
  assert.deepEqual(result.disagreementCaseIds, ["P001"]);
  assert.equal(result.disagreements.length, 1);
  assert.deepEqual(result.disagreements[0].axes, ["citedSourceSupport"]);
  assert.equal(result.cells.length, 2);
  const second = JSON.parse(fs.readFileSync(path.join(synthesisRoot, "cells", "B", "P001", "parsed-v14.json")));
  second.claimAssessments[0].citedSourceSupport = "exact";
  fs.writeFileSync(path.join(synthesisRoot, "cells", "B", "P001", "parsed-v14.json"), JSON.stringify(second));
  assert.deepEqual(audit({ packetRoot, synthesisRoot }).disagreementCaseIds, []);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("identical input consistency audit tests passed\n");

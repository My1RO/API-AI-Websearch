#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const verifier = require("../core/verify_campaign.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const expectedArms = ["ARM_A", "ARM_B"];
const expectedCases = ["P001", "P002", "P003"];
const requiredEmptyCases = ["ARM_B/P002"];

assert.deepEqual(verifier.expectedCasesFromEnvironment({
  EXPECTED_CASE_PREFIX: "P", EXPECTED_CASES_PER_ARM: "3",
  EXPECTED_CASE_IDS: "P001,P002,P003"
}), expectedCases);
assert.throws(() => verifier.expectedCasesFromEnvironment({
  EXPECTED_CASE_PREFIX: "P", EXPECTED_CASES_PER_ARM: "3",
  EXPECTED_CASE_IDS: "P001,P002,P002"
}), /declared number of unique case IDs/);

const identityContext = (caseId) => ({
  request: { npi: `1${caseId.slice(1).padStart(9, "0")}`, name: caseId },
  cmsBaseline: { caseId },
  nppesIdentity: { npi: caseId, entityType: "individual" }
});
const root = fs.mkdtempSync(path.join(os.tmpdir(), "campaign-verifier-test-"));
try {
  for (const armId of expectedArms) {
    for (const caseId of expectedCases) {
      const empty = requiredEmptyCases.includes(`${armId}/${caseId}`);
      const packet = {
        caseId,
        identityContext: identityContext(caseId),
        claims: [],
        preSanitizerCandidates: [],
        finalSanitizedProfiles: [],
        rawStructuredProfiles: [],
        evaluationGate: empty ? {
          traceClassification: "parser_or_contract_failure",
          productionOutcome: "empty_profile_after_parser_or_contract_failure"
        } : null,
        packetV4Bindings: {
          zeroInvalidNormalizations: true,
          sourceIdsPreserved: true,
          sourceMappingOneToOne: true
        }
      };
      packet.packetSha256 = sha256(JSON.stringify(packet));
      const directory = path.join(root, armId, caseId);
      fs.mkdirSync(directory, { recursive: true });
      const packetFile = path.join(directory, "packet.json");
      fs.writeFileSync(packetFile, `${JSON.stringify(packet)}\n`);
      fs.writeFileSync(path.join(directory, "binding-seal.json"), JSON.stringify({
        materializedPacketSha256: sha256(fs.readFileSync(packetFile))
      }));
    }
    fs.mkdirSync(path.join(root, "summaries"), { recursive: true });
    fs.writeFileSync(path.join(root, "summaries", `${armId}.json`),
      JSON.stringify({ evaluablePackets: expectedCases.length }));
  }

  assert.throws(() => verifier.verifyPostRefetchCampaign({ packetRoot: root }),
    /expectedArms must contain/);
  const result = verifier.verifyPostRefetchCampaign({
    packetRoot: root, expectedArms, expectedCases, requiredEmptyCases
  });
  assert.equal(result.cells, expectedArms.length * expectedCases.length);
  assert.deepEqual(result.requiredEmptyCases, requiredEmptyCases);

  const tampered = path.join(root, expectedArms[0], expectedCases[0], "packet.json");
  fs.appendFileSync(tampered, " ");
  assert.throws(() => verifier.verifyPostRefetchCampaign({
    packetRoot: root, expectedArms, expectedCases, requiredEmptyCases
  }), /binding seal/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("campaign verifier tests passed\n");

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const verifier = require("./verify_post_refetch_campaign.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "post-refetch-campaign-"));
try {
  assert.deepEqual(verifier.expectedCasesFromEnvironment({
    EXPECTED_CASE_PREFIX: "P", EXPECTED_CASES_PER_ARM: "3",
    EXPECTED_CASE_IDS: "P002,P024,P056"
  }), ["P002", "P024", "P056"]);
  assert.throws(() => verifier.expectedCasesFromEnvironment({
    EXPECTED_CASE_PREFIX: "P", EXPECTED_CASES_PER_ARM: "3",
    EXPECTED_CASE_IDS: "P002,P024,P024"
  }), /declared number of unique case IDs/);
  const identityContext = (caseId) => ({ request: { npi: `1${caseId.slice(1).padStart(9, "0")}`, name: caseId },
    cmsBaseline: { caseId }, nppesIdentity: { npi: caseId, entityType: "individual" } });
  for (const armId of verifier.EXPECTED_ARMS) {
    for (const caseId of verifier.EXPECTED_CASES) {
      const empty = armId === "SUCCESSOR" && ["H006", "H027"].includes(caseId);
      const packet = { caseId, identityContext: identityContext(caseId), claims: [],
        preSanitizerCandidates: [], finalSanitizedProfiles: [], rawStructuredProfiles: [],
        evaluationGate: empty ? { traceClassification: "parser_or_contract_failure",
          productionOutcome: "empty_profile_after_parser_or_contract_failure" } : null,
        packetV4Bindings: { zeroInvalidNormalizations: true, sourceIdsPreserved: true,
          sourceMappingOneToOne: true } };
      packet.packetSha256 = sha256(JSON.stringify(packet));
      const dir = path.join(root, armId, caseId);
      fs.mkdirSync(dir, { recursive: true });
      const packetFile = path.join(dir, "packet.json");
      fs.writeFileSync(packetFile, `${JSON.stringify(packet)}\n`);
      fs.writeFileSync(path.join(dir, "binding-seal.json"), JSON.stringify({
        materializedPacketSha256: sha256(fs.readFileSync(packetFile))
      }));
    }
    fs.mkdirSync(path.join(root, "summaries"), { recursive: true });
    fs.writeFileSync(path.join(root, "summaries", `${armId}.json`), JSON.stringify({ evaluablePackets: 60 }));
  }
  const result = verifier.verifyPostRefetchCampaign({ packetRoot: root });
  assert.equal(result.cells, 180);
  assert.deepEqual(result.reconstructedEmptySuccessorCases, ["H006", "H027"]);

  const genericRoot = fs.mkdtempSync(path.join(os.tmpdir(), "post-refetch-generic-"));
  try {
    for (const armId of ["A", "B"]) {
      for (const caseId of ["P001", "P002"]) {
        const packet = { caseId, identityContext: identityContext(caseId), claims: [],
          preSanitizerCandidates: [], finalSanitizedProfiles: [], rawStructuredProfiles: [],
          evaluationGate: null, packetV4Bindings: { zeroInvalidNormalizations: true,
            sourceIdsPreserved: true, sourceMappingOneToOne: true } };
        packet.packetSha256 = sha256(JSON.stringify(packet));
        const dir = path.join(genericRoot, armId, caseId);
        fs.mkdirSync(dir, { recursive: true });
        const packetFile = path.join(dir, "packet.json");
        fs.writeFileSync(packetFile, `${JSON.stringify(packet)}\n`);
        fs.writeFileSync(path.join(dir, "binding-seal.json"), JSON.stringify({
          materializedPacketSha256: sha256(fs.readFileSync(packetFile))
        }));
      }
      fs.mkdirSync(path.join(genericRoot, "summaries"), { recursive: true });
      fs.writeFileSync(path.join(genericRoot, "summaries", `${armId}.json`),
        JSON.stringify({ evaluablePackets: 2 }));
    }
    const generic = verifier.verifyPostRefetchCampaign({ packetRoot: genericRoot,
      expectedArms: ["A", "B"], expectedCases: ["P001", "P002"], requiredEmptyCases: [] });
    assert.equal(generic.cells, 4);
    assert.deepEqual(generic.requiredEmptyCases, []);
  } finally {
    fs.rmSync(genericRoot, { recursive: true, force: true });
  }
  const tampered = path.join(root, "D36", "H001", "packet.json");
  fs.appendFileSync(tampered, " ");
  assert.throws(() => verifier.verifyPostRefetchCampaign({ packetRoot: root }), /binding seal/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("post-refetch campaign verifier tests passed\n");

#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const EXPECTED_CASES = Object.freeze(Array.from({ length: 60 }, (_, index) =>
  `P${String(index + 1).padStart(3, "0")}`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fileSha256 = (file) => sha256(fs.readFileSync(file));
const expectedCasesFromEnvironment = (environment = process.env) => {
  const casePrefix = environment.EXPECTED_CASE_PREFIX || "P";
  const expectedCaseCount = Number(environment.EXPECTED_CASES_PER_ARM || 60);
  if (!/^[A-Z]$/.test(casePrefix) || !Number.isSafeInteger(expectedCaseCount) || expectedCaseCount < 1) {
    throw new Error("EXPECTED_CASE_PREFIX and EXPECTED_CASES_PER_ARM are invalid.");
  }
  const explicitCaseIds = environment.EXPECTED_CASE_IDS
    ? environment.EXPECTED_CASE_IDS.split(",").map((value) => value.trim()).filter(Boolean) : null;
  if (explicitCaseIds && (explicitCaseIds.length !== expectedCaseCount
    || new Set(explicitCaseIds).size !== explicitCaseIds.length)) {
    throw new Error("EXPECTED_CASE_IDS must contain the declared number of unique case IDs.");
  }
  return explicitCaseIds || Array.from({ length: expectedCaseCount }, (_, index) =>
    `${casePrefix}${String(index + 1).padStart(3, "0")}`);
};

const verifyPostRefetchCampaign = ({ packetRoot, expectedArms,
  expectedCases = EXPECTED_CASES, requiredEmptyCases = [],
  expectedAuthoritySha256 = process.env.EXPECTED_RUNNER_AUTHORITY_SHA256 || null }) => {
  if (!Array.isArray(expectedArms) || !expectedArms.length || new Set(expectedArms).size !== expectedArms.length) {
    throw new Error("expectedArms must contain at least one unique arm ID.");
  }
  const root = path.resolve(packetRoot);
  if (!fs.existsSync(root)) throw new Error("Packet root does not exist.");
  const arms = fs.readdirSync(root).filter((name) => name !== "summaries"
    && fs.statSync(path.join(root, name)).isDirectory()).sort();
  if (stableJson(arms) !== stableJson([...expectedArms].sort())) throw new Error("Exact packet arm set mismatch.");
  const rows = [];
  for (const armId of expectedArms) {
    const caseIds = fs.readdirSync(path.join(root, armId)).filter((caseId) =>
      fs.existsSync(path.join(root, armId, caseId, "packet.json"))).sort();
    if (stableJson(caseIds) !== stableJson(expectedCases)) throw new Error(`${armId} exact case set mismatch.`);
    const summary = path.join(root, "summaries", `${armId}.json`);
    if (!fs.existsSync(summary) || readJson(summary).evaluablePackets !== expectedCases.length) {
      throw new Error(`${armId} materializer summary is absent or incomplete.`);
    }
    for (const caseId of caseIds) {
      const dir = path.join(root, armId, caseId);
      const packetFile = path.join(dir, "packet.json");
      const sealFile = path.join(dir, "binding-seal.json");
      if (!fs.existsSync(sealFile)) throw new Error(`${armId}/${caseId} binding seal is absent.`);
      const packet = readJson(packetFile);
      const seal = readJson(sealFile);
      if (expectedAuthoritySha256 && (seal.producerAuthoritySha256 !== expectedAuthoritySha256
        || seal.materializerAuthoritySha256 !== expectedAuthoritySha256)) {
        throw new Error(`${armId}/${caseId} producer/materializer authority differs from the unified runner.`);
      }
      if (seal.materializedPacketSha256 !== fileSha256(packetFile)) {
        throw new Error(`${armId}/${caseId} packet file hash differs from binding seal.`);
      }
      const unhashed = structuredClone(packet);
      delete unhashed.packetSha256;
      if (packet.packetSha256 !== sha256(stableJson(unhashed))) {
        throw new Error(`${armId}/${caseId} semantic packet hash mismatch.`);
      }
      if (packet.packetV4Bindings?.zeroInvalidNormalizations !== true
        || packet.packetV4Bindings?.sourceIdsPreserved !== true
        || packet.packetV4Bindings?.sourceMappingOneToOne !== true) {
        throw new Error(`${armId}/${caseId} lacks complete V4 source binding.`);
      }
      rows.push({ armId, caseId,
        requestSha256: sha256(stableJson(packet.identityContext?.request)),
        fixedContextSha256: sha256(stableJson(packet.identityContext)),
        packetFileSha256: fileSha256(packetFile), packetSha256: packet.packetSha256 });
    }
  }
  for (const caseId of expectedCases) {
    const paired = rows.filter((row) => row.caseId === caseId);
    if (new Set(paired.map((row) => row.requestSha256)).size !== 1
      || new Set(paired.map((row) => row.fixedContextSha256)).size !== 1) {
      throw new Error(`${caseId} request/fixed-context differs across arms.`);
    }
  }
  for (const key of requiredEmptyCases) {
    const [armId, caseId] = key.split("/");
    if (!armId || !caseId || !expectedArms.includes(armId) || !expectedCases.includes(caseId)) {
      throw new Error(`Required empty case is outside the verified campaign: ${key}`);
    }
    const packet = readJson(path.join(root, armId, caseId, "packet.json"));
    if (packet.evaluationGate?.traceClassification !== "parser_or_contract_failure"
      || packet.evaluationGate?.productionOutcome !== "empty_profile_after_parser_or_contract_failure"
      || packet.claims.length || packet.preSanitizerCandidates.length
      || packet.finalSanitizedProfiles.length || packet.rawStructuredProfiles.length) {
      throw new Error(`${key} is not the explicit empty parser/contract reconstruction.`);
    }
  }
  return { schemaVersion: 1, status: "POST_REFETCH_CAMPAIGN_READY", packetRoot: root,
    evaluatorAuthoritySha256: expectedAuthoritySha256,
    arms: expectedArms, casesPerArm: expectedCases.length, cells: rows.length,
    reconstructedEmptyCases: requiredEmptyCases.map((key) => key.split("/")[1]),
    requiredEmptyCases,
    rowsSha256: sha256(stableJson(rows)), rows };
};

const main = () => {
  const packetRoot = process.env.PACKET_ROOT;
  const outputSeal = process.env.OUTPUT_SEAL;
  if (!packetRoot) throw new Error("PACKET_ROOT is required.");
  const expectedArms = (process.env.EXPECTED_ARMS || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const expectedCases = expectedCasesFromEnvironment();
  const requiredEmptyCases = Object.hasOwn(process.env, "REQUIRED_EMPTY_CASES")
    ? process.env.REQUIRED_EMPTY_CASES.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  const result = verifyPostRefetchCampaign({ packetRoot, expectedArms, expectedCases, requiredEmptyCases });
  if (outputSeal) {
    const resolved = path.resolve(outputSeal);
    if (fs.existsSync(resolved)) throw new Error("OUTPUT_SEAL must be a fresh path.");
    fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify({ ...result, rows: undefined }, null, 2)}\n`);
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { EXPECTED_CASES, expectedCasesFromEnvironment,
  verifyPostRefetchCampaign };

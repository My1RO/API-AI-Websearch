#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { STAGES, assertManifestRuntimeAuthority, collectManualTriggerFiles,
  expectedArtifactAuthorityForStage } = require("./run_evaluator_campaign.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "unified-evaluator-runner-"));
try {
  const packetRoot = path.join(root, "packets");
  const cellRoot = path.join(packetRoot, "A", "H001");
  fs.mkdirSync(cellRoot, { recursive: true });
  fs.mkdirSync(path.join(packetRoot, "summaries"), { recursive: true });
  const authority = evaluatorRunnerAuthority(__dirname);
  assert.equal(expectedArtifactAuthorityForStage("compile", "current", "sealed-source"), "sealed-source");
  assert.equal(expectedArtifactAuthorityForStage("atomic-resume", "current", "sealed-source"), "current",
    "only offline compilation may transition from a sealed source authority");
  assert.equal(assertManifestRuntimeAuthority({ stage: "compile", manifestAuthoritySha256: "sealed-source",
    currentAuthoritySha256: "current", compileSourceAuthoritySha256: "sealed-source" }), true);
  assert.throws(() => assertManifestRuntimeAuthority({ stage: "compile",
    manifestAuthoritySha256: "sealed-source", currentAuthoritySha256: "current",
    compileSourceAuthoritySha256: "wrong" }), /manifest's sealed source authority/);
  assert.throws(() => assertManifestRuntimeAuthority({ stage: "compile",
    manifestAuthoritySha256: "sealed-source", currentAuthoritySha256: "current" }),
  /differs from the current evaluator bundle/);
  const authorityRootA = path.join(root, "authority-a");
  const authorityRootB = path.join(root, "authority-b");
  fs.mkdirSync(authorityRootA); fs.mkdirSync(authorityRootB);
  fs.writeFileSync(path.join(authorityRootA, "same.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(authorityRootB, "same.js"), "module.exports = 1;\n");
  const portableA = evaluatorRunnerAuthority(authorityRootA, ["same.js"]);
  const portableB = evaluatorRunnerAuthority(authorityRootB, ["same.js"]);
  assert.equal(portableA.authoritySha256, portableB.authoritySha256,
    "authority must depend on logical names and bytes, not checkout paths");
  assert.notEqual(portableA.files[0].path, portableB.files[0].path);
  const atomicTriggerRoot = path.join(root, "atomic-triggers");
  const synthesisTriggerRoot = path.join(root, "synthesis-triggers");
  fs.mkdirSync(atomicTriggerRoot); fs.mkdirSync(synthesisTriggerRoot);
  const automaticTriggers = [path.join(atomicTriggerRoot, "manual-review-required.json"),
    path.join(atomicTriggerRoot, "manual-review-required-runtime.json"),
    path.join(synthesisTriggerRoot, "manual-review-required.json"),
    path.join(synthesisTriggerRoot, "manual-review-required-runtime.json"),
    path.join(root, "consistency-trigger.json")];
  automaticTriggers.forEach((file) => fs.writeFileSync(file, "{}"));
  const extraTrigger = path.join(root, "explicit-extra.json"); fs.writeFileSync(extraTrigger, "{}");
  const triggerUnion = collectManualTriggerFiles({
    manifest: { manualReview: { triggerFiles: [extraTrigger, automaticTriggers[0]] } },
    paths: { atomicRoot: atomicTriggerRoot, synthesisRoot: synthesisTriggerRoot,
      consistencyTriggerFile: automaticTriggers[4] }, resolve: (value) => value
  });
  assert.deepEqual(new Set(triggerUnion), new Set([...automaticTriggers, extraTrigger]),
    "manual prepare must union every automatic trigger with explicit extras");
  const packet = { caseId: "H001", identityContext: { request: { npi: "1234567890" } },
    packetV4Bindings: { zeroInvalidNormalizations: true, sourceIdsPreserved: true,
      sourceMappingOneToOne: true } };
  packet.packetSha256 = sha256(JSON.stringify(packet));
  const packetFile = path.join(cellRoot, "packet.json");
  fs.writeFileSync(packetFile, JSON.stringify(packet));
  fs.writeFileSync(path.join(cellRoot, "binding-seal.json"), JSON.stringify({
    materializedPacketSha256: sha256(fs.readFileSync(packetFile)),
    producerAuthoritySha256: authority.authoritySha256,
    materializerAuthoritySha256: authority.authoritySha256
  }));
  fs.writeFileSync(path.join(packetRoot, "summaries", "A.json"), JSON.stringify({ evaluablePackets: 1 }));
  const verificationSeal = path.join(root, "verification.json");
  const manifestFile = path.join(root, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify({
    schemaVersion: 1, expectedCasesPerArm: 1,
    runtime: { evaluatorAuthoritySha256: authority.authoritySha256 },
    paths: { packetRoot, packetVerificationSeal: verificationSeal },
    arms: [{ armId: "A", name: "fixture", productionRoot: root }],
    packetVerification: { expectedArms: ["A"], expectedCasePrefix: "H",
      expectedCasesPerArm: 1, requiredEmptyCases: [] }
  }));
  assert(STAGES.has("verify-packets") && STAGES.has("manual-prepare") && STAGES.has("evidence-live")
    && STAGES.has("atomic-resume-dry") && STAGES.has("atomic-resume")
    && STAGES.has("synthesis-resume-dry") && STAGES.has("synthesis-resume"));
  childProcess.execFileSync(process.execPath,
    [path.join(__dirname, "run_evaluator_campaign.js"), manifestFile, "verify-packets"], { stdio: "pipe" });
  const verified = JSON.parse(fs.readFileSync(verificationSeal, "utf8"));
  assert.equal(verified.status, "POST_REFETCH_CAMPAIGN_READY");
  assert.equal(verified.evaluatorAuthoritySha256, authority.authoritySha256);

  const denied = childProcess.spawnSync(process.execPath,
    [path.join(__dirname, "verify_post_refetch_campaign.js")], { encoding: "utf8" });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /unified evaluator component/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("unified evaluator runner tests passed\n");

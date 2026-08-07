#!/usr/bin/env node
"use strict";

// Sole entry point for evaluator campaigns. Dataset role and paths come from
// the manifest; evaluator code, authority, and component invocation do not.

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { MARKER_ENV, makeRunnerMarker } = require("./evaluator_runner_guard.js");

const STAGES = new Set([
  "authority", "admit-all", "evidence-dry", "evidence-live", "evidence-resume-dry", "evidence-resume",
  "materialize", "verify-packets",
  "atomic-dry", "atomic-live", "atomic-resume-dry", "atomic-resume",
  "synthesis-dry", "synthesis-live", "synthesis-resume-dry", "synthesis-resume",
  "manual-audit", "manual-prepare", "manual-seal", "compile"
]);
const CAMPAIGN_STAGES = Object.freeze([...STAGES].filter((stage) => !["authority", "admit-all"].includes(stage)));
const expectedArtifactAuthorityForStage = (stage, currentAuthoritySha256,
  requestedSourceAuthoritySha256 = null) => stage === "compile" && requestedSourceAuthoritySha256
    ? requestedSourceAuthoritySha256 : currentAuthoritySha256;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const assertManifestRuntimeAuthority = ({ stage, manifestAuthoritySha256, currentAuthoritySha256,
  compileSourceAuthoritySha256 = "", resumeSourceAuthoritySha256 = "" }) => {
  if (stage === "compile" && compileSourceAuthoritySha256) {
    assert(manifestAuthoritySha256 === compileSourceAuthoritySha256,
      "compile requires EXPECTED_RUNNER_AUTHORITY_SHA256 equal to the manifest's sealed source authority.");
  } else if (["atomic-resume-dry", "atomic-resume", "evidence-resume-dry", "evidence-resume",
    "synthesis-resume-dry", "synthesis-resume"].includes(stage)) {
    assert(resumeSourceAuthoritySha256 && manifestAuthoritySha256 === resumeSourceAuthoritySha256,
      `${stage} requires EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256 equal to the manifest's sealed source authority.`);
  } else assert(manifestAuthoritySha256 === currentAuthoritySha256,
    "Manifest runtime.evaluatorAuthoritySha256 differs from the current evaluator bundle.");
  return true;
};
const resolveFrom = (base, value) => path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
const verifyFrozenFile = (file, expectedSha256, label) => {
  assert(file && fs.existsSync(file) && /^[a-f0-9]{64}$/.test(expectedSha256 || ""),
    `${label} file and SHA-256 are required.`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert(actual === expectedSha256, `${label} differs from its frozen SHA-256.`);
};
const verifyProductionBinding = (manifest, resolve) => {
  const binding = manifest.productionBinding;
  assert(binding && binding.manifestFile && binding.manifestSha256 && binding.resolvedOutputRoot
    && binding.preregistrationSha256 && binding.summarySha256,
  "Evidence recovery requires a complete productionBinding.");
  verifyFrozenFile(resolve(binding.manifestFile), binding.manifestSha256, "productionBinding.manifestFile");
  const root = resolve(binding.resolvedOutputRoot);
  verifyFrozenFile(path.join(root, "preregistration.json"), binding.preregistrationSha256,
    "production preregistration");
  verifyFrozenFile(path.join(root, "summary.json"), binding.summarySha256, "production summary");
  for (const arm of manifest.arms || []) assert(resolve(arm.productionRoot) === root,
    `Production binding root differs from arm ${arm.armId}.`);
  return true;
};

const collectManualTriggerFiles = ({ manifest, paths, resolve }) => {
  const automatic = [paths.consistencyTriggerFile,
    ...[paths.atomicRoot, paths.synthesisRoot].filter(Boolean).flatMap((root) =>
      ["manual-review-required.json", "manual-review-required-runtime.json"].map((name) => path.join(root, name)))];
  const explicit = (manifest.manualReview?.triggerFiles || []).map(resolve);
  return [...new Set([...automatic.filter((file) => file && fs.existsSync(file)), ...explicit])];
};
const admitCampaignManifest = (manifest, paths, resolve = (value) => value) => {
  const requirePath = (key) => assert(typeof paths[key] === "string" && paths[key], `paths.${key} is required.`);
  for (const key of ["evidenceOutputBase", "packetRoot", "packetVerificationSeal", "atomicDryRoot",
    "atomicRoot", "synthesisDryRoot", "synthesisRoot", "consistencyTriggerFile", "manualReviewRoot",
    "manualSealedRoot", "manualSealFile", "manualMapFile"]) requirePath(key);
  assert(Array.isArray(manifest.arms) && manifest.arms.length >= 2
    && manifest.arms.every((arm) => arm.armId && arm.productionRoot),
  "A complete campaign manifest requires at least two identified production arms.");
  assert(Array.isArray(manifest.packetMaterializations)
    && manifest.packetMaterializations.length === manifest.arms.length,
  "packetMaterializations must cover every arm exactly once.");
  const armIds = manifest.arms.map((arm) => arm.armId).sort();
  assert(JSON.stringify(manifest.packetMaterializations.map((row) => row.armId).sort()) === JSON.stringify(armIds),
    "packetMaterializations arm set differs from arms.");
  assert(manifest.packetMaterializations.every((row) => row.productionRoot && row.evidenceRoot
    && (row.generateBasePackets || row.legacyPacketRoot)),
  "Every packet materialization needs production/evidence roots and one base-packet mode.");
  for (const arm of manifest.arms) {
    const materialization = manifest.packetMaterializations.find((row) => row.armId === arm.armId);
    assert(resolve(materialization.productionRoot) === resolve(arm.productionRoot),
      `packetMaterialization productionRoot differs from arm ${arm.armId}.`);
    assert(resolve(materialization.evidenceRoot).startsWith(`${path.resolve(paths.evidenceOutputBase)}${path.sep}`),
      `packetMaterialization evidenceRoot escapes evidenceOutputBase for ${arm.armId}.`);
    assert(fs.existsSync(resolve(arm.productionRoot)), `Production root is missing for ${arm.armId}.`);
  }
  assert(Array.isArray(manifest.packetVerification?.expectedArms)
    && JSON.stringify([...manifest.packetVerification.expectedArms].sort()) === JSON.stringify(armIds),
  "packetVerification.expectedArms differs from arms.");
  assert(manifest.runtime?.tokenizerModules && manifest.runtime?.sdkModules,
    "Complete runtime tokenizerModules and sdkModules are required.");
  assert(fs.existsSync(resolve(manifest.runtime.tokenizerModules))
    && fs.existsSync(resolve(manifest.runtime.sdkModules)), "Configured runtime module roots are missing.");
  assert(typeof manifest.outputRoot === "string" && manifest.outputRoot,
    "Complete campaign compiler outputRoot is required.");
  for (const [fileKey, hashKey] of [["protocolFile", "protocolSha256"],
    ["caseBatteryFile", "caseBatterySha256"]]) {
    const file = resolve(manifest[fileKey]);
    assert(file && fs.existsSync(file) && /^[a-f0-9]{64}$/.test(manifest[hashKey] || ""),
      `${fileKey} and ${hashKey} must identify an existing frozen input.`);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert(actual === manifest[hashKey], `${fileKey} differs from its frozen SHA-256.`);
  }
  return { schemaVersion: 1, status: "CAMPAIGN_MANIFEST_ADMITTED", campaignId: manifest.campaignId,
    stages: CAMPAIGN_STAGES, paidCallsMade: 0, networkCallsMade: 0 };
};

const main = () => {
  const manifestFile = path.resolve(process.argv[2] || "");
  const stage = process.argv[3] || "";
  assert(process.argv[2] && fs.existsSync(manifestFile),
    "Usage: run_evaluator_campaign.js manifest.json <stage>");
  assert(STAGES.has(stage), `Unknown evaluator stage: ${stage}`);
  const authority = evaluatorRunnerAuthority(__dirname);
  if (stage === "authority") {
    process.stdout.write(`${JSON.stringify(authority, null, 2)}\n`);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const base = path.dirname(manifestFile);
  const resolve = (value) => value ? resolveFrom(base, value) : value;
  const paths = Object.fromEntries(Object.entries(manifest.paths || {}).map(([key, value]) =>
    [key, typeof value === "string" ? resolve(value) : value]));
  const runtime = manifest.runtime || {};
  const sourceEvaluatorAuthoritySha256 = process.env.EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256 || "";
  const compileSourceAuthoritySha256 = stage === "compile"
    ? process.env.EXPECTED_RUNNER_AUTHORITY_SHA256 || "" : "";
  assertManifestRuntimeAuthority({ stage, manifestAuthoritySha256: runtime.evaluatorAuthoritySha256,
    currentAuthoritySha256: authority.authoritySha256, compileSourceAuthoritySha256,
    resumeSourceAuthoritySha256: sourceEvaluatorAuthoritySha256 });
  if (stage === "admit-all") {
    process.stdout.write(`${JSON.stringify(admitCampaignManifest(manifest, paths, resolve), null, 2)}\n`);
    return;
  }
  assert(paths.packetRoot || ["evidence-dry", "evidence-live", "evidence-resume-dry", "evidence-resume"].includes(stage),
    "Manifest paths.packetRoot is required for this stage.");

  const tokenizerModules = process.env.TOKENIZER_MODULES
    || (runtime.tokenizerModules && resolve(runtime.tokenizerModules));
  const sdkModules = process.env.PROVIDER_EVAL_NODE_MODULES
    || (runtime.sdkModules && resolve(runtime.sdkModules));
  if (["atomic-dry", "atomic-live", "atomic-resume-dry", "atomic-resume",
    "synthesis-dry", "synthesis-live", "synthesis-resume-dry", "synthesis-resume"].includes(stage)) {
    assert(tokenizerModules && sdkModules,
      "Manifest runtime.tokenizerModules and runtime.sdkModules (or environment overrides) are required.");
  }

  const expectedArtifactAuthoritySha256 = expectedArtifactAuthorityForStage(stage,
    authority.authoritySha256, process.env.EXPECTED_RUNNER_AUTHORITY_SHA256 || null);
  const common = { ...process.env,
    ...(paths.packetRoot ? { PACKET_ROOT: paths.packetRoot } : {}),
    ...(tokenizerModules ? { TOKENIZER_MODULES: tokenizerModules } : {}),
    ...(sdkModules ? { PROVIDER_EVAL_NODE_MODULES: sdkModules } : {}),
    EXPECTED_RUNNER_AUTHORITY_SHA256: expectedArtifactAuthoritySha256
  };
  const run = (script, env = {}, args = []) => childProcess.execFileSync(process.execPath,
    [path.join(__dirname, script), ...args], {
      cwd: __dirname,
      env: { ...common, ...env, [MARKER_ENV]: makeRunnerMarker({ stage, script,
        authoritySha256: authority.authoritySha256 }) },
      stdio: "inherit"
    });

  if (stage === "evidence-dry" || stage === "evidence-live") {
    assert(paths.evidenceOutputBase, "Manifest paths.evidenceOutputBase is required.");
    const campaigns = (manifest.evidenceCampaigns || manifest.arms || []).map((campaign) => ({
      name: campaign.evidenceName || campaign.armId || campaign.name,
      input: resolve(campaign.input || campaign.productionRoot),
      armId: campaign.armId || null
    }));
    assert(campaigns.length && campaigns.every((row) => row.name && row.input),
      "evidenceCampaigns (or arms) must provide name/armId and input/productionRoot.");
    run("collect_format_aware_evidence_v4.js", {
      OUTPUT_BASE: paths.evidenceOutputBase,
      DRY_RUN: stage === "evidence-dry" ? "1" : "0",
      EVALUATOR_EVIDENCE_CAMPAIGNS_JSON: JSON.stringify(campaigns)
    });
  } else if (stage === "evidence-resume-dry" || stage === "evidence-resume") {
    assert(paths.evidenceOutputBase, "Manifest paths.evidenceOutputBase is required.");
    verifyProductionBinding(manifest, resolve);
    const materializations = manifest.packetMaterializations || [];
    const campaigns = (manifest.evidenceCampaigns || manifest.arms || []).map((campaign) => {
      const armId = campaign.armId || null;
      const materialization = materializations.find((row) => row.armId === armId);
      assert(materialization?.evidenceRoot,
        `Evidence recovery needs packetMaterializations.evidenceRoot for ${armId || campaign.name}.`);
      const outputRoot = resolve(materialization.evidenceRoot);
      assert(outputRoot.startsWith(`${path.resolve(paths.evidenceOutputBase)}${path.sep}`),
        `Evidence recovery root escapes evidenceOutputBase for ${armId}.`);
      return { name: campaign.evidenceName || armId || campaign.name,
        input: resolve(campaign.input || campaign.productionRoot), armId, outputRoot };
    });
    assert(campaigns.length && campaigns.every((row) => row.name && row.input && row.armId && row.outputRoot),
      "Evidence recovery campaigns require name, input, armId, and frozen evidenceRoot.");
    run("resume_format_aware_evidence_v4.js", {
      EVIDENCE_RESUME_CAMPAIGNS_JSON: JSON.stringify(campaigns),
      SOURCE_EVALUATOR_AUTHORITY_SHA256: sourceEvaluatorAuthoritySha256,
      RESUME_INSPECT_ONLY: stage === "evidence-resume-dry" ? "1" : "0"
    });
  } else if (stage === "materialize") {
    assert(paths.packetRoot, "Manifest paths.packetRoot is required.");
    const rows = manifest.packetMaterializations || [];
    assert(rows.length, "packetMaterializations must contain at least one arm.");
    for (const row of rows) {
      assert(row.armId && row.productionRoot && row.evidenceRoot,
        "Every packetMaterialization needs armId, productionRoot, and evidenceRoot.");
      assert(row.generateBasePackets || row.legacyPacketRoot,
        `packetMaterialization ${row.armId} needs legacyPacketRoot or generateBasePackets: true.`);
      run("materialize_format_aware_packets_v4.js", {
        PRODUCTION_ROOT: resolve(row.productionRoot), V4_EVIDENCE_ROOT: resolve(row.evidenceRoot),
        OUTPUT_ROOT: paths.packetRoot, ARM_ID: row.armId,
        EXPECTED_CASES_PER_ARM: String(row.expectedCasesPerArm || manifest.expectedCasesPerArm || 60),
        ...(row.generateBasePackets ? { GENERATE_BASE_PACKETS: "1" }
          : { LEGACY_PACKET_ROOT: resolve(row.legacyPacketRoot) })
      });
    }
  } else if (stage === "verify-packets") {
    assert(paths.packetVerificationSeal, "Manifest paths.packetVerificationSeal is required.");
    const verification = manifest.packetVerification || {};
    const requiredEmptyCases = Object.hasOwn(verification, "requiredEmptyCases")
      ? { REQUIRED_EMPTY_CASES: verification.requiredEmptyCases.join(",") } : {};
    run("verify_post_refetch_campaign.js", {
      OUTPUT_SEAL: paths.packetVerificationSeal,
      EXPECTED_ARMS: (verification.expectedArms || manifest.arms?.map((arm) => arm.armId) || []).join(","),
      EXPECTED_CASE_PREFIX: verification.expectedCasePrefix || "H",
      EXPECTED_CASES_PER_ARM: String(verification.expectedCasesPerArm || manifest.expectedCasesPerArm || 60),
      ...(verification.expectedCaseIds ? { EXPECTED_CASE_IDS: verification.expectedCaseIds.join(",") } : {}),
      ...requiredEmptyCases
    });
  } else if (stage === "atomic-dry") {
    assert(paths.atomicDryRoot, "Manifest paths.atomicDryRoot is required.");
    run("run_atomic_evaluator.js", { OUTPUT_ROOT: paths.atomicDryRoot, DRY_RUN: "1" });
  } else if (stage === "atomic-live") {
    assert(paths.atomicDryRoot && paths.atomicRoot,
      "Manifest paths.atomicDryRoot and paths.atomicRoot are required.");
    run("run_atomic_evaluator.js", { OUTPUT_ROOT: paths.atomicRoot, DRY_RUN: "0",
      EXPECTED_DRY_PLAN_SEAL: path.join(paths.atomicDryRoot, "CAMPAIGN_PLAN_SEAL.json") });
  } else if (stage === "atomic-resume") {
    assert(paths.atomicDryRoot && paths.atomicRoot,
      "Manifest paths.atomicDryRoot and paths.atomicRoot are required.");
    run("run_atomic_evaluator.js", { OUTPUT_ROOT: paths.atomicRoot, DRY_RUN: "0", RESUME: "1",
      SOURCE_EVALUATOR_AUTHORITY_SHA256: sourceEvaluatorAuthoritySha256,
      EXPECTED_DRY_PLAN_SEAL: path.join(paths.atomicDryRoot, "CAMPAIGN_PLAN_SEAL.json") });
  } else if (stage === "atomic-resume-dry") {
    assert(paths.atomicDryRoot && paths.atomicRoot,
      "Manifest paths.atomicDryRoot and paths.atomicRoot are required.");
    run("run_atomic_evaluator.js", { OUTPUT_ROOT: paths.atomicRoot, DRY_RUN: "0", RESUME: "1",
      RESUME_INSPECT_ONLY: "1", SOURCE_EVALUATOR_AUTHORITY_SHA256: sourceEvaluatorAuthoritySha256,
      EXPECTED_DRY_PLAN_SEAL: path.join(paths.atomicDryRoot, "CAMPAIGN_PLAN_SEAL.json") });
  } else if (stage === "synthesis-dry") {
    assert(paths.atomicRoot && paths.synthesisDryRoot,
      "Manifest paths.atomicRoot and paths.synthesisDryRoot are required.");
    run("run_bounded_synthesis.js", { ATOMIC_ROOT: paths.atomicRoot,
      OUTPUT_ROOT: paths.synthesisDryRoot, DRY_RUN: "1" });
  } else if (stage === "synthesis-live") {
    assert(paths.atomicRoot && paths.synthesisDryRoot && paths.synthesisRoot,
      "Manifest paths.atomicRoot, paths.synthesisDryRoot, and paths.synthesisRoot are required.");
    run("run_bounded_synthesis.js", { ATOMIC_ROOT: paths.atomicRoot,
      OUTPUT_ROOT: paths.synthesisRoot, DRY_RUN: "0",
      EXPECTED_DRY_PLAN_SEAL: path.join(paths.synthesisDryRoot, "CAMPAIGN_PLAN_SEAL.json") });
  } else if (stage === "synthesis-resume" || stage === "synthesis-resume-dry") {
    assert(paths.atomicRoot && paths.synthesisDryRoot && paths.synthesisRoot,
      "Manifest paths.atomicRoot, paths.synthesisDryRoot, and paths.synthesisRoot are required.");
    run("run_bounded_synthesis.js", { ATOMIC_ROOT: paths.atomicRoot,
      OUTPUT_ROOT: paths.synthesisRoot, DRY_RUN: "0", RESUME: "1",
      RESUME_INSPECT_ONLY: stage === "synthesis-resume-dry" ? "1" : "0",
      SOURCE_EVALUATOR_AUTHORITY_SHA256: sourceEvaluatorAuthoritySha256,
      EXPECTED_DRY_PLAN_SEAL: path.join(paths.synthesisDryRoot, "CAMPAIGN_PLAN_SEAL.json") });
  } else if (stage === "manual-audit") {
    assert(paths.synthesisRoot && paths.consistencyTriggerFile,
      "Manifest paths.synthesisRoot and paths.consistencyTriggerFile are required.");
    run("audit_identical_input_consistency.js", {
      SYNTHESIS_ROOT: paths.synthesisRoot, OUTPUT_FILE: paths.consistencyTriggerFile
    });
  } else if (stage === "manual-prepare") {
    const manual = manifest.manualReview || {};
    assert(paths.manualReviewRoot && paths.manualSealedRoot,
      "Manifest paths.manualReviewRoot and paths.manualSealedRoot are required.");
    const triggerFiles = collectManualTriggerFiles({ manifest, paths, resolve });
    assert(triggerFiles.length, "No automatic or explicit manual-review trigger artifact exists.");
    for (const file of triggerFiles) assert(fs.existsSync(file), `Manual trigger file is missing: ${file}`);
    run("manual_review_harness.js", {
      OUTPUT_ROOT: paths.manualReviewRoot, SEALED_ROOT: paths.manualSealedRoot,
      EXPECTED_ARMS: (manual.expectedArms || manifest.arms?.map((arm) => arm.armId) || []).join(","),
      EXPECTED_CASES_PER_ARM: String(manual.expectedCasesPerArm || manifest.expectedCasesPerArm || 60),
      TRIGGER_FILES: triggerFiles.join(path.delimiter),
      ...(manual.blindingSeedHex ? { BLINDING_SEED_HEX: manual.blindingSeedHex } : {}),
      ...(manual.singleArmAudit ? { SINGLE_ARM_AUDIT: "1" } : {})
    }, ["prepare"]);
  } else if (stage === "manual-seal") {
    assert(paths.manualReviewRoot && paths.manualSealedRoot,
      "Manifest paths.manualReviewRoot and paths.manualSealedRoot are required.");
    run("manual_review_harness.js", {
      CAMPAIGN_ROOT: paths.manualReviewRoot, SEALED_ROOT: paths.manualSealedRoot,
      FINAL_SEAL_FILE_NAME: manifest.manualReview?.finalSealFileName || "final-unblinded-seal.json"
    }, ["seal"]);
  } else if (stage === "compile") {
    run("compile_corrected_campaign.js", {}, [manifestFile]);
  }
};

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { CAMPAIGN_STAGES, STAGES, admitCampaignManifest, collectManualTriggerFiles,
  assertManifestRuntimeAuthority, expectedArtifactAuthorityForStage,
  verifyFrozenFile, verifyProductionBinding };

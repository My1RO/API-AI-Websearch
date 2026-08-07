"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const AUTHORIZATION_TEST_OVERRIDE_ACK = "ZERO_CALL_SYNTHETIC_AUTHORIZATION_ROOT_ONLY";
const SEALED_HOLDOUT_CONTENT_SET_SHA256 = "f7e6e9b23220527ef157a7053d58ba81df5a4a2620a74e497be3da1d3b60da86";
const HOLDOUT_DATA_FILES = Object.freeze({
  caseFile: "data/eval-cases-60.jsonl",
  cohortFile: "data/cohort.json"
});
const STATUS = "sealed_before_d_synthesis_execution";
const STAGES = Object.freeze({
  screen: Object.freeze({ casePolicy: "protocol", minCases: 1, maxCases: 59, datasetRole: "development", decisionSupport: true }),
  pilot: Object.freeze({ casePolicy: "protocol", minCases: 1, maxCases: 59, datasetRole: "development", decisionSupport: true }),
  development_full: Object.freeze({ cases: 60, datasetRole: "development", decisionSupport: true }),
  holdout_validation: Object.freeze({ cases: 60, datasetRole: "holdout", decisionSupport: false })
});
const RUNTIME = Object.freeze({
  model: "gpt-5.6-terra",
  reasoning: "low",
  responsesCallsPerSemanticAttempt: 1,
  initialSdkMaxRetries: 1,
  semanticRetrySlots: 1,
  semanticRetrySdkMaxRetries: 0,
  maximumHttpAttemptsPerCell: 3,
  productionHostFetches: 0,
  planNetworkDataOnWire: false
});
const EVALUATOR = Object.freeze({
  model: "gpt-5.6-sol",
  reasoning: "high",
  concurrency: 10,
  assessment: "categorical_only",
  numericScores: false,
  aggregateScore: false,
  armLocalEvidenceOnly: true,
  contentFilterPolicy: "censoring_not_arm_quality"
});

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableObject = (value) => Array.isArray(value) ? value.map(stableObject)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
    : value;
const stableJson = (value) => JSON.stringify(stableObject(value));
const protocolHashPayload = (protocol) => {
  const value = { ...protocol };
  delete value.protocolContentSha256;
  return stableJson(value);
};
const protocolContentSha256 = (protocol) => sha256(protocolHashPayload(protocol));
const exactKeys = (value, keys) => stableJson(Object.keys(value || {}).sort()) === stableJson([...keys].sort());
const same = (left, right) => stableJson(left) === stableJson(right);
const isSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const assertContainedPath = (root, candidate, label, { allowMissing = false } = {}) => {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()
    || fs.realpathSync(resolvedRoot) !== resolvedRoot) {
    throw new Error(`${label} root must be an existing canonical directory.`);
  }
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || relative === "." || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a non-root path contained by its canonical root.`);
  }
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (!allowMissing) throw new Error(`${label} is missing.`);
      break;
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link.`);
  }
  if (fs.existsSync(resolved) && fs.realpathSync(resolved) !== resolved) {
    throw new Error(`${label} must resolve to its exact canonical path.`);
  }
  return resolved;
};

const resolveRelativePath = (root, relativePath, label, options = {}) => {
  if (typeof relativePath !== "string" || relativePath.trim() === "" || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must use a non-empty relative path.`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must not escape its artifact root.`);
  }
  return assertContainedPath(root, path.resolve(root, normalized), label, options);
};

const authorizationPaths = (workspace, { allowMissingRoot = true } = {}) => {
  const override = process.env.PROVIDER_D_SERIES_AUTHORIZATION_ROOT;
  if (override && process.env.D_SYNTHESIS_AUTHORIZATION_TEST_OVERRIDE !== AUTHORIZATION_TEST_OVERRIDE_ACK) {
    throw new Error("D-synthesis authorization-root override is reserved for the zero-call synthetic harness.");
  }
  const root = path.resolve(override
    || path.join(workspace, "test-evidence/provider-d-series-2026-07-31/d-synthesis-authorization"));
  assertContainedPath(workspace, root, "D-synthesis authorization directory", { allowMissing: allowMissingRoot });
  return Object.freeze({
    root,
    developmentArmLock: path.join(root, "development-arm-lock.json"),
    developmentJudgeLock: path.join(root, "development-judge-lock.json"),
    developmentProtocol: path.join(root, "development-protocol.json"),
    developmentEvidenceSeal: path.join(root, "development-evidence-seal.json"),
    developmentDecisionSeal: path.join(root, "development-decision-seal.json"),
    finalArmLock: path.join(root, "final-arm-lock.json"),
    finalJudgeLock: path.join(root, "final-judge-lock.json"),
    finalWinnerLock: path.join(root, "final-winner-lock.json"),
    holdoutProtocol: path.join(root, "holdout-protocol.json")
  });
};

const expectedHoldoutContentSetSha256 = () => {
  const override = process.env.PROVIDER_D_SERIES_EXPECTED_HOLDOUT_CONTENT_SET_SHA256;
  if (override && process.env.D_SYNTHESIS_AUTHORIZATION_TEST_OVERRIDE !== AUTHORIZATION_TEST_OVERRIDE_ACK) {
    throw new Error("Expected holdout content-set override is reserved for the zero-call synthetic harness.");
  }
  return override || SEALED_HOLDOUT_CONTENT_SET_SHA256;
};

const validateHoldoutSealEnvelope = ({ workspace, artifact }) => {
  const holdoutSeal = JSON.parse(artifact.bytes);
  const holdoutRoot = path.dirname(artifact.file);
  if (holdoutSeal.schemaVersion !== 1 || holdoutSeal.caseCount !== 60
    || holdoutSeal.contentSetSha256 !== expectedHoldoutContentSetSha256()
    || !Array.isArray(holdoutSeal.contentFiles) || holdoutSeal.contentFiles.length < 2
    || sha256(stableJson(holdoutSeal.contentFiles)) !== holdoutSeal.contentSetSha256) {
    throw new Error("Canonical holdout seal envelope/content-set hash is invalid or is not the preregistered sealed holdout.");
  }
  const byPath = new Map();
  for (const [index, item] of holdoutSeal.contentFiles.entries()) {
    if (!item || typeof item.path !== "string" || item.path.trim() === "" || path.isAbsolute(item.path)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !isSha256(item.sha256)
      || byPath.has(item.path)) {
      throw new Error(`Canonical holdout content descriptor ${index} is invalid or duplicated.`);
    }
    const file = resolveRelativePath(holdoutRoot, item.path, `holdout content descriptor ${index}`, { allowMissing: true });
    if (file !== path.join(holdoutRoot, item.path)) {
      throw new Error(`Canonical holdout content descriptor ${index} is noncanonical.`);
    }
    byPath.set(item.path, { ...item, file });
  }
  return { holdoutSeal, holdoutRoot, byPath };
};

const validateHoldoutDataBindings = ({ workspace, protocol, sealArtifact }) => {
  const validated = validateHoldoutSealEnvelope({ workspace, artifact: sealArtifact });
  for (const [field, relativePath] of Object.entries(HOLDOUT_DATA_FILES)) {
    const sealed = validated.byPath.get(relativePath);
    const supplied = protocol[field];
    if (!sealed || !supplied || supplied.sha256 !== sealed.sha256 || supplied.byteLength !== sealed.bytes
      || resolveDescriptorPath(workspace, supplied, `holdout ${field}`) !== sealed.file) {
      throw new Error(`Holdout ${field} is not the exact descriptor in the preregistered sealed content set.`);
    }
  }
  return validated;
};

const expectedCasesForStage = (stage, configuredCases) => {
  if (!stage) throw new Error("Unknown D-synthesis stage.");
  if (Number.isInteger(stage.cases)) {
    if (configuredCases !== stage.cases) throw new Error(`D-synthesis stage requires exactly ${stage.cases} cases.`);
    return stage.cases;
  }
  if (stage.casePolicy !== "protocol" || !Number.isInteger(configuredCases)
    || configuredCases < stage.minCases || configuredCases > stage.maxCases) {
    throw new Error(`D-synthesis development stage requires a protocol-selected case count from ${stage.minCases} to ${stage.maxCases}.`);
  }
  return configuredCases;
};

const resolveDescriptorPath = (workspace, descriptor, label) => {
  if (!descriptor || typeof descriptor.path !== "string" || descriptor.path.trim() === "" || !isSha256(descriptor.sha256)) {
    throw new Error(`${label} descriptor must contain path and SHA-256.`);
  }
  return resolveRelativePath(workspace, descriptor.path, label, { allowMissing: true });
};

const verifyDescriptor = (workspace, descriptor, label) => {
  const file = resolveDescriptorPath(workspace, descriptor, label);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is missing.`);
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== descriptor.sha256) throw new Error(`${label} SHA-256 mismatch.`);
  if (descriptor.byteLength !== undefined && descriptor.byteLength !== bytes.length) {
    throw new Error(`${label} byte length mismatch.`);
  }
  return { file, bytes };
};

const verifyDescriptorGraph = (workspace, rootPath, graph, expectedCount, label) => {
  const root = resolveRelativePath(workspace, rootPath, `${label} root`);
  if (!fs.statSync(root).isDirectory() || !Array.isArray(graph) || graph.length !== expectedCount) {
    throw new Error(`${label} descriptor graph has the wrong root or cardinality.`);
  }
  const artifacts = graph.map((item, index) => {
    if (!Number.isSafeInteger(item?.byteLength) || item.byteLength < 0) {
      throw new Error(`${label} descriptor ${index} omits its byte length.`);
    }
    const artifact = verifyDescriptor(workspace, item, `${label} descriptor ${index}`);
    assertContainedPath(root, artifact.file, `${label} descriptor ${index}`);
    return artifact;
  });
  if (new Set(artifacts.map((item) => item.file)).size !== expectedCount) {
    throw new Error(`${label} descriptor graph contains duplicate files.`);
  }
  return artifacts;
};

const verifyManifestArtifactGraph = (manifestArtifacts, label) => {
  let artifactCount = 0;
  for (const [manifestIndex, manifestArtifact] of manifestArtifacts.entries()) {
    const manifest = JSON.parse(manifestArtifact.bytes);
    if (!Array.isArray(manifest.artifacts)) throw new Error(`${label} manifest ${manifestIndex} has no artifact graph.`);
    const names = manifest.artifacts.map((item) => item.path);
    if (label.includes("phase1")
      && !["request.json", "trace.json", "usage.json", "outcome.json"].every((name) => names.includes(name))) {
      throw new Error(`${label} manifest ${manifestIndex} omits required production artifacts.`);
    }
    if (label.includes("phase2") && !names.includes("outcome.json")) {
      throw new Error(`${label} manifest ${manifestIndex} omits its terminal outcome.`);
    }
    if (label.includes("judge") && (!names.includes("judgment.json")
      || !names.some((name) => ["packet.json", "production-error.json"].includes(name)))) {
      throw new Error(`${label} manifest ${manifestIndex} omits packet/error evidence or terminal judgment.`);
    }
    for (const [artifactIndex, item] of manifest.artifacts.entries()) {
      if (!item || typeof item.path !== "string" || !isSha256(item.sha256)
        || (item.byteLength !== undefined && (!Number.isSafeInteger(item.byteLength) || item.byteLength < 0))) {
        throw new Error(`${label} manifest ${manifestIndex} artifact ${artifactIndex} is invalid.`);
      }
      const file = resolveRelativePath(path.dirname(manifestArtifact.file), item.path,
        `${label} manifest ${manifestIndex} artifact ${artifactIndex}`);
      const bytes = fs.readFileSync(file);
      if (sha256(bytes) !== item.sha256 || (item.byteLength !== undefined && bytes.length !== item.byteLength)) {
        throw new Error(`${label} manifest ${manifestIndex} artifact ${artifactIndex} changed after sealing.`);
      }
      artifactCount += 1;
    }
  }
  return artifactCount;
};

const validateShape = (protocol, { requireSealed = true, allowUnboundJudge = false, workspace = process.cwd() } = {}) => {
  if (!protocol || protocol.schemaVersion !== 2 || (requireSealed && protocol.status !== STATUS)) {
    throw new Error("D-synthesis protocol must be a sealed schema-v2 protocol.");
  }
  const stage = STAGES[protocol.stage];
  if (!stage || protocol.datasetRole !== stage.datasetRole) throw new Error("Invalid D-synthesis stage or dataset role.");
  if (!Array.isArray(protocol.armIds) || protocol.armIds.length < 1 || new Set(protocol.armIds).size !== protocol.armIds.length
    || protocol.armIds.some((id) => typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id))) {
    throw new Error("D-synthesis arm IDs must be unique stable identifiers.");
  }
  if (!protocol.armIds.includes(protocol.baselineArm)) throw new Error("D-synthesis baseline arm is absent.");
  const expectedCases = expectedCasesForStage(stage, protocol.expectedCases);
  if (protocol.expectedRuns !== expectedCases * protocol.armIds.length) {
    throw new Error("D-synthesis protocol cardinality does not match its stage and arm registry.");
  }
  if (!Array.isArray(protocol.schedule) || protocol.schedule.length !== expectedCases) {
    throw new Error("D-synthesis schedule case cardinality mismatch.");
  }
  const caseIds = protocol.schedule.map((item) => item?.caseId);
  if (caseIds.some((id) => typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id))
    || new Set(caseIds).size !== expectedCases) throw new Error("D-synthesis schedule case IDs are invalid or duplicated.");
  const sortedArms = [...protocol.armIds].sort();
  if (protocol.schedule.some((item) => !Array.isArray(item.armOrder)
    || !same([...item.armOrder].sort(), sortedArms))) throw new Error("Every case must schedule every protocol arm exactly once.");
  const positionCounts = Object.fromEntries(protocol.armIds.map((armId) => [armId,
    protocol.armIds.map((unused, position) => protocol.schedule.filter((item) => item.armOrder[position] === armId).length)
  ]));
  for (const [armId, counts] of Object.entries(positionCounts)) {
    if (Math.max(...counts) - Math.min(...counts) > 1) {
      throw new Error(`D-synthesis ${armId} schedule position imbalance exceeds one.`);
    }
  }
  if (!same(protocol.runtime, RUNTIME)) throw new Error("D-synthesis production runtime is not the frozen Terra/low 2+1 no-fetch contract.");
  if (!same(protocol.evaluator, EVALUATOR)) throw new Error("D-synthesis evaluator is not the fixed Sol/high categorical contract.");
  const descriptors = [["case file", protocol.caseFile], ["cohort file", protocol.cohortFile],
    ["arm lock", protocol.armLock], ...(allowUnboundJudge && !protocol.judgeLock ? [] : [["judge lock", protocol.judgeLock]])];
  for (const [label, descriptor] of descriptors) {
    resolveDescriptorPath(workspace, descriptor, label);
  }
  if (protocol.stage === "holdout_validation") {
    if (protocol.armIds.length !== 1 || (!allowUnboundJudge
      && (!protocol.developmentDecisionSeal || !protocol.developmentEvidenceSeal
        || !protocol.finalWinnerLock || !protocol.holdoutSeal))) {
      throw new Error("Holdout validation requires one arm and the complete canonical development, winner, and holdout authorization graph.");
    }
  } else if (protocol.developmentDecisionSeal || protocol.developmentEvidenceSeal
    || protocol.finalWinnerLock || protocol.holdoutSeal) {
    throw new Error("Development protocols must not bind holdout authorization artifacts.");
  }
  if (requireSealed && (!isSha256(protocol.protocolContentSha256)
    || protocolContentSha256(protocol) !== protocol.protocolContentSha256)) {
    throw new Error("D-synthesis protocol content seal mismatch.");
  }
  return { stage, caseIds };
};

const validateFinalWinnerLock = ({ workspace, protocol, armLock, judgeLock }) => {
  if (protocol.stage !== "holdout_validation") return null;
  // This authorization check intentionally occurs before either holdout data
  // descriptor is opened or hashed by the caller.
  const auth = authorizationPaths(workspace, { allowMissingRoot: false });
  const exactArtifact = (descriptorValue, expectedPath, label) => {
    const artifact = verifyDescriptor(workspace, descriptorValue, label);
    if (artifact.file !== expectedPath) throw new Error(`${label} is outside the canonical authorization namespace.`);
    return { ...artifact, value: JSON.parse(artifact.bytes) };
  };
  const finalArmFile = resolveDescriptorPath(workspace, protocol.armLock, "final arm lock");
  const finalJudgeFile = resolveDescriptorPath(workspace, protocol.judgeLock, "final judge lock");
  if (finalArmFile !== auth.finalArmLock || finalJudgeFile !== auth.finalJudgeLock) {
    throw new Error("Holdout protocol does not use the canonical final arm and judge locks.");
  }
  const decisionArtifact = exactArtifact(protocol.developmentDecisionSeal,
    auth.developmentDecisionSeal, "development-decision seal");
  const evidenceArtifact = exactArtifact(protocol.developmentEvidenceSeal,
    auth.developmentEvidenceSeal, "development-evidence seal");
  const winnerArtifact = exactArtifact(protocol.finalWinnerLock, auth.finalWinnerLock, "final-winner lock");
  const decision = decisionArtifact.value;
  const evidence = evidenceArtifact.value;
  const lock = winnerArtifact.value;
  const armId = protocol.armIds[0];
  if (decision.schemaVersion !== 2 || decision.status !== "sealed_development_decision_before_holdout"
    || decision.decisionBasis !== "complete_development_only" || decision.holdoutConsulted !== false
    || decision.winnerArmId !== armId || decision.winnerArmCommit !== armLock.arms?.[armId]?.commit
    || !decision.candidateArmIds?.includes(armId)
    || decision.developmentEvidenceSha256 !== protocol.developmentEvidenceSeal.sha256) {
    throw new Error("Development decision does not authorize this exact winner from complete development evidence.");
  }
  if (evidence.schemaVersion !== 2 || evidence.status !== "sealed_complete_development_evaluation"
    || evidence.stage !== "development_full" || evidence.holdoutConsulted !== false
    || evidence.expectedCases !== 60 || evidence.expectedRuns !== 60 * evidence.armIds?.length
    || evidence.productionCompletion?.phase1ManifestCount !== evidence.expectedRuns
    || evidence.productionCompletion?.phase2ManifestCount !== evidence.expectedRuns
    || evidence.judgeCompletion?.manifestCount !== evidence.expectedRuns
    || !same(evidence.armIds, decision.candidateArmIds)
    || evidence.armLock?.sha256 !== decision.developmentArmLockSha256
    || evidence.judgeLock?.sha256 !== decision.developmentJudgeLockSha256) {
    throw new Error("Development evidence seal is incomplete or differs from the selected decision.");
  }
  const developmentArm = exactArtifact(evidence.armLock, auth.developmentArmLock, "development arm lock");
  const developmentJudge = exactArtifact(evidence.judgeLock, auth.developmentJudgeLock, "development judge lock");
  const developmentProtocol = exactArtifact(evidence.protocol, auth.developmentProtocol, "development protocol");
  const expectedDevelopmentCommits = Object.fromEntries(evidence.armIds.map((id) => [id, developmentArm.value.arms?.[id]?.commit]));
  if (!same(developmentArm.value.armOrder, evidence.armIds)
    || developmentArm.value.arms?.[armId]?.commit !== decision.winnerArmCommit
    || decision.developmentProtocolSha256 !== evidence.protocol.sha256
    || developmentJudge.value.armLockSha256 !== evidence.armLock.sha256
    || !same(developmentJudge.value.armIds, evidence.armIds)
    || !same(developmentJudge.value.armCommits, expectedDevelopmentCommits)
    || developmentJudge.value.model !== EVALUATOR.model || developmentJudge.value.reasoning !== EVALUATOR.reasoning) {
    throw new Error("Development arm/judge artifact graph does not bind the selected winner.");
  }
  const production = evidence.productionCompletion;
  const judgeCompletion = evidence.judgeCompletion;
  const analysis = evidence.analysisCompletion;
  const completionArtifact = (rootPath, descriptorValue, expectedName, label) => {
    const root = resolveRelativePath(workspace, rootPath, `${label} root`);
    const artifact = verifyDescriptor(workspace, descriptorValue, label);
    assertContainedPath(root, artifact.file, label);
    if (artifact.file !== path.join(root, expectedName)) throw new Error(`${label} path is noncanonical.`);
    return artifact;
  };
  completionArtifact(production.root, production.preregistration, "preregistration.json", "development preregistration");
  completionArtifact(production.root, production.seal, "production-input-seal.json", "development production seal");
  completionArtifact(production.root, production.summary, "summary.json", "development production summary");
  completionArtifact(production.root, production.results, "results.json", "development production results");
  completionArtifact(judgeCompletion.root, judgeCompletion.summary, "judge-summary.json", "development judge summary");
  completionArtifact(analysis.root, analysis.summary, "analysis-summary.json", "development analysis summary");
  const phase1Manifests = verifyDescriptorGraph(workspace, production.root, production.phase1ManifestGraph,
    evidence.expectedRuns, "development phase1 manifests");
  const phase2Manifests = verifyDescriptorGraph(workspace, production.root, production.phase2ManifestGraph,
    evidence.expectedRuns, "development phase2 manifests");
  const judgeManifests = verifyDescriptorGraph(workspace, judgeCompletion.root, judgeCompletion.manifestGraph,
    evidence.expectedRuns, "development judge manifests");
  verifyDescriptorGraph(workspace, production.root, production.aggregateArtifactGraph,
    3, "development production aggregates");
  verifyDescriptorGraph(workspace, analysis.root, analysis.artifactGraph, 20, "development analysis artifacts");
  verifyManifestArtifactGraph(phase1Manifests, "development phase1");
  verifyManifestArtifactGraph(phase2Manifests, "development phase2");
  verifyManifestArtifactGraph(judgeManifests, "development judge");
  if (production.manifestGraphSha256 !== sha256(stableJson({
    phase1: production.phase1ManifestGraph, phase2: production.phase2ManifestGraph
  })) || judgeCompletion.manifestGraphSha256 !== sha256(stableJson(judgeCompletion.manifestGraph))
    || analysis.artifactGraphSha256 !== sha256(stableJson(analysis.artifactGraph))
    || developmentProtocol.value.stage !== "development_full") {
    throw new Error("Development completion descriptor graph changed after winner selection.");
  }
  const expected = {
    schemaVersion: 2,
    status: "sealed_final_winner_before_holdout",
    winnerArmId: armId,
    winnerArmCommit: armLock.arms?.[armId]?.commit,
    armLockSha256: protocol.armLock.sha256,
    judgeLockSha256: protocol.judgeLock.sha256,
    productionModel: RUNTIME.model,
    productionReasoning: RUNTIME.reasoning,
    judgeModel: EVALUATOR.model,
    judgeReasoning: EVALUATOR.reasoning,
    developmentDecisionSealSha256: protocol.developmentDecisionSeal.sha256,
    developmentEvidenceSha256: protocol.developmentEvidenceSeal.sha256,
    holdoutContentSetSha256: protocol.holdoutContentSetSha256
  };
  for (const [key, value] of Object.entries(expected)) {
    if (lock[key] !== value) throw new Error(`Final-winner lock ${key} mismatch; holdout remains sealed.`);
  }
  if (!judgeLock || judgeLock.model !== EVALUATOR.model || judgeLock.reasoning !== EVALUATOR.reasoning) {
    throw new Error("Final-winner lock does not resolve to the fixed evaluator.");
  }
  const holdoutSealArtifact = verifyDescriptor(workspace, protocol.holdoutSeal, "holdout seal");
  const holdoutBinding = validateHoldoutDataBindings({ workspace, protocol, sealArtifact: holdoutSealArtifact });
  const holdoutSeal = holdoutBinding.holdoutSeal;
  const holdoutOverride = process.env.PROVIDER_D_SERIES_HOLDOUT_SEAL;
  if (holdoutOverride && process.env.D_SYNTHESIS_AUTHORIZATION_TEST_OVERRIDE !== AUTHORIZATION_TEST_OVERRIDE_ACK) {
    throw new Error("Holdout-seal override is reserved for the zero-call synthetic harness.");
  }
  const canonicalHoldoutSeal = path.resolve(holdoutOverride
    || path.join(workspace, "test-evidence/provider-holdout-60-2026-07-31/HOLDOUT_SEAL.json"));
  if (holdoutSealArtifact.file !== canonicalHoldoutSeal
    || lock.holdoutSealSha256 !== protocol.holdoutSeal.sha256
    || holdoutSeal.contentSetSha256 !== protocol.holdoutContentSetSha256 || holdoutSeal.caseCount !== 60) {
    throw new Error("Holdout seal metadata differs from the final-winner protocol; holdout remains sealed.");
  }
  return { file: winnerArtifact.file, lock, decisionArtifact, evidenceArtifact, holdoutSealArtifact, holdoutSeal };
};

const validateBoundProtocol = ({ workspace, protocol, requireSealed = true, verifyData = true }) => {
  const shape = validateShape(protocol, { requireSealed, workspace });
  const armArtifact = verifyDescriptor(workspace, protocol.armLock, "arm lock");
  const judgeArtifact = verifyDescriptor(workspace, protocol.judgeLock, "judge lock");
  const armLock = JSON.parse(armArtifact.bytes);
  const judgeLock = JSON.parse(judgeArtifact.bytes);
  if (armLock.status !== "sealed_before_paid_d_series_production"
    || !same(armLock.armOrder, protocol.armIds)
    || armLock.baselineArm !== protocol.baselineArm
    || !protocol.armIds.every((armId) => /^[a-f0-9]{40}$/.test(armLock.arms?.[armId]?.commit || ""))) {
    throw new Error("D-synthesis arm lock does not bind the protocol registry.");
  }
  const judgeExpected = {
    model: EVALUATOR.model, reasoning: EVALUATOR.reasoning, concurrency: EVALUATOR.concurrency,
    webSearchEnabled: false, assessment: EVALUATOR.assessment, numericScores: false, aggregateScore: false
  };
  for (const [key, value] of Object.entries(judgeExpected)) {
    if (judgeLock[key] !== value) throw new Error(`D-synthesis judge lock ${key} mismatch.`);
  }
  if (judgeLock.baselineArm !== protocol.baselineArm) throw new Error("D-synthesis judge lock baseline mismatch.");
  if (!same(judgeLock.armIds, protocol.armIds)) throw new Error("D-synthesis judge lock arm registry mismatch.");
  const expectedCommits = Object.fromEntries(protocol.armIds.map((armId) => [armId, armLock.arms[armId].commit]));
  if (judgeLock.armLockSha256 !== protocol.armLock.sha256 || !same(judgeLock.armCommits, expectedCommits)) {
    throw new Error("D-synthesis judge lock is not cryptographically bound to the exact arm lock.");
  }
  validateFinalWinnerLock({ workspace, protocol, armLock, judgeLock });
  const data = verifyData ? {
    caseArtifact: verifyDescriptor(workspace, protocol.caseFile, "case file"),
    cohortArtifact: verifyDescriptor(workspace, protocol.cohortFile, "cohort file")
  } : {};
  return { ...shape, armLock, judgeLock, armArtifact, judgeArtifact, ...data };
};

const validateObservedRetryShape = ({ semanticAttempts, httpSendCount }) => {
  if (!Array.isArray(semanticAttempts) || semanticAttempts.length > 2) {
    throw new Error("Observed semantic attempts exceed the initial plus one recovery ceiling.");
  }
  const counts = semanticAttempts.map((attempt) => Array.isArray(attempt?.httpSends) ? attempt.httpSends.length : 0);
  if ((counts[0] || 0) > 2) throw new Error("Observed initial semantic attempt exceeds two HTTP sends.");
  if (counts.slice(1).some((count) => count > 1)) throw new Error("Observed semantic recovery exceeds one HTTP send.");
  const observedTotal = counts.reduce((sum, count) => sum + count, 0);
  if (!Number.isInteger(httpSendCount) || httpSendCount !== observedTotal || observedTotal > 3) {
    throw new Error("Observed HTTP sends violate the bounded 2+1 retry contract.");
  }
  return { semanticAttemptCount: semanticAttempts.length, httpSendCount: observedTotal, perAttemptHttpSends: counts };
};

const descriptor = (workspace, file) => {
  const resolved = assertContainedPath(workspace, file, "descriptor artifact");
  const bytes = fs.readFileSync(resolved);
  const relative = path.relative(path.resolve(workspace), resolved);
  return {
    path: relative,
    sha256: sha256(bytes),
    byteLength: bytes.length
  };
};

module.exports = {
  STATUS, STAGES, RUNTIME, EVALUATOR, SEALED_HOLDOUT_CONTENT_SET_SHA256, HOLDOUT_DATA_FILES,
  sha256, stableJson, same, protocolContentSha256,
  expectedCasesForStage, assertContainedPath, resolveRelativePath, authorizationPaths,
  expectedHoldoutContentSetSha256, validateHoldoutSealEnvelope, validateHoldoutDataBindings,
  resolveDescriptorPath, verifyDescriptor, verifyDescriptorGraph, verifyManifestArtifactGraph,
  validateShape, validateFinalWinnerLock,
  validateBoundProtocol, validateObservedRetryShape, descriptor
};

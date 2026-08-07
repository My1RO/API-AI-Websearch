#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertFrozenProductionBinding, classifyEmptyProductionOutcome, productionSourceUrls } =
  require("./materialize_format_aware_packets_v4.js");

const WORKSPACE = path.resolve(process.env.EDE_SHARED_WORKSPACE || "/Users/kui/lucie/EDE");
const MIN_ROOT = path.join(WORKSPACE, "test-evidence/provider-prompt-minimization-2026-08-02/runs");
const FULL_ROOT = path.join(WORKSPACE,
  "test-evidence/provider-d-series-2026-07-31/runs/d34-d36-final-holdout-v14-r3-004-v5");
const PATHS = Object.freeze({
  preregistration: path.join(FULL_ROOT, "preregistration.json"),
  fullPhase1: path.join(FULL_ROOT, "phase1/D36"),
  fullPackets: path.join(FULL_ROOT,
    "judge-categorical-sol-high-v14-d34-d36-holdout-v2/runs/D36"),
  successorProduction: path.join(MIN_ROOT, "successor-holdout-v2-production/cells/SUCCESSOR"),
  successorPackets: path.join(MIN_ROOT, "successor-holdout-v2-judge-sol-high-v14-reader-v5/cells/SUCCESSOR"),
  candidateProduction: path.join(MIN_ROOT, "candidate72-diagnostic-v1-production/cells/CANDIDATE72"),
  candidatePackets: path.join(MIN_ROOT,
    "candidate72-diagnostic-v1-judge-sol-high-v14-reader-v5/cells/CANDIDATE72")
});
const ARMS = Object.freeze(["D36", "SUCCESSOR", "CANDIDATE72"]);
const CASE_IDS = Object.freeze(Array.from({ length: 60 }, (_, index) => `H${String(index + 1).padStart(3, "0")}`));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fileDescriptor = (file) => ({ path: file, sha256: sha256(fs.readFileSync(file)),
  byteLength: fs.statSync(file).size });
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
};
const exact = (left, right, label) => {
  if (stableJson(left) !== stableJson(right)) throw new Error(`${label} mismatch.`);
};
const assertUnderWorkspace = (file) => {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${WORKSPACE}${path.sep}`)) throw new Error(`Path escapes EDE_SHARED_WORKSPACE: ${file}`);
  return resolved;
};
const requiredJson = (file) => {
  assertUnderWorkspace(file);
  if (!fs.existsSync(file)) throw new Error(`Required historical artifact is absent: ${file}`);
  return { file, value: readJson(file), descriptor: fileDescriptor(file) };
};

const verifyAttemptManifest = (attemptRoot, manifest) => {
  const seen = new Set();
  for (const descriptor of manifest.artifacts || []) {
    const file = path.resolve(attemptRoot, descriptor.path || "");
    if (!file.startsWith(`${path.resolve(attemptRoot)}${path.sep}`) || !fs.existsSync(file)) {
      throw new Error(`Attempt manifest artifact is missing or escapes attempt root: ${descriptor.path}`);
    }
    const actual = fileDescriptor(file);
    if (actual.sha256 !== descriptor.sha256 || actual.byteLength !== descriptor.byteLength) {
      throw new Error(`Attempt manifest descriptor mismatch: ${descriptor.path}`);
    }
    if (seen.has(descriptor.path)) throw new Error(`Duplicate attempt manifest artifact: ${descriptor.path}`);
    seen.add(descriptor.path);
  }
  for (const required of ["request.json", "trace.json", "usage.json", "raw-response.json", "parsed.json", "outcome.json"]) {
    if (!seen.has(required)) throw new Error(`Attempt manifest omits required artifact: ${required}`);
  }
  return true;
};

const providerFromWireInput = (input) => {
  if (typeof input !== "string") throw new Error("Historical wire request input is not a string.");
  const marker = "Providers: ";
  const at = input.lastIndexOf(marker);
  if (at < 0) throw new Error("Historical wire request lacks Providers marker.");
  const providers = JSON.parse(input.slice(at + marker.length).trim());
  if (!Array.isArray(providers) || providers.length !== 1) throw new Error("Historical wire request is not one provider.");
  return providers[0];
};

const orderedRawResponses = (trace) => {
  const attempts = [...(trace.semanticAttempts || [])].sort((a, b) => a.semanticAttempt - b.semanticAttempt);
  const responses = [];
  for (const attempt of attempts) for (const send of [...(attempt.httpSends || [])]
    .sort((a, b) => a.sendIndex - b.sendIndex)) {
    if (send.rawResponse) responses.push(send.rawResponse);
  }
  if (!responses.length) throw new Error("Historical trace has no response-bearing HTTP sends.");
  return responses;
};

const expectedIdentityContext = (preregisteredCase) => ({
  request: preregisteredCase.request,
  cmsBaseline: preregisteredCase.cmsBaseline,
  nppesIdentity: { npi: preregisteredCase.gold?.identity?.npi,
    entityType: preregisteredCase.gold?.identity?.entityType }
});
const assertContext = (actual, expected, label) => {
  exact(actual?.request, expected.request, `${label} request`);
  exact(actual?.cmsBaseline, expected.cmsBaseline, `${label} CMS baseline`);
  exact(actual?.nppesIdentity, expected.nppesIdentity, `${label} NPPES identity`);
};

const adaptFullCase = ({ caseId, preregisteredCase, preregistrationDescriptor }) => {
  const caseRoot = path.join(PATHS.fullPhase1, caseId);
  const attemptsRoot = path.join(caseRoot, "attempts");
  const attemptNames = fs.readdirSync(attemptsRoot).filter((name) => /^attempt-\d+$/.test(name)).sort();
  exact(attemptNames, ["attempt-0001"], `${caseId} attempt set`);
  const attemptRoot = path.join(attemptsRoot, attemptNames[0]);
  const loaded = Object.fromEntries(["request", "trace", "usage", "raw-response", "parsed", "outcome", "manifest"]
    .map((name) => [name, requiredJson(path.join(attemptRoot, `${name}.json`))]));
  verifyAttemptManifest(attemptRoot, loaded.manifest.value);
  const requestArtifact = loaded.request.value;
  const trace = loaded.trace.value;
  const parsed = loaded.parsed.value;
  const outcome = loaded.outcome.value;
  const packetLoaded = requiredJson(path.join(PATHS.fullPackets, caseId, "packet.json"));
  const packet = packetLoaded.value;
  exact(loaded.manifest.value.bindings, requestArtifact.bindings, `${caseId} manifest/request bindings`);
  exact(outcome.bindings, requestArtifact.bindings, `${caseId} outcome/request bindings`);
  const expectedContext = expectedIdentityContext(preregisteredCase);
  assertContext(packet.identityContext, expectedContext, `${caseId} full packet`);
  exact(providerFromWireInput(requestArtifact.request?.input), preregisteredCase.request,
    `${caseId} wire provider request`);
  if (requestArtifact.bindings?.preregistrationSha256 !== preregistrationDescriptor.sha256) {
    throw new Error(`${caseId} request does not bind the actual preregistration file.`);
  }
  if (requestArtifact.bindings?.caseId !== caseId || requestArtifact.bindings?.armId !== "D36"
    || requestArtifact.bindings?.armCommit !== "d6afd2d2c24983ea2dbbdbdaf064864d17a13186") {
    throw new Error(`${caseId} historical request binding mismatch.`);
  }
  if (outcome.outcome !== "parsed_success" || outcome.caseId !== caseId || outcome.armId !== "D36") {
    throw new Error(`${caseId} is not a completed parsed-success D36 outcome.`);
  }
  const rawResponses = orderedRawResponses(trace);
  exact(rawResponses.at(-1), loaded["raw-response"].value, `${caseId} final raw response`);
  if (outcome.rawResponseSha256 !== sha256(stableJson(loaded["raw-response"].value))) {
    throw new Error(`${caseId} outcome final-response hash mismatch.`);
  }
  if (trace.httpSendCount !== rawResponses.length) {
    throw new Error(`${caseId} response-bearing send cardinality mismatch.`);
  }
  exact(parsed.finalProfiles || [], packet.finalSanitizedProfiles || [], `${caseId} final profiles`);
  exact(parsed.rawStructuredProfiles || [], packet.rawStructuredProfiles || [], `${caseId} raw parser profiles`);
  const artifact = {
    schemaVersion: 1,
    armId: "D36",
    armName: "full-length production prompt",
    armCommit: requestArtifact.armCommit,
    caseId,
    input: { lineOfCoverage: "Medical", providers: [preregisteredCase.request] },
    cmsBaseline: preregisteredCase.cmsBaseline,
    strata: preregisteredCase.strata,
    expectedInitialRequest: requestArtifact.request,
    // The common contract names the pre-sanitizer parser result
    // `parserProfiles`; D36 stored that same stage as rawStructuredProfiles.
    parserProfiles: parsed.rawStructuredProfiles || [],
    finalProfiles: parsed.finalProfiles || [],
    rawResponses,
    sends: trace.httpSends || [],
    trace: {
      actionSourceUrls: trace.actionSourceUrls || [],
      openedUrls: trace.openedUrls || [],
      citationUrls: trace.citationUrls || [],
      provenanceUrls: trace.provenanceUrls || [],
      calls: trace.calls || [],
      annotations: trace.annotations || [],
      output: rawResponses.flatMap((response) => response.output || []),
      semanticAttempts: trace.semanticAttempts || [],
      httpSendCount: trace.httpSendCount,
      httpRetryCount: trace.httpRetryCount
    },
    startedAt: outcome.startedAt,
    completedAt: outcome.completedAt,
    durationMs: outcome.timings?.phaseWallMs ?? null,
    usage: outcome.usageAndCost || loaded.usage.value,
    error: outcome.error || null,
    adaptation: {
      policy: "read_only_shape_adapter_no_reparse_no_resanitize_no_source_mutation",
      attemptRoot,
      attemptManifest: loaded.manifest.descriptor,
      sourceArtifacts: Object.fromEntries(Object.entries(loaded).map(([name, row]) => [name, row.descriptor])),
      legacyPacket: packetLoaded.descriptor,
      rawResponseCount: rawResponses.length
    }
  };
  assertFrozenProductionBinding(packet, artifact);
  return { artifact, packet, packetDescriptor: packetLoaded.descriptor,
    artifactSemanticSha256: sha256(stableJson(artifact)) };
};

const loadNativeCell = ({ armId, caseId, productionRoot, packetRoot, preregisteredCase }) => {
  const artifactLoaded = requiredJson(path.join(productionRoot, caseId, "artifact.json"));
  const packetFile = path.join(packetRoot, caseId, "packet.json");
  const packetLoaded = fs.existsSync(packetFile) ? requiredJson(packetFile) : null;
  const artifact = artifactLoaded.value;
  exact(artifact.input, { lineOfCoverage: "Medical", providers: [preregisteredCase.request] },
    `${armId}/${caseId} production input`);
  exact(artifact.cmsBaseline, preregisteredCase.cmsBaseline, `${armId}/${caseId} CMS baseline`);
  exact(artifact.strata, preregisteredCase.strata, `${armId}/${caseId} strata`);
  if (packetLoaded) {
    assertContext(packetLoaded.value.identityContext, expectedIdentityContext(preregisteredCase),
      `${armId}/${caseId} packet`);
    assertFrozenProductionBinding(packetLoaded.value, artifact);
  } else {
    if (armId !== "SUCCESSOR" || !["H006", "H027"].includes(caseId)) {
      throw new Error(`Unexpected missing legacy packet: ${armId}/${caseId}`);
    }
    if (classifyEmptyProductionOutcome(artifact) !== "parser_or_contract_failure") {
      throw new Error(`${armId}/${caseId} missing packet is not trace-proven parser/contract failure.`);
    }
  }
  return { artifact, artifactDescriptor: artifactLoaded.descriptor,
    packet: packetLoaded?.value || null, packetDescriptor: packetLoaded?.descriptor || null };
};

const buildCombinedManifest = () => {
  for (const value of Object.values(PATHS)) assertUnderWorkspace(value);
  const preregistrationLoaded = requiredJson(PATHS.preregistration);
  const preregistration = preregistrationLoaded.value;
  const preregByCase = new Map((preregistration.cases || []).map((row) => [row.caseId, row]));
  exact([...preregByCase.keys()].sort(), [...CASE_IDS], "Preregistered H001-H060 case set");
  const rows = [];
  for (const caseId of CASE_IDS) {
    const preregisteredCase = preregByCase.get(caseId);
    const full = adaptFullCase({ caseId, preregisteredCase,
      preregistrationDescriptor: preregistrationLoaded.descriptor });
    const successor = loadNativeCell({ armId: "SUCCESSOR", caseId,
      productionRoot: PATHS.successorProduction, packetRoot: PATHS.successorPackets, preregisteredCase });
    const candidate = loadNativeCell({ armId: "CANDIDATE72", caseId,
      productionRoot: PATHS.candidateProduction, packetRoot: PATHS.candidatePackets, preregisteredCase });
    const expectedContext = expectedIdentityContext(preregisteredCase);
    const fixedContextSha256 = sha256(stableJson(expectedContext));
    const requestSha256 = sha256(stableJson(preregisteredCase.request));
    rows.push({ armId: "D36", caseId, requestSha256, fixedContextSha256,
      productionArtifact: { kind: "derived_read_only", semanticSha256: full.artifactSemanticSha256,
        sourceAttemptRoot: full.artifact.adaptation.attemptRoot,
        sourceManifestSha256: full.artifact.adaptation.attemptManifest.sha256 },
      packet: full.packetDescriptor, status: "ready" });
    rows.push({ armId: "SUCCESSOR", caseId, requestSha256, fixedContextSha256,
      productionArtifact: successor.artifactDescriptor, packet: successor.packetDescriptor,
      status: successor.packet ? "ready" : "empty_packet_reconstruction_required" });
    rows.push({ armId: "CANDIDATE72", caseId, requestSha256, fixedContextSha256,
      productionArtifact: candidate.artifactDescriptor, packet: candidate.packetDescriptor, status: "ready" });
  }
  for (const armId of ARMS) {
    const armRows = rows.filter((row) => row.armId === armId);
    exact(armRows.map((row) => row.caseId), [...CASE_IDS], `${armId} exact case order`);
  }
  for (const caseId of CASE_IDS) {
    const caseRows = rows.filter((row) => row.caseId === caseId);
    exact(caseRows.map((row) => row.armId), [...ARMS], `${caseId} exact arm order`);
    if (new Set(caseRows.map((row) => row.requestSha256)).size !== 1
      || new Set(caseRows.map((row) => row.fixedContextSha256)).size !== 1) {
      throw new Error(`${caseId} cross-arm request/context binding mismatch.`);
    }
  }
  const manifest = {
    schemaVersion: 1,
    status: "exact_h001_h060_three_arm_campaign_ready_for_v4_refetch",
    dryRunOnly: true,
    sourceMutation: false,
    paidCallsMade: 0,
    arms: [...ARMS],
    caseIds: [...CASE_IDS],
    expectedCasesPerArm: 60,
    expectedCells: 180,
    preregistration: preregistrationLoaded.descriptor,
    pathBindings: PATHS,
    emptyPacketReconstructions: rows.filter((row) => row.status === "empty_packet_reconstruction_required")
      .map((row) => `${row.armId}/${row.caseId}`),
    rows
  };
  manifest.manifestSha256 = sha256(stableJson(manifest));
  return manifest;
};

const materializeDerivedOutput = (outputRoot) => {
  const resolvedOutput = path.resolve(outputRoot);
  if (resolvedOutput.startsWith(`${FULL_ROOT}${path.sep}`)
    || Object.values(PATHS).some((source) => resolvedOutput === source)) {
    throw new Error("Derived output may not overlap a historical source root.");
  }
  if (fs.existsSync(resolvedOutput)) throw new Error("Derived output root must not already exist.");
  const preregistrationLoaded = requiredJson(PATHS.preregistration);
  const preregByCase = new Map((preregistrationLoaded.value.cases || []).map((row) => [row.caseId, row]));
  const adaptedRows = [];
  for (const caseId of CASE_IDS) {
    const adapted = adaptFullCase({ caseId, preregisteredCase: preregByCase.get(caseId),
      preregistrationDescriptor: preregistrationLoaded.descriptor });
    const file = path.join(resolvedOutput, "cells", "D36", caseId, "artifact.json");
    writeJsonExclusive(file, adapted.artifact);
    const descriptor = fileDescriptor(file);
    const bindingFile = path.join(resolvedOutput, "cells", "D36", caseId, "binding-seal.json");
    writeJsonExclusive(bindingFile, {
      schemaVersion: 1,
      armId: "D36",
      caseId,
      policy: "historical_read_only_common_production_contract",
      derivedArtifact: descriptor,
      derivedArtifactSemanticSha256: adapted.artifactSemanticSha256,
      legacyPacket: adapted.packetDescriptor,
      sourceAttemptManifest: adapted.artifact.adaptation.attemptManifest,
      preregistration: preregistrationLoaded.descriptor,
      requestSha256: sha256(stableJson(preregByCase.get(caseId).request)),
      fixedContextSha256: sha256(stableJson(expectedIdentityContext(preregByCase.get(caseId))))
    });
    adaptedRows.push({ caseId, descriptor, semanticSha256: adapted.artifactSemanticSha256,
      bindingSeal: fileDescriptor(bindingFile),
      sourceAttemptManifestSha256: adapted.artifact.adaptation.attemptManifest.sha256 });
  }
  const sourceManifest = buildCombinedManifest();
  const outputManifest = {
    ...sourceManifest,
    status: "exact_h001_h060_three_arm_campaign_materialized_read_only_adapter",
    dryRunOnly: true,
    derivedProductionRoot: resolvedOutput,
    sourceManifestSha256: sourceManifest.manifestSha256,
    rows: sourceManifest.rows.map((row) => row.armId !== "D36" ? row : {
      ...row,
      productionArtifact: { kind: "derived_file", ...adaptedRows.find((item) => item.caseId === row.caseId) }
    })
  };
  delete outputManifest.manifestSha256;
  outputManifest.manifestSha256 = sha256(stableJson(outputManifest));
  const manifestFile = path.join(resolvedOutput, "combined-campaign-manifest.json");
  writeJsonExclusive(manifestFile, outputManifest);
  const manifestDescriptor = fileDescriptor(manifestFile);
  writeJsonExclusive(path.join(resolvedOutput, "ADAPTER_READY.json"), {
    schemaVersion: 1,
    status: "historical_full_holdout_adapter_ready",
    sourceMutation: false,
    networkCallsMade: 0,
    paidCallsMade: 0,
    fullLengthArtifactCount: adaptedRows.length,
    combinedCellCount: outputManifest.rows.length,
    sourceManifestSha256: sourceManifest.manifestSha256,
    outputManifestSemanticSha256: outputManifest.manifestSha256,
    outputManifestFile: manifestDescriptor
  });
  return { outputRoot: resolvedOutput, manifest: outputManifest, manifestDescriptor,
    readinessDescriptor: fileDescriptor(path.join(resolvedOutput, "ADAPTER_READY.json")) };
};

const main = () => {
  if (process.env.DRY_RUN === "0") throw new Error("This launcher is intentionally dry-run-only.");
  if (process.env.ALLOW_HISTORICAL_REPRODUCTION !== "YES") {
    throw new Error("historical_holdout_adapter.js requires ALLOW_HISTORICAL_REPRODUCTION=YES.");
  }
  if (process.env.OUTPUT_ROOT) {
    const result = materializeDerivedOutput(process.env.OUTPUT_ROOT);
    process.stdout.write(`${JSON.stringify({ outputRoot: result.outputRoot,
      manifestSha256: result.manifest.manifestSha256,
      manifestFile: result.manifestDescriptor,
      readinessFile: result.readinessDescriptor }, null, 2)}\n`);
  } else process.stdout.write(`${JSON.stringify(buildCombinedManifest(), null, 2)}\n`);
};

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { ARMS, CASE_IDS, PATHS, adaptFullCase, assertContext, buildCombinedManifest,
  expectedIdentityContext, loadNativeCell, materializeDerivedOutput, orderedRawResponses, providerFromWireInput,
  verifyAttemptManifest };

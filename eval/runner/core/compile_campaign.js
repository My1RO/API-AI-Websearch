#!/usr/bin/env node
"use strict";

// Offline-only compiler for corrected atomic + bounded-synthesis campaigns.
// It does not fetch, call a model, alter judgments, or compute an aggregate
// quality score. Every comparison is provider-paired and criterion-specific.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { authorityDigest, evaluatorRunnerAuthority,
  sameEvaluatorAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const SCHEMA_VERSION = 1;
const NONINFERIORITY_MARGIN = -0.05;
const NUMERIC_COMPARISON_EPSILON = 1e-12;
const CONTACT_FIELDS = new Set(["phone", "address", "website"]);
const BAD_READABLE = new Set(["partial", "not_found", "contradicted"]);
const CRITERIA = Object.freeze([
  Object.freeze({ id: "profile_returned", direction: "higher_is_better", source: "production" }),
  Object.freeze({ id: "professional_contact_returned", direction: "higher_is_better", source: "production" }),
  Object.freeze({ id: "critical_safety_finding", direction: "lower_is_better", source: "evaluator" }),
  Object.freeze({ id: "readable_material_support_defect", direction: "lower_is_better", source: "evaluator" }),
  Object.freeze({ id: "own_citation_support_defect", direction: "lower_is_better", source: "evaluator" }),
  Object.freeze({ id: "identity_attachment_defect", direction: "lower_is_better", source: "evaluator" }),
  Object.freeze({ id: "inappropriate_withholding", direction: "lower_is_better", source: "evaluator" }),
  Object.freeze({ id: "lower_tier_source_selected", direction: "lower_is_better", source: "evaluator" }),
  Object.freeze({ id: "citation_span_or_contract_defect", direction: "lower_is_better", source: "evaluator" })
]);

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableObject = (value) => Array.isArray(value) ? value.map(stableObject)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
    : value;
const stable = (value) => JSON.stringify(stableObject(value));
const resolveFrom = (base, value) => path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
const tsvCell = (value) => String(value == null ? "" : typeof value === "string" ? value : JSON.stringify(value))
  .replace(/[\t\r\n]+/g, " ");
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const writeTsv = (file, header, rows) => fs.writeFileSync(file,
  `${[header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\n")}\n`);
const quantile = (values, p) => {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const position = (xs.length - 1) * p;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return xs[lower] + (xs[upper] - xs[lower]) * (position - lower);
};
const distribution = (values) => {
  const xs = values.filter(Number.isFinite);
  const total = xs.reduce((sum, value) => sum + value, 0);
  return { n: xs.length, total, minimum: xs.length ? Math.min(...xs) : null,
    mean: xs.length ? total / xs.length : null, median: quantile(xs, 0.5),
    p90: quantile(xs, 0.9), p95: quantile(xs, 0.95), maximum: xs.length ? Math.max(...xs) : null };
};
const passesNoninferiority = (lowerBound, margin = NONINFERIORITY_MARGIN) =>
  lowerBound == null ? null : lowerBound + NUMERIC_COMPARISON_EPSILON >= margin;
const deepText = (value) => value == null ? "" : typeof value === "string" ? value
  : typeof value === "object" ? Object.values(value).map(deepText).join(" ") : String(value);
const operationalCensor = (artifact) => {
  if (!artifact?.error) return null;
  const lastSend = Array.isArray(artifact.sends) ? artifact.sends.at(-1) : null;
  const lastRaw = lastSend?.raw ?? (Array.isArray(artifact.rawResponses) ? artifact.rawResponses.at(-1) : null);
  const terminal = [artifact.error, artifact.phase1Outcome, artifact.phase2Outcome,
    artifact.terminalOutcome, artifact.trace?.terminalOutcome, lastRaw].filter((value) => value != null);
  const text = deepText(terminal).toLowerCase();
  return /content[ _-]?filter|responsibleaipolicyviolation/.test(text)
    ? "terminal_production_content_filter" : null;
};
const outputRootFresh = (root) => {
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error(`OUTPUT_ROOT must be absent or empty: ${root}`);
};
const fileDescriptor = (file) => {
  const body = fs.readFileSync(file);
  return { path: path.resolve(file), sha256: sha256(body), byteLength: body.length };
};

const normalizeConfig = (config, configFile, outputOverride = null) => {
  assert(config?.schemaVersion === 1, "Compiler manifest schemaVersion must be 1.");
  assert(config.campaignId && config.datasetRole, "campaignId and datasetRole are required.");
  assert(["development", "sealed_holdout"].includes(config.datasetRole),
    "datasetRole must be development or sealed_holdout.");
  const sealedHoldout = config.datasetRole === "sealed_holdout";
  assert(!sealedHoldout || config.auditMode === "preregistered_multi_arm_holdout",
    "Sealed holdout requires auditMode preregistered_multi_arm_holdout.");
  assert(sealedHoldout || config.auditMode == null || config.auditMode === "development_comparison",
    "Development may not use a holdout audit mode.");
  assert(config.protocolFile && /^[a-f0-9]{64}$/.test(config.protocolSha256 || ""),
    "protocolFile and protocolSha256 are required.");
  assert(config.caseBatteryFile && /^[a-f0-9]{64}$/.test(config.caseBatterySha256 || ""),
    "caseBatteryFile and caseBatterySha256 are required.");
  assert(typeof config.productionEndpoint === "string" && /^https:\/\/[^/]+\/openai\/v1\/responses$/.test(config.productionEndpoint),
    "An exact HTTPS Azure productionEndpoint ending /openai/v1/responses is required.");
  assert(Array.isArray(config.arms) && config.arms.length >= 2,
    "Every evaluator comparison requires at least two arms through the same compiler path.");
  assert(["jsonl_rows", "json_object_cases"].includes(config.caseBatteryFormat),
    "caseBatteryFormat must explicitly be jsonl_rows or json_object_cases.");
  assert((sealedHoldout && config.caseBatteryFormat === "json_object_cases")
    || (!sealedHoldout && config.caseBatteryFormat === "jsonl_rows"),
  "Development requires jsonl_rows; sealed holdout requires preregistered json_object_cases.");
  assert(["preserve_frozen_audit_context", "exclude_from_evaluator_context"]
    .includes(config.planNetworkContextPolicy),
  "planNetworkContextPolicy must explicitly declare whether frozen plan/network audit context is preserved or excluded.");
  const base = path.dirname(configFile);
  const ids = config.arms.map((arm) => arm.armId);
  assert(new Set(ids).size === ids.length, "Arm IDs must be unique.");
  assert(ids.includes(config.baselineArmId), "baselineArmId must name an arm.");
  const arms = config.arms.map((arm) => {
    assert(arm.armId && arm.name && arm.productionRoot, "Every arm needs armId, name, and productionRoot.");
    assert(/^[a-f0-9]{40}$/.test(arm.expectedArmCommit || ""),
      `Arm ${arm.armId} requires an exact 40-character expectedArmCommit.`);
    assert(Number.isSafeInteger(arm.promptStaticBytes) && arm.promptStaticBytes > 0,
      `Arm ${arm.armId} requires positive integer promptStaticBytes.`);
    const promptSnapshot = arm.promptSnapshot ? resolveFrom(base, arm.promptSnapshot) : null;
    if (promptSnapshot) {
      assert(fs.existsSync(promptSnapshot), `Missing prompt snapshot for ${arm.armId}.`);
      const descriptor = fileDescriptor(promptSnapshot);
      assert(descriptor.byteLength === arm.promptStaticBytes,
        `Prompt snapshot byte count differs for ${arm.armId}.`);
      if (arm.promptStaticSha256) assert(descriptor.sha256 === arm.promptStaticSha256,
        `Prompt snapshot hash differs for ${arm.armId}.`);
    }
    return { ...arm, productionRoot: resolveFrom(base, arm.productionRoot), promptSnapshot };
  });
  const protocolFile = resolveFrom(base, config.protocolFile);
  assert(fs.existsSync(protocolFile), "Frozen protocol file is missing.");
  const protocolDescriptor = fileDescriptor(protocolFile);
  assert(protocolDescriptor.sha256 === config.protocolSha256, "Frozen protocol SHA-256 differs from the manifest.");
  const caseBatteryFile = resolveFrom(base, config.caseBatteryFile);
  assert(fs.existsSync(caseBatteryFile), "Frozen development battery file is missing.");
  const caseBatteryDescriptor = fileDescriptor(caseBatteryFile);
  assert(caseBatteryDescriptor.sha256 === config.caseBatterySha256,
    "Frozen development battery SHA-256 differs from the manifest.");
  const paths = config.paths || {};
  for (const key of ["packetRoot", "atomicRoot", "synthesisRoot"]) assert(paths[key], `paths.${key} is required.`);
  const normalizedPaths = Object.fromEntries(Object.entries(paths).map(([key, value]) =>
    [key, value ? resolveFrom(base, value) : value]));
  const outputRoot = resolveFrom(base, outputOverride || config.outputRoot || "");
  assert(outputOverride || config.outputRoot, "outputRoot is required in the manifest or OUTPUT_ROOT.");
  const iterations = config.bootstrap?.iterations ?? 10_000;
  assert(iterations === 10_000, "The frozen development protocol requires exactly 10000 bootstrap resamples.");
  assert((config.bootstrap?.confidence ?? 0.95) === 0.95,
    "The frozen development protocol requires 95% bootstrap confidence intervals.");
  const minimumPromptReductionFraction = config.minimumPromptReductionFraction ?? 0.5;
  assert(minimumPromptReductionFraction === 0.5,
    "The frozen development protocol requires a 50% minimum static prompt-byte reduction.");
  return { ...config, arms, paths: normalizedPaths, outputRoot, protocolFile, protocolDescriptor,
    caseBatteryFile, caseBatteryDescriptor,
    expectedCasesPerArm: config.expectedCasesPerArm ?? null,
    minimumPromptReductionFraction, sealedHoldout,
    bootstrap: { iterations, seed: String(config.bootstrap?.seed || `${config.campaignId}:paired-bootstrap-v1`),
      confidence: config.bootstrap?.confidence ?? 0.95 } };
};

const createAuditedReader = () => {
  const descriptors = new Map();
  const read = (file, required = true) => {
    if (!fs.existsSync(file)) {
      if (required) throw new Error(`Missing required input: ${file}`);
      return null;
    }
    const body = fs.readFileSync(file);
    descriptors.set(path.resolve(file), { path: path.resolve(file), sha256: sha256(body), byteLength: body.length });
    return JSON.parse(body);
  };
  const audit = (file) => {
    const descriptor = fileDescriptor(file); descriptors.set(descriptor.path, descriptor); return descriptor;
  };
  return { read, audit, descriptors };
};
const verifyFileDescriptor = (reader, descriptor, label) => {
  assert(descriptor?.path && /^[a-f0-9]{64}$/.test(descriptor.sha256 || "")
    && Number.isSafeInteger(descriptor.byteLength), `${label} descriptor is incomplete.`);
  const actual = reader.audit(path.resolve(descriptor.path));
  assert(actual.sha256 === descriptor.sha256 && actual.byteLength === descriptor.byteLength,
    `${label} descriptor differs from the audited file.`);
  return actual;
};
const verifyCompilerAuthorityTransition = ({ sealedAuthority, currentAuthority, reader,
  expectedSourceAuthoritySha256 = null }) => {
  assert(sealedAuthority?.schemaVersion === 2 && sealedAuthority.authority === "unified_provider_evaluator",
    "Sealed evaluator runner authority has an invalid identity.");
  assert(Array.isArray(sealedAuthority.files) && sealedAuthority.files.length > 0,
    "Sealed evaluator runner authority has no file descriptors.");
  const sealedDigest = authorityDigest(sealedAuthority.files);
  assert(sealedDigest.authoritySha256 === sealedAuthority.authoritySha256,
    "Sealed evaluator runner authority descriptor digest is invalid.");
  assert(currentAuthority?.schemaVersion === 2 && currentAuthority.authority === "unified_provider_evaluator"
    && Array.isArray(currentAuthority.files), "Current compiler authority has an invalid identity.");
  assert(authorityDigest(currentAuthority.files).authoritySha256 === currentAuthority.authoritySha256,
    "Current compiler authority descriptor digest is invalid.");
  const sameAuthority = sameEvaluatorAuthority(sealedAuthority, currentAuthority);
  if (!sameAuthority) {
    assert(expectedSourceAuthoritySha256,
      "Sealed evaluator authority differs from the current compiler bundle; an explicit source authority is required.");
    assert(expectedSourceAuthoritySha256 === sealedAuthority.authoritySha256,
      "Compiler expected runner authority differs from the sealed source evaluator authority.");
  } else if (expectedSourceAuthoritySha256) {
    assert(expectedSourceAuthoritySha256 === sealedAuthority.authoritySha256,
      "Compiler expected runner authority differs from the sealed evaluator authority.");
  }
  const currentByName = new Map(currentAuthority.files.map((descriptor) => [descriptor.name, descriptor]));
  assert(currentByName.size === currentAuthority.files.length,
    "Current compiler authority repeats logical file names.");
  const seenNames = new Set(); const transitions = [];
  for (const sealedDescriptor of sealedAuthority.files) {
    assert(typeof sealedDescriptor.name === "string" && sealedDescriptor.name.length > 0
      && typeof sealedDescriptor.path === "string" && path.isAbsolute(sealedDescriptor.path)
      && /^[a-f0-9]{64}$/.test(sealedDescriptor.sha256 || "")
      && Number.isSafeInteger(sealedDescriptor.byteLength),
    "Sealed evaluator authority contains an incomplete file descriptor.");
    assert(!seenNames.has(sealedDescriptor.name),
      `Sealed evaluator authority repeats ${sealedDescriptor.name}.`);
    seenNames.add(sealedDescriptor.name);
    const currentDescriptor = currentByName.get(sealedDescriptor.name);
    assert(currentDescriptor, `Current compiler authority lacks ${sealedDescriptor.name}.`);
    assert(path.resolve(sealedDescriptor.path) === path.resolve(currentDescriptor.path),
      `Current compiler authority moved sealed path ${sealedDescriptor.name}.`);
    const actual = reader.audit(path.resolve(sealedDescriptor.path));
    const matchesSealed = actual.sha256 === sealedDescriptor.sha256
      && actual.byteLength === sealedDescriptor.byteLength;
    const matchesCurrent = actual.sha256 === currentDescriptor.sha256
      && actual.byteLength === currentDescriptor.byteLength;
    assert(matchesSealed || (!sameAuthority && matchesCurrent),
      `Sealed authority path ${sealedDescriptor.name} matches neither source nor current bytes.`);
    if (!matchesSealed) transitions.push({ name: sealedDescriptor.name, path: actual.path,
      sourceSha256: sealedDescriptor.sha256, sourceByteLength: sealedDescriptor.byteLength,
      currentSha256: actual.sha256, currentByteLength: actual.byteLength });
  }
  assert(seenNames.size === currentByName.size,
    "Current compiler authority contains files absent from the sealed source authority.");
  assert(sameAuthority || transitions.length > 0,
    "Authority transition declares different authority hashes without a changed descriptor.");
  return { schemaVersion: 1,
    mode: sameAuthority ? "identical_sealed_and_current_authority" : "explicit_compile_only_transition",
    sourceEvaluatorAuthoritySha256: sealedAuthority.authoritySha256,
    currentCompilerAuthoritySha256: currentAuthority.authoritySha256,
    expectedSourceAuthoritySha256: expectedSourceAuthoritySha256 || null,
    sealedPathDescriptorCount: sealedAuthority.files.length,
    transitionedFiles: transitions };
};
const resolveWithin = (root, relative, label) => {
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, relative || "");
  assert(file.startsWith(`${resolvedRoot}${path.sep}`) && fs.existsSync(file),
    `${label} is missing or escapes its expected root.`);
  return file;
};

const discoverPackets = (packetRoot, expectedArms, expectedCases, reader) => {
  const cells = new Map();
  for (const armId of expectedArms) {
    const root = path.join(packetRoot, armId);
    assert(fs.existsSync(root), `Missing packet arm root: ${armId}`);
    for (const caseId of fs.readdirSync(root).sort()) {
      const file = path.join(root, caseId, "packet.json");
      if (!fs.existsSync(file)) continue;
      const packet = reader.read(file);
      assert(packet.caseId === caseId, `Packet case ID mismatch: ${armId}/${caseId}`);
      cells.set(`${armId}:${caseId}`, { armId, caseId, packet, file });
    }
  }
  const reference = [...cells.values()].filter((cell) => cell.armId === expectedArms[0])
    .map((cell) => cell.caseId).sort();
  if (expectedCases != null) assert(reference.length === expectedCases,
    `Expected ${expectedCases} cases per arm; found ${reference.length}.`);
  assert(reference.length > 0, "No packet cases found.");
  for (const armId of expectedArms) {
    const cases = [...cells.values()].filter((cell) => cell.armId === armId).map((cell) => cell.caseId).sort();
    assert(stable(cases) === stable(reference), `Arm ${armId} packet case set differs.`);
  }
  for (const caseId of reference) {
    const rows = expectedArms.map((armId) => cells.get(`${armId}:${caseId}`));
    const requests = rows.map((row) => sha256(stable(row.packet.identityContext?.request)));
    const contexts = rows.map((row) => sha256(stable(row.packet.identityContext)));
    assert(new Set(requests).size === 1, `Provider request differs across arms for ${caseId}.`);
    assert(new Set(contexts).size === 1, `CMS/NPPES identity context differs across arms for ${caseId}.`);
  }
  return { cells, caseIds: reference };
};
const loadCaseBattery = (config, reader) => {
  reader.audit(config.caseBatteryFile);
  const body = fs.readFileSync(config.caseBatteryFile, "utf8");
  const rows = config.caseBatteryFormat === "json_object_cases" ? (() => {
    const parsed = JSON.parse(body);
    assert(Array.isArray(parsed.cases), "Sealed holdout preregistration must contain a cases array.");
    return parsed.cases;
  })() : body.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) {
      throw new Error(`Invalid battery JSONL row ${index + 1}: ${error.message}`);
    }
  });
  const byCase = new Map();
  for (const row of rows) {
    assert(row.caseId && row.request && !byCase.has(row.caseId), "Frozen battery has missing/duplicate case identity.");
    byCase.set(row.caseId, row);
  }
  const expectedCaseIds = config.packetVerification?.expectedCaseIds ?? null;
  if (expectedCaseIds) {
    assert(Array.isArray(expectedCaseIds) && expectedCaseIds.length > 0
      && new Set(expectedCaseIds).size === expectedCaseIds.length,
    "packetVerification.expectedCaseIds must be a non-empty unique case-ID list.");
    assert(config.expectedCasesPerArm == null || expectedCaseIds.length === config.expectedCasesPerArm,
      "Expected case-ID cardinality differs from expectedCasesPerArm.");
    const selected = new Map();
    for (const caseId of expectedCaseIds) {
      assert(byCase.has(caseId), `Frozen battery is missing expected case ${caseId}.`);
      selected.set(caseId, byCase.get(caseId));
    }
    return selected;
  }
  assert(config.expectedCasesPerArm == null || rows.length === config.expectedCasesPerArm,
    "Frozen battery case cardinality differs from the manifest.");
  return byCase;
};

const assertPlanNetworkIsolation = (config, packet, frozenCase, label) => {
  const packetEvidence = packet.identityContext?.planNetworkEvidence;
  if (config.planNetworkContextPolicy === "exclude_from_evaluator_context") {
    assert(packetEvidence == null,
      `Packet contains plan/network evidence excluded from Provider AI evaluation context: ${label}.`);
    return;
  }
  if (Object.hasOwn(frozenCase, "planNetworkEvidence")) {
    assert(stable(packetEvidence) === stable(frozenCase.planNetworkEvidence),
      `Packet plan/network evidence differs from the frozen battery: ${label}.`);
  } else assert(packetEvidence == null,
    `Packet contains unfrozen plan/network evidence: ${label}.`);
};

const productionFile = (arm, caseId) => {
  const candidates = [path.join(arm.productionRoot, "cells", arm.armId, caseId, "artifact.json"),
    path.join(arm.productionRoot, "cells", caseId, "artifact.json"),
    path.join(arm.productionRoot, caseId, "artifact.json")];
  const found = candidates.filter((file) => fs.existsSync(file));
  assert(found.length === 1, `Expected exactly one production artifact for ${arm.armId}/${caseId}; found ${found.length}.`);
  return found[0];
};
const CANONICAL_PROVIDER_PLACEHOLDER = Object.freeze({ providerId: "<providerId>", npi: "1234567890",
  name: "<name>", specialty: "<specialty>", city: "<city>", state: "NY", zip: "12345" });
const assertProductionRuntimeRequest = (request, label) => {
  const expectedKeys = ["include", "input", "instructions", "max_tool_calls", "model",
    "parallel_tool_calls", "reasoning", "store", "text", "tool_choice", "tools"].sort();
  assert(stable(Object.keys(request || {}).sort()) === stable(expectedKeys),
    `${label} request surface differs from the frozen production request.`);
  assert(request?.model === "gpt-5.6-terra", `${label} model differs from frozen production runtime.`);
  assert(request?.reasoning?.effort === "low", `${label} reasoning differs from frozen production runtime.`);
  assert(request.tool_choice === "required" && request.max_tool_calls === 8 && request.parallel_tool_calls === true,
    `${label} web-search tool policy differs from frozen production runtime.`);
  assert(stable(request.tools) === stable([{ type: "web_search" }]),
    `${label} native web_search configuration differs from the frozen runtime.`);
  assert(stable(request.include) === stable(["web_search_call.action.sources"]),
    `${label} consulted-source inclusion differs from the frozen runtime.`);
  assert(request.store === false && request.text?.format?.type === "json_schema"
    && request.text?.format?.strict === true,
    `${label} Responses/strict-output policy differs from frozen production runtime.`);
  return true;
};
const identityRetryRequest = (initial, providers) => {
  const serializedProviders = JSON.stringify(providers);
  assert(typeof initial.input === "string" && initial.input.split(serializedProviders).length - 1 === 1,
    "Frozen initial prompt does not contain exactly one serialized provider array.");
  const identityProviders = providers.map((provider) => ({ providerId: provider.providerId,
    npi: provider.npi, name: provider.name }));
  return { ...initial, input: initial.input.replace(serializedProviders, JSON.stringify(identityProviders)) };
};
const initialProductionRequest = (artifact) => artifact.expectedRequests?.initial
  ?? artifact.expectedInitialRequest;
const capturedProductionRequest = (send, productionEndpoint, label) => {
  const envelope = send?.request;
  if (!envelope?.body) {
    assert(send?.url === productionEndpoint, `${label} Azure Responses endpoint differs.`);
    return envelope;
  }
  assert(stable(Object.keys(envelope).sort()) === stable([
    "body", "bodyBytes", "bodySha256", "headers", "method", "url"
  ].sort()), `${label} transport envelope surface differs.`);
  const serialized = JSON.stringify(envelope.body);
  assert(envelope.method === "POST" && envelope.url === productionEndpoint,
    `${label} transport method or Azure Responses endpoint differs.`);
  assert(envelope.bodyBytes === Buffer.byteLength(serialized)
    && envelope.bodySha256 === sha256(serialized), `${label} transport body integrity differs.`);
  return envelope.body;
};
const assertProductionArtifact = (artifact, packetRequest, expectedArmCommit, productionEndpoint, label) => {
  assert(artifact.armCommit === expectedArmCommit, `${label} arm commit differs from the frozen treatment commit.`);
  assert(Array.isArray(artifact.input?.providers) && artifact.input.providers.length === 1
    && stable(artifact.input.providers[0]) === stable(packetRequest), `${label} production provider payload differs.`);
  assert(artifact.input.lineOfCoverage === "Medical", `${label} lineOfCoverage differs from the frozen public API request.`);
  const expectedInitialRequest = initialProductionRequest(artifact);
  assertProductionRuntimeRequest(expectedInitialRequest, `${label} expected request`);
  assert(Array.isArray(artifact.sends) && artifact.sends.length >= 1 && artifact.sends.length <= 3,
    `${label} HTTP-send count is outside the bounded transport-plus-semantic retry path.`);
  const capturedRequests = artifact.sends.map((send, index) => {
    const request = capturedProductionRequest(send, productionEndpoint, `${label} send ${index + 1}`);
    assertProductionRuntimeRequest(request, `${label} send ${index + 1}`);
    return request;
  });
  assert(stable(capturedRequests[0]) === stable(expectedInitialRequest),
    `${label} first send differs from the measured initial treatment request.`);
  const fullRetry = stable(expectedInitialRequest);
  const strippedRetry = stable(identityRetryRequest(expectedInitialRequest, artifact.input.providers));
  let identityRetryObserved = false;
  for (const [index, request] of capturedRequests.slice(1).entries()) {
    const serialized = stable(request);
    assert([fullRetry, strippedRetry].includes(serialized),
      `${label} send ${index + 2} is neither the exact full retry nor the exact identity-only retry transform.`);
    assert(!identityRetryObserved || serialized === strippedRetry,
      `${label} returned to a full request after entering the identity-only retry path.`);
    if (strippedRetry !== fullRetry && serialized === strippedRetry) {
      assert(!identityRetryObserved, `${label} repeated the one-shot identity-only semantic retry.`);
      identityRetryObserved = true;
    }
  }
  return true;
};
const staticPromptMeasurement = (artifact, label) => {
  const request = initialProductionRequest(artifact);
  const instructions = request.instructions;
  const schema = JSON.stringify(request.text?.format?.schema);
  const dynamicProviders = JSON.stringify(artifact.input.providers);
  assert(typeof instructions === "string" && schema && typeof request.input === "string",
    `${label} lacks exact serialized static-contract inputs.`);
  assert(request.input.split(dynamicProviders).length - 1 === 1,
    `${label} user prompt does not contain exactly one serialized provider array.`);
  const userPrompt = request.input.replace(dynamicProviders, JSON.stringify([CANONICAL_PROVIDER_PLACEHOLDER]));
  const component = (value) => ({ utf8Bytes: Buffer.byteLength(value), characters: value.length, sha256: sha256(value) });
  const components = { instructions: component(instructions), schema: component(schema), userPrompt: component(userPrompt) };
  return { totalUtf8Bytes: Object.values(components).reduce((sum, row) => sum + row.utf8Bytes, 0), components };
};
const profileFacts = (artifact) => (artifact.finalProfiles || []).flatMap((profile) => [
  ...(profile.phoneNumbers || []).map((item) => ({ fieldType: "phone", item })),
  ...(profile.locations || []).map((item) => ({ fieldType: "address", item })),
  ...(profile.websites || []).map((item) => ({ fieldType: "website", item })),
  ...(profile.ratings || []).map((item) => ({ fieldType: "rating", item })),
  ...(profile.specialties || []).map((item) => ({ fieldType: "specialty", item }))
]);
const productionMetrics = (artifact, label = "production artifact") => {
  const sends = artifact.sends || [];
  const aggregateUsage = artifact.usage;
  if (aggregateUsage && !Array.isArray(aggregateUsage)) {
    const rateCard = aggregateUsage.pricingVersion === "azure-public-list-2026-07-30"
      ? { input: 2.5, cachedInput: 0.25, cacheWrite: 3.125, output: 15, webSearch: 14 } : null;
    const attempts = sends.map((send, index) => {
      const raw = send.rawResponse ?? send.raw ?? null;
      const row = raw?.usage;
      const inputTokens = row?.input_tokens ?? null;
      const cachedInputTokens = row?.input_tokens_details?.cached_tokens ?? null;
      const cacheWriteTokens = row?.input_tokens_details?.cache_write_tokens ?? 0;
      const outputTokens = row?.output_tokens ?? null;
      const reasoningOutputTokens = row?.output_tokens_details?.reasoning_tokens ?? null;
      const webSearchCalls = raw ? (raw.output || []).filter((item) => item?.type === "web_search_call").length : null;
      const costUsd = rateCard && Number.isFinite(inputTokens) && Number.isFinite(cachedInputTokens)
        && Number.isFinite(outputTokens) && Number.isFinite(webSearchCalls)
        ? Math.max(0, inputTokens - cachedInputTokens) * rateCard.input / 1e6
          + cachedInputTokens * rateCard.cachedInput / 1e6
          + cacheWriteTokens * rateCard.cacheWrite / 1e6
          + outputTokens * rateCard.output / 1e6
          + webSearchCalls * rateCard.webSearch / 1000 : null;
      return { attemptIndex: index + 1, httpStatus: send.status ?? null, transportError: send.error ?? null,
        inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, webSearchCalls,
        latencyMs: send.latencyMs ?? null, costUsd, costKnown: Number.isFinite(costUsd),
        pricingVersion: aggregateUsage.pricingVersion ?? null };
    });
    const responseBearing = sends.filter((send) => (send.rawResponse ?? send.raw) != null).length;
    assert(responseBearing === aggregateUsage.responseBearingAttemptCount,
      `${label} aggregate response-bearing attempt count differs from sends.`);
    const knownAttemptCost = attempts.map((row) => row.costUsd).filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    if (Number.isFinite(aggregateUsage.totalUsd) && attempts.every((row) => row.costKnown)) {
      assert(Math.abs(knownAttemptCost - aggregateUsage.totalUsd) < 1e-9,
        `${label} reconstructed attempt costs differ from the frozen aggregate cost.`);
    }
    const knownWebSearches = attempts.map((row) => row.webSearchCalls).filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    assert(!Number.isFinite(aggregateUsage.webSearchCalls)
      || knownWebSearches === aggregateUsage.webSearchCalls,
    `${label} reconstructed web-search calls differ from the frozen aggregate.`);
    const completeCost = Number.isFinite(aggregateUsage.totalUsd)
      && aggregateUsage.usageMissingAttemptCount === 0;
    return { costUsd: completeCost ? aggregateUsage.totalUsd : null,
      knownCostUsd: Number.isFinite(aggregateUsage.capturedKnownCostUsd)
        ? aggregateUsage.capturedKnownCostUsd : knownAttemptCost,
      unknownCostAttempts: aggregateUsage.usageMissingAttemptCount ?? attempts.filter((row) => !row.costKnown).length,
      latencyMs: Number.isFinite(artifact.durationMs) ? artifact.durationMs : null,
      httpSends: sends.length,
      webSearches: aggregateUsage.usageMissingAttemptCount === 0 ? aggregateUsage.webSearchCalls : null,
      knownWebSearches, unknownWebSearchAttempts: aggregateUsage.usageMissingAttemptCount
        ?? attempts.filter((row) => !Number.isFinite(row.webSearchCalls)).length,
      usage: aggregateUsage, attempts };
  }
  const usage = aggregateUsage || [];
  const usageBySend = new Array(sends.length).fill(null);
  if (usage.length === sends.length) usage.forEach((row, index) => { usageBySend[index] = row; });
  else {
    const responseSendIndices = sends.flatMap((send, index) => send.raw != null ? [index] : []);
    assert(responseSendIndices.length === usage.length,
      `${label} usage cannot be aligned to response-bearing HTTP sends `
      + `(sends=${sends.length}, responseSends=${responseSendIndices.length}, usageRows=${usage.length}).`);
    usage.forEach((row, index) => { usageBySend[responseSendIndices[index]] = row; });
  }
  const attempts = sends.map((send, index) => {
    const row = usageBySend[index];
    return { attemptIndex: index + 1, httpStatus: send.status ?? null, transportError: send.error ?? null,
      inputTokens: row?.inputTokens ?? null, cachedInputTokens: row?.cachedInputTokens ?? null,
      outputTokens: row?.outputTokens ?? null, reasoningOutputTokens: row?.reasoningOutputTokens ?? null,
      webSearchCalls: row?.webSearchCalls ?? null, latencyMs: row?.latencyMs ?? send.latencyMs ?? null,
      costUsd: Number.isFinite(row?.totalUsd) ? row.totalUsd : null,
      costKnown: Number.isFinite(row?.totalUsd), pricingVersion: row?.pricingVersion ?? null };
  });
  const knownCostUsd = attempts.map((row) => row.costUsd).filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const unknownCostAttempts = attempts.filter((row) => !row.costKnown).length;
  const knownWebSearches = attempts.map((row) => row.webSearchCalls).filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  return { costUsd: unknownCostAttempts ? null : knownCostUsd, knownCostUsd, unknownCostAttempts,
    latencyMs: Number.isFinite(artifact.durationMs) ? artifact.durationMs : null,
    httpSends: (artifact.sends || []).length,
    webSearches: attempts.every((row) => Number.isFinite(row.webSearchCalls)) ? knownWebSearches : null,
    knownWebSearches, unknownWebSearchAttempts: attempts.filter((row) => !Number.isFinite(row.webSearchCalls)).length,
    usage, attempts };
};

const judgmentWithBindings = (parsed, packet) => {
  assert(parsed && !Object.hasOwn(parsed, "score"), "Evaluator aggregate score is forbidden.");
  const claims = packet.claims || [];
  const candidates = packet.preSanitizerCandidates || [];
  const expectedFields = packet.expectedFields || [];
  assert((parsed.sourceAssessments || []).length === (packet.sources || []).length,
    "Source judgment cardinality mismatch.");
  assert((parsed.claimAssessments || []).length === claims.length, "Claim judgment cardinality mismatch.");
  assert((parsed.candidateDecisionAssessments || []).length === candidates.length,
    "Candidate judgment cardinality mismatch.");
  assert((parsed.fieldAssessments || []).length === expectedFields.length, "Field judgment cardinality mismatch.");
  const sourceList = packet.sources || [];
  const sources = new Map(sourceList.map((source) => [source.sourceId, source]));
  return { ...parsed,
    sourceAssessments: parsed.sourceAssessments.map((row, index) => ({ ...row,
      sourceId: sourceList[index]?.sourceId ?? null, sourceUrl: sourceList[index]?.url ?? null,
      sourceTitle: sourceList[index]?.titles?.[0] ?? null })),
    claimAssessments: parsed.claimAssessments.map((row, index) => {
      const claim = claims[index] || {}; const source = sources.get(claim.sourceId) || {};
      return { ...row,
        claimId: claim.claimId || `claim:${index}`, fieldType: claim.fieldType || "unknown",
        value: claim.value ?? null, sourceId: claim.sourceId ?? null,
        sourceUrl: claim.citationUrl ?? claim.modelCitation?.sourceUrl ?? source.url ?? null,
        sourceTitle: claim.citationTitle ?? claim.modelCitation?.sourceTitle ?? source.titles?.[0] ?? null,
        submittedCitation: claim.modelCitation ?? null };
    }),
    candidateDecisionAssessments: parsed.candidateDecisionAssessments.map((row, index) => {
      const candidate = candidates[index] || {}; const source = sources.get(candidate.sourceId) || {};
      return { ...row, candidateFactId: candidate.candidateFactId || `candidate:${index}`,
        fieldType: candidate.fieldType || "unknown", value: candidate.value ?? null,
        sourceId: candidate.sourceId ?? null,
        sourceUrl: candidate.citationUrl ?? candidate.modelCitation?.sourceUrl ?? source.url ?? null,
        sourceTitle: candidate.citationTitle ?? candidate.modelCitation?.sourceTitle ?? source.titles?.[0] ?? null,
        submittedCitation: candidate.modelCitation ?? null,
        sanitizerActionObserved: candidate.sanitizerActionObserved ?? null,
        sanitizerReasonCode: candidate.sanitizerReasonCode ?? null };
    }),
    fieldAssessments: parsed.fieldAssessments.map((row, index) => ({ ...row,
      fieldType: typeof expectedFields[index] === "string" ? expectedFields[index]
        : expectedFields[index]?.fieldType || "unknown" })) };
};

const manualArtifacts = (config, reader, expectedArms, expectedCases, expectedSchemaAudit, categoricalSchema,
  expectedRunnerAuthority = null) => {
  const sealFile = config.paths.manualSealFile;
  const mapFile = config.paths.manualMapFile;
  if (!sealFile) return { decisions: new Map(), censoredCases: new Map(), manualCases: new Set(), seal: null };
  const seal = reader.read(sealFile);
  assert(seal.status === "MANUAL_REVIEW_SEALED", "Manual review seal status is invalid.");
  assert(seal.expectedArmCount === expectedArms.length, "Manual seal expectedArmCount differs from the campaign.");
  const campaignRoot = path.dirname(sealFile);
  const manifestFile = path.join(campaignRoot, "campaign-manifest.json");
  const manifestBody = fs.readFileSync(manifestFile); const manifest = reader.read(manifestFile);
  assert(sha256(manifestBody) === seal.manifestSha256, "Manual campaign manifest hash differs from the final seal.");
  assert(manifest.status === "MANUAL_REVIEW_READY" && manifest.expectedArmCount === expectedArms.length,
    "Manual campaign manifest identity/cardinality is invalid.");
  if (expectedRunnerAuthority) {
    assert(sameEvaluatorAuthority(manifest.runnerAuthority, expectedRunnerAuthority),
      "Manual and automatic evaluators do not use the identical runner authority.");
    for (const descriptor of evaluatorRunnerAuthority(__dirname).files) verifyFileDescriptor(reader, descriptor,
      `Manual evaluator authority file ${descriptor.name || "unknown"}`);
    assert(seal.evaluatorAuthoritySha256 === expectedRunnerAuthority.authoritySha256,
      "Manual final seal does not bind the automatic evaluator authority.");
  }
  assert(stable(manifest.schemaAudit) === stable(expectedSchemaAudit),
    "Manual and automatic evaluators do not use the identical frozen categorical schema.");
  verifyFileDescriptor(reader, manifest.schemaAudit, "Manual categorical schema");
  assert(mapFile, "manualMapFile is required with a final manual seal.");
  const mapBody = fs.readFileSync(mapFile); reader.audit(mapFile);
  assert(sha256(mapBody) === seal.mapSha256, "Manual unblinding map hash differs from the final seal.");
  const sealedMap = JSON.parse(mapBody);
  assert(manifest.sealedMapSha256 === sha256(JSON.stringify(sealedMap)),
    "Manual public manifest does not bind the supplied unblinding map.");
  assert(stable([...(sealedMap.expectedArms || [])].sort()) === stable([...expectedArms].sort()),
    "Manual unblinding map arm set differs from the campaign.");
  assert(sealedMap.expectedCasesPerArm === expectedCases.length,
    "Manual unblinding map expectedCasesPerArm differs from the campaign.");
  assert(Array.isArray(sealedMap.allCases), "Manual unblinding map provider battery is missing.");
  if (sealedMap.allCasesSha256 != null) assert(sealedMap.allCasesSha256 === sha256(JSON.stringify(sealedMap.allCases)),
    "Manual unblinding map provider battery binding is invalid.");
  const sealedCaseIds = sealedMap.allCases.map((row) => typeof row === "string" ? row : row?.caseId);
  assert(sealedCaseIds.every((caseId) => typeof caseId === "string")
    && new Set(sealedCaseIds).size === sealedCaseIds.length
    && stable([...sealedCaseIds].sort()) === stable([...expectedCases].sort()),
    "Manual unblinding map provider battery differs from the campaign.");
  for (const row of sealedMap.allCases.filter((item) => typeof item !== "string")) {
    assert(/^[a-f0-9]{64}$/.test(row.requestSha256 || "")
      && /^[a-f0-9]{64}$/.test(row.fixedContextSha256 || ""),
    `Manual unblinding map fixed-context binding is invalid for ${row.caseId || "unknown case"}.`);
  }
  const mappingsByKey = new Map();
  const unitsById = new Map((manifest.units || []).map((unit) => [unit.unitId, unit]));
  for (const mapping of sealedMap.mappings || []) {
    const key = `${mapping.armId}:${mapping.caseId}`;
    assert(!mappingsByKey.has(key), `Manual unblinding map repeats ${key}.`);
    const unit = unitsById.get(mapping.unitId);
    assert(unit && unit.blindCaseId === mapping.blindCaseId && unit.blindArmId === mapping.blindArmId
      && unit.inputSha256 === mapping.inputSha256,
    `Manual public/private unit binding differs for ${key}.`);
    const unitRoot = path.join(campaignRoot, "review-units", mapping.blindCaseId, mapping.blindArmId);
    const inputFile = resolveWithin(unitRoot, "review-input.json", `Manual review input ${key}`);
    assert(reader.audit(inputFile).sha256 === mapping.inputSha256, `Manual review input changed for ${key}.`);
    mappingsByKey.set(key, { mapping, unit, unitRoot });
  }
  assert(unitsById.size === mappingsByKey.size, "Manual public manifest and unblinding map unit counts differ.");
  const decisions = new Map();
  for (const row of seal.decisions || []) {
    assert(expectedArms.includes(row.armId), `Manual decision names unknown arm ${row.armId}.`);
    assert(expectedCases.includes(row.caseId), `Manual decision names unknown case ${row.caseId}.`);
    const key = `${row.armId}:${row.caseId}`;
    assert(!decisions.has(key), `Duplicate manual decision ${key}.`);
    assert(row.categoricalOutput && !Object.hasOwn(row.categoricalOutput, "score"),
      `Manual decision ${key} contains an aggregate score.`);
    const bound = mappingsByKey.get(key);
    assert(bound && row.blindCaseId === bound.mapping.blindCaseId && row.blindArmId === bound.mapping.blindArmId,
      `Manual decision ${key} does not match its sealed blind unit.`);
    const parsed = categoricalSchema.parse(row.categoricalOutput);
    assert(row.outputSha256 === sha256(JSON.stringify(parsed)),
      `Manual decision ${key} categorical output hash is invalid.`);
    const outputFile = resolveWithin(bound.unitRoot, "review-output.json", `Manual review output ${key}`);
    const wrapper = reader.read(outputFile);
    assert(stable(wrapper.categoricalOutput) === stable(parsed),
      `Manual review wrapper output differs from the sealed decision ${key}.`);
    const traceFile = resolveWithin(bound.unitRoot, wrapper.rawReviewTraceArtifact?.path,
      `Manual raw review trace ${key}`);
    const trace = reader.audit(traceFile);
    assert(wrapper.rawReviewTraceArtifact.complete === true
      && wrapper.rawReviewTraceArtifact.sha256 === trace.sha256
      && wrapper.rawReviewTraceArtifact.byteLength === trace.byteLength
      && row.rawReviewTraceSha256 === trace.sha256,
    `Manual raw review trace binding differs for ${key}.`);
    row.categoricalOutput = parsed;
    decisions.set(key, row);
  }
  const censoredCases = new Map();
  if ((seal.censoredCases || []).length) {
    for (const censor of seal.censoredCases) {
      const mappings = (sealedMap.mappings || []).filter((row) => row.blindCaseId === censor.blindCaseId);
      assert(mappings.length === expectedArms.length, "Censored manual case lacks an exact all-arm unblinding map.");
      assert(new Set(mappings.map((row) => row.caseId)).size === 1, "Censored blind case maps to multiple providers.");
      const caseId = mappings[0].caseId;
      assert(expectedCases.includes(caseId), `Censored manual decision names unknown case ${caseId}.`);
      assert(stable([...new Set(mappings.map((row) => row.armId))].sort()) === stable([...expectedArms].sort()),
        `Censored manual case ${caseId} does not cover every arm.`);
      assert(!censoredCases.has(caseId), `Duplicate censored manual case ${caseId}.`);
      censoredCases.set(caseId, censor.reason || "paired_manual_incomplete");
    }
  }
  const decisionCases = new Set([...decisions.values()].map((row) => row.caseId));
  for (const caseId of decisionCases) {
    const caseArms = [...decisions.values()].filter((row) => row.caseId === caseId).map((row) => row.armId).sort();
    assert(stable(caseArms) === stable([...expectedArms].sort()),
      `Completed manual case ${caseId} does not contain every expected arm exactly once.`);
    assert(!censoredCases.has(caseId), `Manual case ${caseId} is both completed and censored.`);
  }
  const manualCases = new Set([...decisionCases, ...censoredCases.keys()]);
  assert(manifest.manualCaseCount === manualCases.size
    && manifest.expectedCompletedUnitCount === manualCases.size * expectedArms.length,
  "Manual public manifest cardinality differs from the sealed manual case matrix.");
  const mapKeys = [];
  for (const mapping of sealedMap.mappings || []) {
    assert(expectedCases.includes(mapping.caseId), `Manual map names unknown case ${mapping.caseId}.`);
    assert(expectedArms.includes(mapping.armId), `Manual map names unknown arm ${mapping.armId}.`);
    mapKeys.push(`${mapping.caseId}:${mapping.armId}`);
  }
  assert(new Set(mapKeys).size === mapKeys.length, "Manual unblinding map repeats a case/arm unit.");
  const expectedMapKeys = [...manualCases].flatMap((caseId) => expectedArms.map((armId) => `${caseId}:${armId}`)).sort();
  assert(stable(mapKeys.sort()) === stable(expectedMapKeys),
    "Manual unblinding map does not contain the exact sealed manual case/arm matrix.");
  assert(seal.manualCaseCount === manualCases.size, "Manual seal manualCaseCount is internally inconsistent.");
  assert(seal.completedUnits === decisions.size, "Manual seal completedUnits is internally inconsistent.");
  // The manual harness seals this exact insertion-ordered JSON payload with
  // JSON.stringify. Reproduce that wire format here; `stable()` sorts object
  // keys and therefore computes a different digest for the same values.
  const expectedCardinalitySeal = sha256(JSON.stringify({ expectedArmCount: seal.expectedArmCount,
    manualCaseCount: seal.manualCaseCount,
    completed: [...decisions.values()].map((row) => [row.caseId, row.armId]).sort(),
    censoredCases: seal.censoredCases || [] }));
  assert(seal.unblindedCardinalitySealSha256 === expectedCardinalitySeal,
    "Manual unblinded cardinality seal is invalid.");
  return { decisions, censoredCases, manualCases, seal, sealedMap };
};

const evaluatorCostBreakdown = (result) => {
  const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
  const unknownCostAttempts = attempts.filter((attempt) => attempt.usage == null).length;
  const knownCostUsd = Number.isFinite(result?.totalEstimatedUsd) ? result.totalEstimatedUsd
    : Number.isFinite(result?.estimatedCost?.estimatedUsd) ? result.estimatedCost.estimatedUsd : 0;
  return { costUsd: unknownCostAttempts ? null : knownCostUsd, knownCostUsd, unknownCostAttempts };
};
const auditEvaluatorAttempts = (result, cellRoot, reader, label) => {
  assert(Array.isArray(result.attempts) && result.attempts.length > 0, `${label} lacks semantic-attempt traces.`);
  return result.attempts.map((attempt, index) => {
    assert(typeof attempt.rawFile === "string", `${label} attempt ${index + 1} lacks a raw response artifact.`);
    return reader.audit(resolveWithin(cellRoot, attempt.rawFile, `${label} raw attempt ${index + 1}`));
  });
};
const collectEvaluatorOperations = (config, armId, caseId, reader) => {
  const rows = [];
  const atomicCell = path.join(config.paths.atomicRoot, "cells", armId, caseId);
  if (fs.existsSync(atomicCell)) {
    for (const name of fs.readdirSync(atomicCell).filter((value) => /^result-\d+\.json$/.test(value)).sort()) {
      const result = reader.read(path.join(atomicCell, name));
      const rawAttemptArtifacts = auditEvaluatorAttempts(result, atomicCell, reader,
        `Atomic ${armId}/${caseId}/${name}`);
      const cost = evaluatorCostBreakdown(result);
      rows.push({ stage: "atomic", operationId: name.replace(/\.json$/, ""), status: result.status || "unknown",
        durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
        ...cost, semanticAttempts: result.attempts.length, rawAttemptArtifacts });
    }
  }
  const synthesisFile = path.join(config.paths.synthesisRoot, "cells", armId, caseId, "result.json");
  const synthesis = reader.read(synthesisFile, false);
  if (synthesis) {
    const synthesisCell = path.dirname(synthesisFile);
    const rawAttemptArtifacts = auditEvaluatorAttempts(synthesis, synthesisCell, reader,
      `Synthesis ${armId}/${caseId}`);
    const cost = evaluatorCostBreakdown(synthesis);
    rows.push({ stage: "synthesis", operationId: "synthesis", status: synthesis.status || "unknown",
      durationMs: Number.isFinite(synthesis.durationMs) ? synthesis.durationMs : null,
      ...cost, semanticAttempts: synthesis.attempts.length, rawAttemptArtifacts });
  }
  return { rows, synthesis };
};

const verifyInternalCampaignSeal = (seal, label) => {
  assert(seal && /^[a-f0-9]{64}$/.test(seal.sealSha256 || ""), `${label} lacks a seal SHA-256.`);
  const unsigned = { ...seal }; delete unsigned.sealSha256;
  assert(sha256(JSON.stringify(unsigned)) === seal.sealSha256, `${label} internal seal is invalid.`);
  return seal;
};
const exactCellKeys = (arms, caseIds, excludedCases = new Set()) => arms.flatMap((armId) =>
  caseIds.filter((caseId) => !excludedCases.has(caseId)).map((caseId) => `${armId}:${caseId}`)).sort();
const verifyEvaluatorCampaigns = (config, packets, armIds, caseIds, reader,
  expectedSourceAuthoritySha256 = null) => {
  const atomicSeal = verifyInternalCampaignSeal(reader.read(path.join(config.paths.atomicRoot,
    "CAMPAIGN_PLAN_SEAL.json")), "Atomic campaign plan");
  const atomicSummary = reader.read(path.join(config.paths.atomicRoot, "summary.json"));
  assert(atomicSeal.kind === "provider_atomic_evaluator" && atomicSeal.model === "gpt-5.6-sol"
    && atomicSeal.reasoning === "high", "Atomic campaign is not the frozen Sol/high evaluator.");
  assert(atomicSummary.dryRun === false && atomicSummary.model === "gpt-5.6-sol"
    && atomicSummary.reasoning === "high", "Atomic root is not a completed live Sol/high campaign.");
  assert(path.resolve(atomicSeal.packetRoot) === path.resolve(config.paths.packetRoot),
    "Atomic campaign packet root differs from the compiler packet root.");
  assert(atomicSeal.runtimeManifest?.model === "gpt-5.6-sol"
    && atomicSeal.runtimeManifest?.reasoning === "high", "Atomic runtime manifest differs from Sol/high.");
  assert(stable(atomicSummary.runtimeManifest) === stable(atomicSeal.runtimeManifest),
    "Atomic summary runtime manifest differs from the sealed runtime manifest.");
  const atomicKeys = (atomicSeal.cells || []).map((cell) => `${cell.armId}:${cell.caseId}`).sort();
  assert(stable(atomicKeys) === stable(exactCellKeys(armIds, caseIds)),
    "Atomic plan does not cover the exact arm/case matrix.");
  assert(new Set(atomicKeys).size === atomicKeys.length, "Atomic plan repeats arm/case cells.");
  const atomicManual = new Set(atomicSeal.manualCaseIds || []);
  const atomicCensor = new Set(atomicSeal.operationalCensorCaseIds || []);
  const atomicRuntimeManual = new Set();
  for (const caseId of [...atomicManual, ...atomicCensor]) assert(caseIds.includes(caseId),
    `Atomic seal disposition names unknown case ${caseId}.`);
  let totalAtomicRequests = 0;
  for (const cell of atomicSeal.cells || []) {
    const packet = packets.get(`${cell.armId}:${cell.caseId}`).packet;
    const packetHash = packet.packetSha256 || sha256(JSON.stringify(packet));
    assert(cell.packetSha256 === packetHash, `Atomic packet binding differs for ${cell.armId}/${cell.caseId}.`);
    const indices = (cell.requests || []).map((request) => request.requestIndex);
    assert(new Set(indices).size === indices.length, `Atomic request indices repeat for ${cell.armId}/${cell.caseId}.`);
    totalAtomicRequests += indices.length;
    for (const request of cell.requests || []) {
      const requestFile = path.join(config.paths.atomicRoot, "cells", cell.armId, cell.caseId,
        `request-${request.requestIndex}.json`);
      const requestBody = reader.read(requestFile);
      assert(sha256(JSON.stringify(requestBody)) === request.requestSha256,
        `Atomic request binding differs for ${cell.armId}/${cell.caseId}/${request.requestIndex}.`);
    }
    const resultRoot = path.join(config.paths.atomicRoot, "cells", cell.armId, cell.caseId);
    const actualResults = fs.existsSync(resultRoot) ? fs.readdirSync(resultRoot)
      .filter((name) => /^result-\d+\.json$/.test(name)).sort() : [];
    const expectedResults = atomicManual.has(cell.caseId) || atomicCensor.has(cell.caseId) ? []
      : indices.map((index) => `result-${index}.json`).sort();
    assert(stable(actualResults) === stable(expectedResults),
      `Atomic live result set differs for ${cell.armId}/${cell.caseId}.`);
    for (const name of actualResults) {
      const result = reader.read(path.join(resultRoot, name));
      assert(["completed", "EVALUATOR_MANUAL_REVIEW_REQUIRED"].includes(result.status),
        `Atomic result ${cell.armId}/${cell.caseId}/${name} has invalid terminal status.`);
      if (result.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED") atomicRuntimeManual.add(cell.caseId);
    }
  }
  assert(atomicSummary.cells === atomicKeys.length && atomicSummary.totalRequests === totalAtomicRequests,
    "Atomic live summary cardinality differs from the sealed plan.");
  const atomicSummaryKeys = (atomicSummary.rows || []).map((row) => `${row.armId}:${row.caseId}`).sort();
  assert(stable(atomicSummaryKeys) === stable(atomicKeys), "Atomic live summary cell matrix differs from its seal.");
  for (const cell of atomicSeal.cells || []) {
    const summaryRow = (atomicSummary.rows || []).find((row) => row.armId === cell.armId && row.caseId === cell.caseId);
    if (summaryRow.requestCount != null) assert(summaryRow.requestCount === (cell.requests || []).length,
      `Atomic summary request count differs for ${cell.armId}/${cell.caseId}.`);
  }

  const synthesisSeal = verifyInternalCampaignSeal(reader.read(path.join(config.paths.synthesisRoot,
    "CAMPAIGN_PLAN_SEAL.json")), "Synthesis campaign plan");
  const synthesisSummary = reader.read(path.join(config.paths.synthesisRoot, "summary.json"));
  assert(synthesisSeal.kind === "provider_bounded_synthesis" && synthesisSeal.model === "gpt-5.6-sol"
    && synthesisSeal.reasoning === "high", "Synthesis campaign is not the frozen Sol/high evaluator.");
  assert(synthesisSummary.dryRun === false && synthesisSummary.model === "gpt-5.6-sol"
    && synthesisSummary.reasoning === "high", "Synthesis root is not a completed live Sol/high campaign.");
  assert(path.resolve(synthesisSeal.packetRoot) === path.resolve(config.paths.packetRoot),
    "Synthesis campaign packet root differs from the compiler packet root.");
  assert(path.resolve(synthesisSeal.atomicRoot) === path.resolve(config.paths.atomicRoot),
    "Synthesis campaign atomic root differs from the intended live atomic root.");
  assert(synthesisSeal.runtimeManifest?.model === "gpt-5.6-sol"
    && synthesisSeal.runtimeManifest?.reasoning === "high", "Synthesis runtime manifest differs from Sol/high.");
  assert(stable(synthesisSummary.runtimeManifest) === stable(synthesisSeal.runtimeManifest),
    "Synthesis summary runtime manifest differs from the sealed runtime manifest.");
  const atomicAuthority = atomicSeal.runtimeManifest?.runnerAuthority;
  const synthesisAuthority = synthesisSeal.runtimeManifest?.runnerAuthority;
  assert(atomicAuthority?.authoritySha256 && synthesisAuthority?.authoritySha256,
    "Atomic and synthesis stages must declare the unified evaluator runner authority.");
  assert(sameEvaluatorAuthority(atomicAuthority, synthesisAuthority),
    "Atomic and synthesis stages used different evaluator runner builds.");
  const currentAuthority = evaluatorRunnerAuthority(__dirname);
  const authorityTransition = verifyCompilerAuthorityTransition({ sealedAuthority: atomicAuthority,
    currentAuthority, reader, expectedSourceAuthoritySha256 });
  const schemaAudit = verifyFileDescriptor(reader, synthesisSeal.runtimeManifest?.schemaScript,
    "Synthesis categorical schema");
  const categoricalSchema = require(schemaAudit.path).CategoricalJudgeSchema;
  assert(categoricalSchema?.parse, "Synthesis categorical schema module lacks CategoricalJudgeSchema.");
  const preManual = new Set(synthesisSeal.preSynthesisManualCaseIds || []);
  const preCensor = new Set(synthesisSeal.preSynthesisOperationalCensorCaseIds || []);
  for (const caseId of [...preManual, ...preCensor]) assert(caseIds.includes(caseId),
    `Synthesis seal excludes unknown case ${caseId}.`);
  const synthesisExcluded = new Set([...preManual, ...preCensor]);
  const synthesisKeys = (synthesisSeal.cells || []).map((cell) => `${cell.armId}:${cell.caseId}`).sort();
  assert(stable(synthesisKeys) === stable(exactCellKeys(armIds, caseIds, synthesisExcluded)),
    "Synthesis plan does not cover its exact eligible arm/case matrix.");
  assert(new Set(synthesisKeys).size === synthesisKeys.length, "Synthesis plan repeats arm/case cells.");
  const synthesisManual = new Set(synthesisSeal.manualCaseIds || []);
  for (const caseId of synthesisManual) assert(caseIds.includes(caseId),
    `Synthesis manual set names unknown case ${caseId}.`);
  for (const cell of synthesisSeal.cells || []) {
    const request = reader.read(path.join(config.paths.synthesisRoot, "cells", cell.armId, cell.caseId,
      "request.json"));
    assert(sha256(JSON.stringify(request)) === cell.requestSha256,
      `Synthesis request binding differs for ${cell.armId}/${cell.caseId}.`);
    const resultFile = path.join(config.paths.synthesisRoot, "cells", cell.armId, cell.caseId, "result.json");
    if (synthesisManual.has(cell.caseId)) assert(!fs.existsSync(resultFile),
      `Static-manual synthesis cell unexpectedly has a live result for ${cell.armId}/${cell.caseId}.`);
    else {
      const result = reader.read(resultFile);
      assert(["completed", "EVALUATOR_MANUAL_REVIEW_REQUIRED"].includes(result.status),
        `Synthesis result ${cell.armId}/${cell.caseId} has invalid terminal status.`);
    }
  }
  assert(synthesisSummary.packetCells === armIds.length * caseIds.length
    && synthesisSummary.cells === synthesisKeys.length,
  "Synthesis live summary cardinality differs from the sealed plan.");
  assert(stable([...(synthesisSummary.preSynthesisManualCaseIds || [])].sort()) === stable([...preManual].sort())
    && stable([...(synthesisSummary.preSynthesisOperationalCensorCaseIds || [])].sort())
      === stable([...preCensor].sort()), "Synthesis summary exclusions differ from the sealed plan.");
  assert(stable([...(synthesisSummary.manualCaseIds || [])].sort()) === stable([...synthesisManual].sort()),
    "Synthesis summary static-manual cases differ from the sealed plan.");
  return { atomicSeal, atomicSummary, atomicRuntimeManualCaseIds: [...atomicRuntimeManual].sort(),
    synthesisSeal, synthesisSummary, categoricalSchema, schemaAudit,
    sourceEvaluatorAuthority: atomicAuthority, currentCompilerAuthority: currentAuthority,
    authorityTransition };
};

const manualTriggerCases = (config, caseIds, expectedArms, reader, expectedRunnerAuthority = null) => {
  const known = new Set(caseIds); const cases = new Map();
  const add = (caseId, reason) => {
    assert(known.has(caseId), `Manual trigger names unknown case ${caseId}.`);
    if (!cases.has(caseId)) cases.set(caseId, new Set());
    cases.get(caseId).add(reason || "manual_review_required");
  };
  for (const root of [config.paths.atomicRoot, config.paths.synthesisRoot]) {
    for (const name of ["manual-review-required.json", "manual-review-required-runtime.json"]) {
      const artifact = reader.read(path.join(root, name), false);
      if (!artifact) continue;
      assert(artifact.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED",
        `Manual trigger ${path.join(root, name)} has invalid status.`);
      assert(new Set(artifact.caseIds || []).size === (artifact.caseIds || []).length,
        `Manual trigger ${path.join(root, name)} repeats case IDs.`);
      for (const row of artifact.cells || []) {
        assert(expectedArms.includes(row.armId), `Manual trigger names unknown arm ${row.armId}.`);
        const reasons = row.reasons || [row.reason];
        for (const reason of reasons.filter(Boolean)) add(row.caseId,
          typeof reason === "string" ? reason : reason.reason);
      }
      for (const caseId of artifact.caseIds || []) add(caseId, "manifest_paired_manual_trigger");
      for (const caseId of artifact.caseIds || []) {
        const cellArms = [...new Set((artifact.cells || []).filter((row) => row.caseId === caseId)
          .map((row) => row.armId))].sort();
        assert(stable(cellArms) === stable([...expectedArms].sort()),
          `Manual trigger ${caseId} does not contain the exact expected arm set.`);
      }
    }
  }
  if (config.paths.consistencyTriggerFile) {
    const artifact = reader.read(config.paths.consistencyTriggerFile);
    assert(artifact.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED"
      && artifact.disposition === "paired_identical_input_categorical_disagreement",
    "Identical-input consistency trigger has invalid status/disposition.");
    if (expectedRunnerAuthority) assert(sameEvaluatorAuthority(artifact.runnerAuthority, expectedRunnerAuthority),
      "Identical-input consistency audit used a different evaluator authority.");
    for (const caseId of artifact.caseIds || []) {
      const rows = (artifact.cells || []).filter((row) => row.caseId === caseId);
      assert(stable([...new Set(rows.map((row) => row.armId))].sort()) === stable([...expectedArms].sort()),
        `Identical-input consistency trigger ${caseId} does not contain the exact expected arm set.`);
      for (const row of rows) add(caseId, row.reason);
    }
  }
  return new Map([...cases].map(([caseId, reasons]) => [caseId, [...reasons].sort()]));
};

const verifyPacketProducerAuthority = (config, packets, expectedRunnerAuthority, reader) => {
  if (!expectedRunnerAuthority) return true;
  for (const { armId, caseId, file } of packets.values()) {
    const seal = reader.read(path.join(path.dirname(file), "binding-seal.json"));
    assert(seal.producerAuthoritySha256 === expectedRunnerAuthority.authoritySha256
      && seal.materializerAuthoritySha256 === expectedRunnerAuthority.authoritySha256,
    `Packet producer/materializer authority differs for ${armId}/${caseId}.`);
    assert(seal.materializedPacketSha256 === sha256(fs.readFileSync(file)),
      `Packet binding seal differs from packet bytes for ${armId}/${caseId}.`);
  }
  return true;
};
const assertAtomicToSynthesisManualTransition = (atomicSeal, atomicRuntimeManualCaseIds, synthesisSeal) => {
  const expected = new Set([...(atomicSeal.manualCaseIds || []), ...(atomicRuntimeManualCaseIds || [])]);
  const observed = new Set(synthesisSeal.preSynthesisManualCaseIds || []);
  assert(stable([...expected].sort()) === stable([...observed].sort()),
    "Atomic static/runtime-manual cases differ from the synthesis pre-manual exclusions.");
  return true;
};

const criterionStates = (row) => {
  const present = (value, detail = null) => ({ state: value ? "present" : "absent", detail });
  const unknown = (detail) => ({ state: "unknown", detail });
  const facts = profileFacts(row.production);
  const out = {
    profile_returned: present((row.production.finalProfiles || []).length > 0),
    professional_contact_returned: present(facts.some((fact) => CONTACT_FIELDS.has(fact.fieldType)))
  };
  const judgment = row.judgment;
  if (!judgment) {
    for (const criterion of CRITERIA.filter((item) => item.source === "evaluator")) {
      out[criterion.id] = unknown("no_adjudication");
    }
    return out;
  }
  const claims = judgment.claimAssessments || [];
  const fields = (judgment.fieldAssessments || []).filter((field) => field.fieldType !== "rating");
  out.critical_safety_finding = present((judgment.criticalFindings || []).length > 0,
    judgment.criticalFindings || []);
  const materialEvents = claims.filter((claim) => BAD_READABLE.has(claim.exactSupport)
    || (["partial", "invalid"].includes(claim.fieldValidity) && claim.exactSupport !== "unreadable"));
  out.readable_material_support_defect = materialEvents.length ? present(true, materialEvents.map((x) => x.claimId))
    : claims.some((claim) => claim.exactSupport === "unreadable" || claim.fieldValidity === "unreadable")
      ? unknown("one_or_more_claims_unreadable") : present(false);
  const citationEvents = claims.filter((claim) => BAD_READABLE.has(claim.citedSourceSupport));
  out.own_citation_support_defect = citationEvents.length ? present(true, citationEvents.map((x) => x.claimId))
    : claims.some((claim) => claim.citedSourceSupport === "unreadable")
      ? unknown("one_or_more_citations_unreadable") : present(false);
  const identityEvents = claims.filter((claim) => ["wrong_provider", "ambiguous"].includes(claim.identityLink)
    || (["exact_value_other_npi", "co_bound_bundle_other_npi"].includes(claim.crossNpiConflict)
      && !["exact_requested_npi", "explicit_shared_or_concurrent_use"].includes(claim.requestedNpiResolution)));
  out.identity_attachment_defect = identityEvents.length ? present(true, identityEvents.map((x) => x.claimId))
    : claims.some((claim) => claim.identityLink === "unreadable")
      ? unknown("one_or_more_identity_links_unreadable") : present(false);
  const withholding = fields.filter((field) => field.cmsHierarchyConditionalOutcome === "inappropriately_withheld");
  out.inappropriate_withholding = withholding.length ? present(true, withholding.map((x) => x.fieldType))
    : fields.some((field) => field.cmsHierarchyConditionalOutcome === "indeterminate")
      ? unknown("one_or_more_hierarchy_outcomes_indeterminate") : present(false);
  const lowerTier = fields.filter((field) => field.cmsHierarchyConditionalOutcome === "lower_tier_selected");
  out.lower_tier_source_selected = lowerTier.length ? present(true, lowerTier.map((x) => x.fieldType))
    : fields.some((field) => field.cmsHierarchyConditionalOutcome === "indeterminate")
      ? unknown("one_or_more_hierarchy_outcomes_indeterminate") : present(false);
  const spanEligibleClaims = claims.filter((claim) => claim.exactSupport === "exact"
    && claim.citedSourceSupport === "exact");
  const spanEvents = spanEligibleClaims.filter((claim) =>
    !["exact", "not_supplied"].includes(claim.providerIdentitySpanFidelity)
      && claim.providerIdentitySpanFidelity !== "unreadable"
    || !["exact", "not_supplied"].includes(claim.factSpanFidelity) && claim.factSpanFidelity !== "unreadable"
    || !["exact_fact_relevant_date", "not_supplied", "no_date_claimed"].includes(claim.explicitDateSpanFidelity)
      && claim.explicitDateSpanFidelity !== "unreadable");
  const contractEvents = fields.filter((field) => field.contractFidelity === "violates");
  out.citation_span_or_contract_defect = spanEvents.length || contractEvents.length
    ? present(true, { claims: spanEvents.map((x) => x.claimId), fields: contractEvents.map((x) => x.fieldType) })
    : spanEligibleClaims.some((claim) => claim.providerIdentitySpanFidelity === "unreadable"
      || claim.factSpanFidelity === "unreadable" || claim.explicitDateSpanFidelity === "unreadable")
      || fields.some((field) => field.contractFidelity === "indeterminate")
      ? unknown("one_or_more_span_or_contract_axes_indeterminate") : present(false);
  return out;
};

const seededRandom = (seedText) => {
  let state = Number.parseInt(sha256(seedText).slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state; value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};
const pairedBootstrap = ({ rows, arms, strata, bootstrap }) => {
  const byKey = new Map(rows.map((row) => [`${row.armId}:${row.caseId}`, row]));
  const results = [];
  const allAdjudicated = new Set(rows.filter((row) => ["automatic", "manual"].includes(row.stratum))
    .map((row) => row.caseId));
  const caseSets = { automatic: new Set(rows.filter((row) => row.stratum === "automatic").map((row) => row.caseId)),
    manual: new Set(rows.filter((row) => row.stratum === "manual").map((row) => row.caseId)),
    all_adjudicated_secondary: allAdjudicated };
  for (const [stratum, caseSet] of Object.entries(caseSets)) {
    for (let leftIndex = 0; leftIndex < arms.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arms.length; rightIndex += 1) {
        const left = arms[leftIndex].armId; const right = arms[rightIndex].armId;
        for (const criterion of CRITERIA) {
          const pairs = [...caseSet].sort().flatMap((caseId) => {
            const leftState = byKey.get(`${left}:${caseId}`)?.criteria[criterion.id]?.state;
            const rightState = byKey.get(`${right}:${caseId}`)?.criteria[criterion.id]?.state;
            return [leftState, rightState].every((state) => ["present", "absent"].includes(state))
              ? [{ caseId, left: Number(leftState === "present"), right: Number(rightState === "present") }] : [];
          });
          const diffs = pairs.map((pair) => pair.left - pair.right);
          const estimate = diffs.length ? diffs.reduce((sum, value) => sum + value, 0) / diffs.length : null;
          const samples = [];
          if (diffs.length) {
            const random = seededRandom(`${bootstrap.seed}|${stratum}|${left}|${right}|${criterion.id}`);
            for (let iteration = 0; iteration < bootstrap.iterations; iteration += 1) {
              let sum = 0;
              for (let index = 0; index < diffs.length; index += 1) sum += diffs[Math.floor(random() * diffs.length)];
              samples.push(sum / diffs.length);
            }
          }
          const alpha = (1 - bootstrap.confidence) / 2;
          results.push({ stratum, leftArmId: left, rightArmId: right, criterionId: criterion.id,
            favorableDirection: criterion.direction, pairedProviders: diffs.length,
            excludedUnknownPairs: caseSet.size - diffs.length, leftMinusRight: estimate,
            ciLow: quantile(samples, alpha), ciHigh: quantile(samples, 1 - alpha),
            leftPresentRightAbsent: pairs.filter((pair) => pair.left === 1 && pair.right === 0).length,
            leftAbsentRightPresent: pairs.filter((pair) => pair.left === 0 && pair.right === 1).length,
            iterations: bootstrap.iterations, confidence: bootstrap.confidence });
        }
      }
    }
  }
  assert(strata.automatic + strata.manual + strata.censored === caseSets.automatic.size
    + caseSets.manual.size + strata.censored, "Internal stratum accounting mismatch.");
  return results;
};

const safeEligibleClaim = (claim) => claim.exactSupport === "exact" && claim.fieldValidity === "valid"
  && claim.sourceEligibility === "eligible" && ["professional", "not_applicable"].includes(claim.displaySafety)
  && ["exact_npi", "strong_name_location", "not_applicable"].includes(claim.identityLink)
  && !(["exact_value_other_npi", "co_bound_bundle_other_npi"].includes(claim.crossNpiConflict)
    && !["exact_requested_npi", "explicit_shared_or_concurrent_use"].includes(claim.requestedNpiResolution));
const protocolMetricParts = (row, metric) => {
  const claims = row.judgment?.claimAssessments || [];
  if (metric === "eligible_contact_survival") {
    const survived = (row.production.finalProfiles || []).length > 0
      && claims.some((claim) => CONTACT_FIELDS.has(claim.fieldType) && safeEligibleClaim(claim));
    return [Number(survived), 1];
  }
  if (metric === "whole_packet_exact_material_support") {
    const eligible = claims.filter((claim) => claim.exactSupport !== "unreadable");
    return [eligible.filter((claim) => claim.exactSupport === "exact").length, eligible.length];
  }
  if (metric === "readable_own_citation_exact_support") {
    const eligible = claims.filter((claim) => claim.citedSourceSupport !== "unreadable");
    return [eligible.filter((claim) => claim.citedSourceSupport === "exact").length, eligible.length];
  }
  if (metric === "exact_provider_identity_attachment") {
    const eligible = claims.filter((claim) => claim.identityLink !== "unreadable");
    return [eligible.filter((claim) => ["exact_npi", "strong_name_location"].includes(claim.identityLink)).length,
      eligible.length];
  }
  throw new Error(`Unknown frozen protocol metric ${metric}.`);
};
const aggregateRate = (rows, metric) => {
  const parts = rows.map((row) => protocolMetricParts(row, metric));
  const numerator = parts.reduce((sum, part) => sum + part[0], 0);
  const denominator = parts.reduce((sum, part) => sum + part[1], 0);
  return denominator ? numerator / denominator : null;
};
const protocolBootstrap = ({ byKey, caseIds, baselineArmId, candidateArmId, metric, stratum, bootstrap }) => {
  const pairs = caseIds.map((caseId) => ({ caseId, baseline: byKey.get(`${baselineArmId}:${caseId}`),
    candidate: byKey.get(`${candidateArmId}:${caseId}`) }))
    .filter((pair) => pair.baseline?.stratum === stratum && pair.candidate?.stratum === stratum
      && pair.baseline.judgment && pair.candidate.judgment);
  const baseline = aggregateRate(pairs.map((pair) => pair.baseline), metric);
  const candidate = aggregateRate(pairs.map((pair) => pair.candidate), metric);
  const replicates = [];
  if (pairs.length) {
    const random = seededRandom(`${bootstrap.seed}|frozen-protocol|${stratum}|${candidateArmId}|${metric}`);
    for (let iteration = 0; iteration < bootstrap.iterations; iteration += 1) {
      const sample = Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)]);
      const left = aggregateRate(sample.map((pair) => pair.baseline), metric);
      const right = aggregateRate(sample.map((pair) => pair.candidate), metric);
      if (left != null && right != null) replicates.push(right - left);
    }
  }
  const lower95 = quantile(replicates, 0.025); const upper95 = quantile(replicates, 0.975);
  return { metric, stratum, baselineArmId, candidateArmId, pairedProviders: pairs.length,
    baselineRate: baseline, candidateRate: candidate,
    candidateMinusBaseline: baseline == null || candidate == null ? null : candidate - baseline,
    lower95, upper95, iterations: replicates.length, margin: NONINFERIORITY_MARGIN,
    passes: passesNoninferiority(lower95) };
};
const protocolIssueFlags = (row) => {
  const claims = row.judgment?.claimAssessments || [];
  const fields = (row.judgment?.fieldAssessments || []).filter((field) => field.fieldType !== "rating");
  return {
    wrong_provider: claims.some((claim) => claim.identityLink === "wrong_provider"),
    unsupported_material: claims.some((claim) => ["not_found", "contradicted"].includes(claim.exactSupport)),
    unsafe_contact: claims.some((claim) => ["personal_mobile", "residential", "prohibited_source"]
      .includes(claim.displaySafety)),
    contradicted: claims.some((claim) => claim.exactSupport === "contradicted"),
    cross_npi_misattribution: claims.some((claim) =>
      ["exact_value_other_npi", "co_bound_bundle_other_npi"].includes(claim.crossNpiConflict)
      && !["exact_requested_npi", "explicit_shared_or_concurrent_use"].includes(claim.requestedNpiResolution)),
    inappropriate_withholding: fields.some((field) =>
      field.cmsHierarchyConditionalOutcome === "inappropriately_withheld"),
    lower_tier_selection: fields.some((field) => field.cmsHierarchyConditionalOutcome === "lower_tier_selected"),
    span_defect: claims.some((claim) => claim.exactSupport === "exact" && claim.citedSourceSupport === "exact"
      && (["providerIdentitySpanFidelity", "factSpanFidelity"]
        .some((axis) => !["exact", "not_supplied", "unreadable"].includes(claim[axis]))
        || !["exact_fact_relevant_date", "not_supplied", "no_date_claimed", "unreadable"]
          .includes(claim.explicitDateSpanFidelity))),
    unreadable: claims.some((claim) => ["exactSupport", "citedSourceSupport", "identityLink"]
      .some((axis) => claim[axis] === "unreadable"))
  };
};
const normalizedClaimValue = (claim) => {
  const value = claim.value;
  if (claim.fieldType === "phone") return String(value?.value ?? value ?? "").replace(/\D/g, "");
  if (claim.fieldType === "website") return String(value?.value ?? value ?? "").trim().toLowerCase().replace(/\/$/, "");
  return JSON.stringify(value, Object.keys(value && typeof value === "object" ? value : {}).sort())
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
};
const defectClaimMap = (row, issue) => {
  const claims = row.judgment?.claimAssessments || [];
  const matches = (claim) => issue === "wrong_provider" ? claim.identityLink === "wrong_provider"
    : issue === "unsupported_material" ? ["not_found", "contradicted"].includes(claim.exactSupport)
      : issue === "unsafe_contact" ? ["personal_mobile", "residential", "prohibited_source"].includes(claim.displaySafety)
        : issue === "contradicted" ? claim.exactSupport === "contradicted"
          : issue === "cross_npi_misattribution"
            ? ["exact_value_other_npi", "co_bound_bundle_other_npi"].includes(claim.crossNpiConflict)
              && !["exact_requested_npi", "explicit_shared_or_concurrent_use"].includes(claim.requestedNpiResolution)
            : false;
  return new Map(claims.filter(matches).map((claim) => [`${claim.fieldType}:${normalizedClaimValue(claim)}`,
    { claimId: claim.claimId, fieldType: claim.fieldType, value: claim.value }]));
};
const parserSucceeded = (row) => Array.isArray(row.production.parserProfiles) && !row.production.error;
const protocolAnalysis = ({ rows, arms, baselineArmId, caseIds, bootstrap, datasetRole }) => {
  const byKey = new Map(rows.map((row) => [`${row.armId}:${row.caseId}`, row]));
  const metrics = ["eligible_contact_survival", "whole_packet_exact_material_support",
    "readable_own_citation_exact_support", "exact_provider_identity_attachment"];
  const issueNames = ["inappropriate_withholding", "lower_tier_selection", "span_defect"];
  const safetyNames = ["wrong_provider", "unsupported_material", "unsafe_contact", "contradicted",
    "cross_npi_misattribution"];
  const strata = ["automatic", "manual", "all_adjudicated_secondary"];
  const candidateResults = {};
  for (const candidate of arms.filter((arm) => arm.armId !== baselineArmId)) {
    const byStratum = {};
    for (const requestedStratum of strata) {
      const eligibleCases = caseIds.filter((caseId) => {
        const baseline = byKey.get(`${baselineArmId}:${caseId}`); const compared = byKey.get(`${candidate.armId}:${caseId}`);
        return requestedStratum === "all_adjudicated_secondary"
          ? [baseline, compared].every((row) => ["automatic", "manual"].includes(row?.stratum))
          : baseline?.stratum === requestedStratum && compared?.stratum === requestedStratum;
      });
      // The bootstrap function accepts one literal stratum. For the secondary
      // all-adjudicated view, use shallow row views with an explicit label.
      const bootstrapRows = requestedStratum === "all_adjudicated_secondary"
        ? new Map([...byKey].map(([key, row]) => [key, ["automatic", "manual"].includes(row.stratum)
          ? { ...row, stratum: requestedStratum } : row])) : byKey;
      const endpoints = metrics.map((metric) => protocolBootstrap({ byKey: bootstrapRows,
        caseIds: eligibleCases, baselineArmId, candidateArmId: candidate.armId, metric,
        stratum: requestedStratum, bootstrap }));
      const issueComparisons = Object.fromEntries(issueNames.map((issue) => {
        const baselineCases = eligibleCases.filter((caseId) => protocolIssueFlags(byKey.get(`${baselineArmId}:${caseId}`))[issue]);
        const candidateCases = eligibleCases.filter((caseId) => protocolIssueFlags(byKey.get(`${candidate.armId}:${caseId}`))[issue]);
        const difference = candidateCases.length - baselineCases.length;
        return [issue, { baselineCases, candidateCases,
          newCandidateCases: candidateCases.filter((caseId) => !baselineCases.includes(caseId)),
          resolvedBaselineCases: baselineCases.filter((caseId) => !candidateCases.includes(caseId)),
          countDifference: difference, maximumAdditionalCases: 3, passes: difference <= 3 }];
      }));
      const safety = Object.fromEntries(safetyNames.map((issue) => {
        const newClaims = [];
        for (const caseId of eligibleCases) {
          const baseline = byKey.get(`${baselineArmId}:${caseId}`); const compared = byKey.get(`${candidate.armId}:${caseId}`);
          const comparatorIssue = issue === "contradicted" ? "unsupported_material" : issue;
          const baselineDefects = defectClaimMap(baseline, comparatorIssue);
          for (const [key, value] of defectClaimMap(compared, issue)) if (!baselineDefects.has(key)) {
            newClaims.push({ caseId, ...value });
          }
        }
        return [issue, { newCandidateClaims: newClaims, passes: newClaims.length === 0 }];
      }));
      const baselineParser = eligibleCases.filter((caseId) => parserSucceeded(byKey.get(`${baselineArmId}:${caseId}`)));
      const candidateParser = eligibleCases.filter((caseId) => parserSucceeded(byKey.get(`${candidate.armId}:${caseId}`)));
      const parserDifference = candidateParser.length - baselineParser.length;
      const baselineUnreadable = eligibleCases.filter((caseId) => protocolIssueFlags(byKey.get(`${baselineArmId}:${caseId}`)).unreadable);
      const candidateUnreadable = eligibleCases.filter((caseId) => protocolIssueFlags(byKey.get(`${candidate.armId}:${caseId}`)).unreadable);
      const unreadableDifference = candidateUnreadable.length - baselineUnreadable.length;
      const gates = {
        endpointNoninferiority: endpoints.every((endpoint) => endpoint.passes === true),
        issueCaseLimits: Object.values(issueComparisons).every((item) => item.passes),
        safety: Object.values(safety).every((item) => item.passes),
        parser: parserDifference >= -3,
        unreadability: unreadableDifference <= 3
      };
      byStratum[requestedStratum] = { providerCases: eligibleCases.length, endpoints, issueComparisons,
        safety, parserGate: { baselineSuccesses: baselineParser.length, candidateSuccesses: candidateParser.length,
          difference: parserDifference, minimumDifference: -3, passes: gates.parser },
        unreadabilityGate: { baselineCases: baselineUnreadable, candidateCases: candidateUnreadable,
          newCandidateCases: candidateUnreadable.filter((caseId) => !baselineUnreadable.includes(caseId)),
          countDifference: unreadableDifference, maximumAdditionalCases: 3, passes: gates.unreadability },
        gates, allSpecifiedConditionsHold: Object.values(gates).every(Boolean) };
    }
    candidateResults[candidate.armId] = byStratum;
  }
  return { schemaVersion: 1, protocol: "frozen_provider_prompt_minimization_evaluator_v1", datasetRole,
    baselineArmId, bootstrapIterations: bootstrap.iterations, noninferiorityMargin: NONINFERIORITY_MARGIN,
    maximumAdditionalCaseDefects: 3, maximumParserSuccessLoss: 3, maximumUnreadabilityIncrease: 3,
    strataKeptSeparate: true, allAdjudicatedIsSecondary: true, candidates: candidateResults };
};

const compile = (config, reader) => {
  const arms = config.arms; const armIds = arms.map((arm) => arm.armId);
  const { cells: packets, caseIds } = discoverPackets(config.paths.packetRoot, armIds,
    config.expectedCasesPerArm, reader);
  const battery = loadCaseBattery(config, reader);
  assert(stable([...battery.keys()].sort()) === stable(caseIds), "Packet cases differ from the frozen provider battery.");
  for (const caseId of caseIds) for (const armId of armIds) {
    const packet = packets.get(`${armId}:${caseId}`).packet; const frozenCase = battery.get(caseId);
    assert(stable(packet.identityContext?.request) === stable(frozenCase.request),
      `Packet request differs from the frozen battery: ${armId}/${caseId}.`);
    assert(stable(packet.identityContext?.cmsBaseline) === stable(frozenCase.cmsBaseline),
      `Packet CMS baseline differs from the frozen battery: ${armId}/${caseId}.`);
    assert(stable(packet.identityContext?.nppesIdentity) === stable(frozenCase.gold?.identity),
      `Packet NPPES identity differs from the frozen battery: ${armId}/${caseId}.`);
    assertPlanNetworkIsolation(config, packet, frozenCase, `${armId}/${caseId}`);
  }
  const expectedSourceAuthoritySha256 = process.env.EXPECTED_RUNNER_AUTHORITY_SHA256 || null;
  const evaluatorCampaigns = verifyEvaluatorCampaigns(config, packets, armIds, caseIds, reader,
    expectedSourceAuthoritySha256);
  const requiredRunnerAuthority = process.env.EXPECTED_RUNNER_AUTHORITY_SHA256
    ? evaluatorCampaigns.atomicSeal.runtimeManifest.runnerAuthority : null;
  verifyPacketProducerAuthority(config, packets, requiredRunnerAuthority, reader);
  const manual = manualArtifacts(config, reader, armIds, caseIds,
    evaluatorCampaigns.schemaAudit, evaluatorCampaigns.categoricalSchema, requiredRunnerAuthority);
  const triggers = manualTriggerCases(config, caseIds, armIds, reader, requiredRunnerAuthority);
  const rows = []; const operationRows = []; const productionAttemptRows = [];
  for (const arm of arms) for (const caseId of caseIds) {
    const packetCell = packets.get(`${arm.armId}:${caseId}`);
    const productionPath = productionFile(arm, caseId);
    const production = reader.read(productionPath);
    assert(production.armId === arm.armId && production.caseId === caseId,
      `Production artifact identity mismatch ${arm.armId}/${caseId}.`);
    assert(stable(production.cmsBaseline) === stable(battery.get(caseId).cmsBaseline),
      `Production CMS baseline differs from the frozen battery: ${arm.armId}/${caseId}.`);
    assert(stable(production.strata) === stable(battery.get(caseId).strata),
      `Production strata differ from the frozen battery: ${arm.armId}/${caseId}.`);
    assertProductionArtifact(production, packetCell.packet.identityContext.request, arm.expectedArmCommit,
      config.productionEndpoint, `${arm.armId}/${caseId}`);
    const promptMeasurement = staticPromptMeasurement(production, `${arm.armId}/${caseId}`);
    const operations = collectEvaluatorOperations(config, arm.armId, caseId, reader);
    const parsedFile = path.join(config.paths.synthesisRoot, "cells", arm.armId, caseId, "parsed-v14.json");
    let autoParsed = reader.read(parsedFile, false);
    if (operations.synthesis?.status === "completed") {
      assert(autoParsed && operations.synthesis.parsedArtifact,
        `Completed synthesis lacks an authenticated parsed artifact ${arm.armId}/${caseId}.`);
      const parsedDescriptor = reader.audit(parsedFile);
      assert(operations.synthesis.parsedArtifact.file === "parsed-v14.json"
        && path.resolve(operations.synthesis.parsedArtifact.path) === path.resolve(parsedFile)
        && operations.synthesis.parsedArtifact.sha256 === parsedDescriptor.sha256
        && operations.synthesis.parsedArtifact.byteLength === parsedDescriptor.byteLength,
      `Synthesis parsed artifact binding differs ${arm.armId}/${caseId}.`);
      autoParsed = evaluatorCampaigns.categoricalSchema.parse(autoParsed);
    } else assert(!autoParsed, `Noncompleted synthesis has a stale parsed artifact ${arm.armId}/${caseId}.`);
    const manualDecision = manual.decisions.get(`${arm.armId}:${caseId}`);
    const metrics = productionMetrics(production, `${arm.armId}/${caseId}`);
    const row = { armId: arm.armId, caseId, packet: packetCell.packet, production,
      productionPath, operationalCensor: operationalCensor(production), metrics,
      synthesis: operations.synthesis, autoParsed, manualDecision, evaluatorOperations: operations.rows,
      promptMeasurement, judgment: null, reviewerMode: null, stratum: null, censorReason: null };
    rows.push(row);
    for (const attempt of metrics.attempts) productionAttemptRows.push({
      armId: arm.armId, caseId, ...attempt });
  }
  const evaluatorManualCases = new Set([...triggers.keys(), ...rows
    .filter((row) => row.synthesis?.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED"
      || row.evaluatorOperations.some((operation) => operation.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED"))
    .map((row) => row.caseId)]);
  const productionCensorCases = new Set(rows.filter((row) => row.operationalCensor).map((row) => row.caseId));
  assert(stable([...productionCensorCases].sort())
    === stable([...(evaluatorCampaigns.atomicSeal.operationalCensorCaseIds || [])].sort()),
  "Production terminal content-filter cases differ from the atomic paired-censor seal.");
  assert(stable([...productionCensorCases].sort())
    === stable([...(evaluatorCampaigns.synthesisSeal.preSynthesisOperationalCensorCaseIds || [])].sort()),
  "Production terminal content-filter cases differ from the synthesis paired-censor exclusions.");
  assertAtomicToSynthesisManualTransition(evaluatorCampaigns.atomicSeal,
    evaluatorCampaigns.atomicRuntimeManualCaseIds, evaluatorCampaigns.synthesisSeal);
  if (manual.seal) assert(stable([...manual.manualCases].sort()) === stable([...evaluatorManualCases].sort()),
    "Manual seal case set differs from the exact evaluator-triggered case set.");
  const caseDisposition = new Map();
  for (const caseId of caseIds) {
    const paired = rows.filter((row) => row.caseId === caseId);
    const operational = paired.filter((row) => row.operationalCensor);
    if (operational.length) {
      caseDisposition.set(caseId, { stratum: "censored", reason: "paired_production_operational_censor",
        triggeringArms: operational.map((row) => row.armId) });
      continue;
    }
    const manualRequired = triggers.has(caseId)
      || paired.some((row) => row.synthesis?.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED")
      || paired.some((row) => row.evaluatorOperations
        .some((operation) => operation.status === "EVALUATOR_MANUAL_REVIEW_REQUIRED"))
      || paired.some((row) => row.manualDecision) || manual.censoredCases.has(caseId);
    if (manualRequired) {
      const complete = paired.every((row) => row.manualDecision);
      if (manual.censoredCases.has(caseId) || !complete) {
        caseDisposition.set(caseId, { stratum: "censored", reason: manual.censoredCases.get(caseId)
          || "paired_manual_adjudication_incomplete", triggeringArms: [] });
      } else caseDisposition.set(caseId, { stratum: "manual", reason: (triggers.get(caseId) || []).join("|")
        || "manual_adjudication", triggeringArms: [] });
      continue;
    }
    for (const row of paired) {
      assert(row.synthesis?.status === "completed" && row.autoParsed,
        `Unexpected missing/noncompleted automatic judgment ${row.armId}/${caseId}.`);
    }
    caseDisposition.set(caseId, { stratum: "automatic", reason: null, triggeringArms: [] });
  }
  for (const row of rows) {
    const disposition = caseDisposition.get(row.caseId);
    row.stratum = disposition.stratum; row.censorReason = disposition.reason;
    if (row.stratum === "automatic") {
      row.judgment = judgmentWithBindings(row.autoParsed, row.packet); row.reviewerMode = "automatic_sol_high";
    } else if (row.stratum === "manual") {
      row.judgment = judgmentWithBindings(row.manualDecision.categoricalOutput, row.packet);
      row.reviewerMode = row.manualDecision.resultClass || row.manualDecision.reviewer?.reviewMode || "manual";
    }
    row.criteria = row.stratum === "censored"
      ? Object.fromEntries(CRITERIA.map((criterion) => [criterion.id,
        { state: "censored", detail: row.censorReason }])) : criterionStates(row);
    for (const operation of row.evaluatorOperations) operationRows.push({ armId: row.armId, caseId: row.caseId,
      stratum: row.stratum, ...operation });
  }
  const strata = Object.fromEntries(["automatic", "manual", "censored"].map((stratum) =>
    [stratum, caseIds.filter((caseId) => caseDisposition.get(caseId).stratum === stratum).length]));
  const promptBaseline = arms.find((arm) => arm.armId === config.baselineArmId).promptStaticBytes;
  const promptRows = arms.map((arm) => {
    const measurements = rows.filter((row) => row.armId === arm.armId).map((row) => row.promptMeasurement);
    assert(new Set(measurements.map(stable)).size === 1,
      `Static prompt contract differs across production requests for ${arm.armId}.`);
    const measured = measurements[0];
    assert(measured.totalUtf8Bytes === arm.promptStaticBytes,
      `Measured static prompt bytes differ from the manifest for ${arm.armId}.`);
    return { armId: arm.armId, name: arm.name, staticBytes: measured.totalUtf8Bytes,
      baselineArmId: config.baselineArmId, reductionVsBaselineFraction: 1 - measured.totalUtf8Bytes / promptBaseline,
      meetsMinimumReduction: arm.armId === config.baselineArmId ? null
        : 1 - measured.totalUtf8Bytes / promptBaseline >= config.minimumPromptReductionFraction,
      components: measured.components,
      snapshot: arm.promptSnapshot ? fileDescriptor(arm.promptSnapshot) : null };
  });
  const criterionRows = rows.flatMap((row) => CRITERIA.map((criterion) => ({ armId: row.armId,
    caseId: row.caseId, stratum: row.stratum, reviewerMode: row.reviewerMode,
    criterionId: criterion.id, favorableDirection: criterion.direction,
    state: row.criteria[criterion.id].state, detail: row.criteria[criterion.id].detail })));
  const bootstrapRows = pairedBootstrap({ rows, arms, strata, bootstrap: config.bootstrap });
  const frozenProtocol = protocolAnalysis({ rows, arms, baselineArmId: config.baselineArmId,
    caseIds, bootstrap: config.bootstrap, datasetRole: config.datasetRole });
  const productionOperations = Object.fromEntries(arms.map((arm) => {
    const selected = rows.filter((row) => row.armId === arm.armId);
    return [arm.armId, { completeCostUsd: distribution(selected.map((row) => row.metrics.costUsd)),
      knownCostUsd: distribution(selected.map((row) => row.metrics.knownCostUsd)),
      unknownCostAttempts: selected.reduce((sum, row) => sum + row.metrics.unknownCostAttempts, 0),
      costIncompleteCases: selected.filter((row) => row.metrics.unknownCostAttempts > 0).map((row) => row.caseId),
      latencyMs: distribution(selected.map((row) => row.metrics.latencyMs)),
      totalHttpSends: selected.reduce((sum, row) => sum + row.metrics.httpSends, 0),
      knownWebSearchCalls: selected.reduce((sum, row) => sum + row.metrics.knownWebSearches, 0),
      unknownWebSearchAttempts: selected.reduce((sum, row) => sum + row.metrics.unknownWebSearchAttempts, 0) }];
  }));
  const evaluatorOperations = Object.fromEntries(arms.map((arm) => {
    const selected = operationRows.filter((row) => row.armId === arm.armId);
    const operationSummary = (stageRows) => ({ calls: stageRows.length,
      costUsd: distribution(stageRows.map((row) => row.costUsd)),
      knownCostUsd: distribution(stageRows.map((row) => row.knownCostUsd)),
      unknownCostAttempts: stageRows.reduce((sum, row) => sum + row.unknownCostAttempts, 0),
      latencyMs: distribution(stageRows.map((row) => row.durationMs)), statuses: Object.fromEntries(
        [...new Set(stageRows.map((row) => row.status))].sort().map((status) =>
          [status, stageRows.filter((row) => row.status === status).length])) });
    const byStage = Object.fromEntries(["atomic", "synthesis"].map((stage) => {
      const stageRows = selected.filter((row) => row.stage === stage);
      return [stage, { calls: stageRows.length, costUsd: distribution(stageRows.map((row) => row.costUsd)),
        knownCostUsd: distribution(stageRows.map((row) => row.knownCostUsd)),
        unknownCostAttempts: stageRows.reduce((sum, row) => sum + row.unknownCostAttempts, 0),
        latencyMs: distribution(stageRows.map((row) => row.durationMs)), statuses: Object.fromEntries(
          [...new Set(stageRows.map((row) => row.status))].sort().map((status) =>
            [status, stageRows.filter((row) => row.status === status).length])) }];
    }));
    const manualDurations = rows.filter((row) => row.armId === arm.armId && row.stratum === "manual")
      .map((row) => row.manualDecision?.durationMs).filter(Number.isFinite);
    const unknownCostOperations = selected.filter((row) => !Number.isFinite(row.costUsd));
    const knownEvaluatorApiCostUsd = selected.map((row) => row.knownCostUsd).filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const unknownCostAttempts = selected.reduce((sum, row) => sum + row.unknownCostAttempts, 0);
    return [arm.armId, { apiByStage: byStage,
      apiByFinalStratum: Object.fromEntries(["automatic", "manual", "censored"].map((stratum) =>
        [stratum, operationSummary(selected.filter((row) => row.stratum === stratum))])),
      totalEvaluatorApiCostUsd: unknownCostOperations.length ? null : knownEvaluatorApiCostUsd,
      knownEvaluatorApiCostUsd, unknownCostOperations: unknownCostOperations.length, unknownCostAttempts,
      manualReviewDurationMs: distribution(manualDurations),
      manualReviewCostUsd: "not_reported_by_manual_seal" }];
  }));
  const categoricalCounts = Object.fromEntries(["automatic", "manual"].map((stratum) => [stratum,
    Object.fromEntries(arms.map((arm) => [arm.armId, Object.fromEntries(CRITERIA.map((criterion) => {
      const selected = criterionRows.filter((row) => row.stratum === stratum && row.armId === arm.armId
        && row.criterionId === criterion.id);
      return [criterion.id, { present: selected.filter((row) => row.state === "present").length,
        absent: selected.filter((row) => row.state === "absent").length,
        unknown: selected.filter((row) => row.state === "unknown").length }];
    }))]))]));
  return { rows, operationRows, productionAttemptRows, criterionRows, bootstrapRows, promptRows, frozenProtocol,
    battery,
    evaluatorCampaigns,
    caseDisposition, summary: { schemaVersion: SCHEMA_VERSION, campaignId: config.campaignId,
      datasetRole: config.datasetRole, baselineArmId: config.baselineArmId, arms: arms.map((arm) => arm.armId),
      authorityProvenance: { ...evaluatorCampaigns.authorityTransition,
        sourceEvaluatorAuthority: evaluatorCampaigns.sourceEvaluatorAuthority,
        currentCompilerAuthority: evaluatorCampaigns.currentCompilerAuthority },
      frozenProtocolDescriptor: config.protocolDescriptor,
      providerCases: caseIds.length, cells: rows.length, strata, promptMetrics: promptRows,
      promptSizeGate: { minimumReductionFraction: config.minimumPromptReductionFraction,
        byArm: Object.fromEntries(promptRows.filter((row) => row.armId !== config.baselineArmId)
          .map((row) => [row.armId, row.meetsMinimumReduction])) },
      categoricalCriteria: CRITERIA, categoricalCounts,
      frozenProtocol,
      operations: { production: productionOperations, evaluator: evaluatorOperations },
      bootstrap: { ...config.bootstrap, unit: "provider", estimand: "paired_left_minus_right_event_rate",
        allAdjudicatedIsSecondary: true }, noAggregateScore: true } };
};

const markdownReport = (compiled) => {
  const { summary, promptRows, caseDisposition } = compiled;
  const lines = [`# ${summary.campaignId}: corrected campaign compilation`, "",
    `Dataset role: ${summary.datasetRole}. This compiler reports categorical criteria only; it computes no aggregate quality score.`, "",
    "## Compiler authority provenance", "",
    `Mode: ${summary.authorityProvenance.mode}.`, "",
    `Sealed source evaluator authority: \`${summary.authorityProvenance.sourceEvaluatorAuthoritySha256}\`.`,
    `Current compiler authority: \`${summary.authorityProvenance.currentCompilerAuthoritySha256}\`.`, "",
    `Transitioned sealed-path files: ${summary.authorityProvenance.transitionedFiles.length
      ? summary.authorityProvenance.transitionedFiles.map((item) => item.name).join(", ") : "none"}.`, "",
    "## Evaluation strata", "", "| Stratum | Providers |", "| --- | ---: |",
    ...Object.entries(summary.strata).map(([key, value]) => `| ${key} | ${value} |`), "",
    "Automatic Sol/high, completed manual exceptions, and paired-censored providers remain separate. The all-adjudicated bootstrap rows in the raw TSV are explicitly secondary.", "",
    "## Prompt size", "", "| Arm | Static bytes | Reduction vs baseline |", "| --- | ---: | ---: |",
    ...promptRows.map((row) => `| ${row.armId} | ${row.staticBytes} | ${(100 * row.reductionVsBaselineFraction).toFixed(1)}% |`), ""];
  for (const stratum of ["automatic", "manual"]) {
    lines.push(`## ${stratum[0].toUpperCase()}${stratum.slice(1)} categorical criteria`, "",
      "Cells show present / known; unknown evidence is excluded from the known denominator.", "",
      `| Arm | ${CRITERIA.map((criterion) => criterion.id).join(" | ")} |`,
      `| --- | ${CRITERIA.map(() => "---:").join(" | ")} |`);
    for (const armId of summary.arms) {
      const counts = summary.categoricalCounts[stratum][armId];
      lines.push(`| ${armId} | ${CRITERIA.map((criterion) => {
        const count = counts[criterion.id]; return `${count.present}/${count.present + count.absent}`;
      }).join(" | ")} |`);
    }
    lines.push("");
  }
  lines.push("## Frozen development-protocol endpoints", "",
    "Each row is a distinct preregistered endpoint, not a component of a score. The automatic and manual strata are reported independently; `all_adjudicated_secondary` is labeled secondary.", "",
    "| Stratum | Candidate | Endpoint | Difference | Lower 95% | Gate |", "| --- | --- | --- | ---: | ---: | --- |");
  for (const [candidateArmId, strata] of Object.entries(compiled.frozenProtocol.candidates)) {
    for (const stratum of ["automatic", "manual", "all_adjudicated_secondary"]) {
      for (const endpoint of strata[stratum].endpoints) lines.push(`| ${stratum} | ${candidateArmId} | ${endpoint.metric} | ${endpoint.candidateMinusBaseline ?? "NA"} | ${endpoint.lower95 ?? "NA"} | ${endpoint.passes == null ? "unknown" : endpoint.passes ? "pass" : "fail"} |`);
    }
  }
  lines.push("");
  lines.push("## Operations", "", "| Arm | Production cost | Median production latency (ms) | Evaluator API cost |",
    "| --- | ---: | ---: | ---: |", ...summary.arms.map((armId) => {
      const prod = summary.operations.production[armId]; const evaluator = summary.operations.evaluator[armId];
      const productionCost = prod.unknownCostAttempts ? `$${prod.knownCostUsd.total.toFixed(6)} known + unknown`
        : `$${prod.completeCostUsd.total.toFixed(6)}`;
      const evaluatorCost = evaluator.totalEvaluatorApiCostUsd == null
        ? `$${evaluator.knownEvaluatorApiCostUsd.toFixed(6)} known + unknown`
        : `$${evaluator.totalEvaluatorApiCostUsd.toFixed(6)}`;
      return `| ${armId} | ${productionCost} | ${prod.latencyMs.median ?? "NA"} | ${evaluatorCost} |`;
    }), "", "Costs with missing usage remain explicitly incomplete: known amounts are never presented as complete totals. Evaluator API cost includes atomic and synthesis calls and is never combined with production cost. Manual-review cost is unavailable unless separately captured; manual duration is reported in summary.json.", "",
    "## Paired censoring", "", "| Case | Disposition | Reason |", "| --- | --- | --- |",
    ...[...caseDisposition].filter(([, row]) => row.stratum === "censored")
      .map(([caseId, row]) => `| ${caseId} | censored | ${row.reason} |`), "",
    "All arm-pair, criterion-specific provider bootstrap differences are in `raw-paired-bootstrap.tsv`. Positive values mean the left arm has a higher event rate; the TSV declares whether higher or lower is favorable for each criterion.", "");
  return `${lines.join("\n")}\n`;
};

const emit = (config, compiled, reader, configFile) => {
  outputRootFresh(config.outputRoot); fs.mkdirSync(config.outputRoot, { recursive: true });
  reader.audit(configFile);
  reader.audit(config.protocolFile);
  for (const arm of config.arms) if (arm.promptSnapshot) reader.audit(arm.promptSnapshot);
  const inputManifest = { schemaVersion: 1, campaignId: config.campaignId,
    files: [...reader.descriptors.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  inputManifest.sealSha256 = sha256(stable(inputManifest));
  writeJson(path.join(config.outputRoot, "input-manifest.json"), inputManifest);
  const caseHeader = ["arm_id", "case_id", "npi", "provider_name", "specialty", "city", "state", "zip",
    "request_json", "cms_baseline_json", "nppes_identity_json", "plan_network_evidence_json", "strata_json",
    "stratum", "reviewer_mode", "censor_reason", "production_error",
    "profiles", "facts", "contacts", "production_cost_usd", "production_known_cost_usd",
    "production_unknown_cost_attempts", "production_latency_ms", "http_sends", "web_searches",
    "evaluator_cost_usd", "evaluator_known_cost_usd", "evaluator_unknown_cost_operations"];
  writeTsv(path.join(config.outputRoot, "raw-case-results.tsv"), caseHeader, compiled.rows.map((row) => {
    const facts = profileFacts(row.production); const context = row.packet.identityContext || {};
    const request = context.request || {};
    const knownEvaluatorCost = row.evaluatorOperations.map((item) => item.knownCostUsd).filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const unknownEvaluatorCosts = row.evaluatorOperations.reduce((sum, item) =>
      sum + item.unknownCostAttempts, 0);
    return [row.armId, row.caseId, request.npi || request.providerId, request.name, request.specialty,
      request.city, request.state, request.zip, request, context.cmsBaseline, context.nppesIdentity,
      row.production.planNetworkEvidence ?? compiled.battery.get(row.caseId)?.planNetworkEvidence ?? null,
      row.production.strata,
      row.stratum, row.reviewerMode, row.censorReason,
      deepText(row.production.error), (row.production.finalProfiles || []).length, facts.length,
      facts.filter((fact) => CONTACT_FIELDS.has(fact.fieldType)).length, row.metrics.costUsd,
      row.metrics.knownCostUsd, row.metrics.unknownCostAttempts, row.metrics.latencyMs,
      row.metrics.httpSends, row.metrics.webSearches,
      unknownEvaluatorCosts ? null : knownEvaluatorCost, knownEvaluatorCost, unknownEvaluatorCosts];
  }));
  writeTsv(path.join(config.outputRoot, "raw-categorical-criteria.tsv"),
    ["arm_id", "case_id", "stratum", "reviewer_mode", "criterion_id", "favorable_direction", "state", "detail_json"],
    compiled.criterionRows.map((row) => [row.armId, row.caseId, row.stratum, row.reviewerMode,
      row.criterionId, row.favorableDirection, row.state, row.detail]));
  const claimAxes = ["exactSupport", "citedSourceSupport", "identityLink", "locationLink", "displaySafety",
    "recency", "fieldValidity", "sourceEligibility", "crossNpiConflict", "requestedNpiResolution",
    "providerIdentitySpanFidelity", "factSpanFidelity", "explicitDateSpanFidelity"];
  const claimHeader = ["arm_id", "case_id", "stratum", "reviewer_mode", "claim_id", "field_type", "value_json",
    "source_id", "source_url", "source_title", "submitted_citation_json", "submitted_provider_identity_span",
    "submitted_fact_span", "submitted_explicit_date_span", ...claimAxes, "reason"];
  writeTsv(path.join(config.outputRoot, "raw-claim-assessments.tsv"), claimHeader,
    compiled.rows.flatMap((row) => (row.judgment?.claimAssessments || []).map((claim) => [row.armId, row.caseId,
      row.stratum, row.reviewerMode, claim.claimId, claim.fieldType, claim.value, claim.sourceId, claim.sourceUrl,
      claim.sourceTitle, claim.submittedCitation, claim.submittedCitation?.providerIdentitySpan,
      claim.submittedCitation?.factSpan, claim.submittedCitation?.explicitFactDateSpan,
      ...claimAxes.map((axis) => claim[axis]), claim.reason])));
  const sourceAxes = ["sourceClass", "identityAttachment", "crossNpiConflict", "requestedNpiResolution",
    "professionalPurpose", "dateStatus", "providerIdentitySupported", "prohibitedForDisplay"];
  writeTsv(path.join(config.outputRoot, "raw-source-assessments.tsv"),
    ["arm_id", "case_id", "stratum", "reviewer_mode", "source_index", "source_id", "source_url",
      "source_title", ...sourceAxes, "declared_dates_json", "notes"],
    compiled.rows.flatMap((row) => (row.judgment?.sourceAssessments || []).map((source, sourceIndex) =>
      [row.armId, row.caseId, row.stratum, row.reviewerMode, sourceIndex, source.sourceId, source.sourceUrl,
        source.sourceTitle, ...sourceAxes.map((axis) => source[axis]), source.declaredDates, source.notes])));
  const candidateAxes = ["exactSupport", "citedSourceSupport", "identityLink", "locationLink", "displaySafety",
    "recency", "fieldValidity", "sourceEligibility", "crossNpiConflict", "requestedNpiResolution",
    "providerIdentitySpanFidelity", "factSpanFidelity", "explicitDateSpanFidelity", "actionFidelity"];
  writeTsv(path.join(config.outputRoot, "raw-candidate-decision-assessments.tsv"),
    ["arm_id", "case_id", "stratum", "reviewer_mode", "candidate_fact_id", "field_type", "value_json",
      "source_id", "source_url", "source_title", "submitted_citation_json", "sanitizer_action_observed",
      "sanitizer_reason_code", ...candidateAxes, "reason"],
    compiled.rows.flatMap((row) => (row.judgment?.candidateDecisionAssessments || []).map((candidate) =>
      [row.armId, row.caseId, row.stratum, row.reviewerMode, candidate.candidateFactId, candidate.fieldType,
        candidate.value, candidate.sourceId, candidate.sourceUrl, candidate.sourceTitle,
        candidate.submittedCitation, candidate.sanitizerActionObserved, candidate.sanitizerReasonCode,
        ...candidateAxes.map((axis) => candidate[axis]), candidate.reason])));
  writeTsv(path.join(config.outputRoot, "raw-case-policy-assessments.tsv"),
    ["arm_id", "case_id", "stratum", "reviewer_mode", "identity_assessment_json",
      "cms_role_assessment_json", "case_policy_assessment_json", "findings_json"],
    compiled.rows.filter((row) => row.judgment).map((row) => [row.armId, row.caseId, row.stratum,
      row.reviewerMode, row.judgment.identityAssessment, row.judgment.cmsRoleAssessment,
      row.judgment.casePolicyAssessment, row.judgment.findings]));
  const fieldAxes = ["topFactDisposition", "crossNpiConflict", "requestedNpiResolution",
    "armFoundBestEligibleClass", "topSelectedClass", "hierarchyOpportunity", "cmsHierarchyConditionalOutcome",
    "recencyOpportunity", "contractFidelity", "directoryComparison"];
  writeTsv(path.join(config.outputRoot, "raw-field-assessments.tsv"),
    ["arm_id", "case_id", "stratum", "reviewer_mode", "field_type", ...fieldAxes, "reason"],
    compiled.rows.flatMap((row) => (row.judgment?.fieldAssessments || []).map((field) => [row.armId, row.caseId,
      row.stratum, row.reviewerMode, field.fieldType, ...fieldAxes.map((axis) => field[axis]), field.reason])));
  writeTsv(path.join(config.outputRoot, "raw-critical-findings.tsv"),
    ["arm_id", "case_id", "stratum", "reviewer_mode", "finding_json"],
    compiled.rows.flatMap((row) => (row.judgment?.criticalFindings || []).map((finding) =>
      [row.armId, row.caseId, row.stratum, row.reviewerMode, finding])));
  writeTsv(path.join(config.outputRoot, "raw-production-attempts.tsv"),
    ["arm_id", "case_id", "attempt_index", "http_status", "transport_error", "input_tokens",
      "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "web_search_calls", "latency_ms",
      "cost_usd", "cost_known", "pricing_version"],
    compiled.productionAttemptRows.map((row) => [row.armId, row.caseId, row.attemptIndex,
      row.httpStatus, row.transportError, row.inputTokens,
      row.cachedInputTokens, row.outputTokens, row.reasoningOutputTokens, row.webSearchCalls, row.latencyMs,
      row.costUsd, row.costKnown, row.pricingVersion]));
  writeTsv(path.join(config.outputRoot, "raw-evaluator-operations.tsv"),
    ["arm_id", "case_id", "stratum", "stage", "operation_id", "status", "duration_ms", "cost_usd",
      "known_cost_usd", "unknown_cost_attempts", "semantic_attempts", "raw_attempt_artifacts_json"],
    compiled.operationRows.map((row) => [row.armId,
      row.caseId, row.stratum, row.stage, row.operationId, row.status, row.durationMs, row.costUsd,
      row.knownCostUsd, row.unknownCostAttempts, row.semanticAttempts, row.rawAttemptArtifacts]));
  writeTsv(path.join(config.outputRoot, "raw-prompt-metrics.tsv"),
    ["arm_id", "name", "static_bytes", "baseline_arm_id", "reduction_vs_baseline_fraction",
      "meets_minimum_reduction", "snapshot_sha256"],
    compiled.promptRows.map((row) => [row.armId, row.name, row.staticBytes, row.baselineArmId,
      row.reductionVsBaselineFraction, row.meetsMinimumReduction, row.snapshot?.sha256]));
  writeTsv(path.join(config.outputRoot, "raw-paired-bootstrap.tsv"),
    ["stratum", "left_arm_id", "right_arm_id", "criterion_id", "favorable_direction", "paired_providers",
      "excluded_unknown_pairs", "left_minus_right", "ci_low", "ci_high", "left_present_right_absent",
      "left_absent_right_present", "iterations", "confidence"], compiled.bootstrapRows.map((row) => [row.stratum,
      row.leftArmId, row.rightArmId, row.criterionId, row.favorableDirection, row.pairedProviders,
      row.excludedUnknownPairs, row.leftMinusRight, row.ciLow, row.ciHigh, row.leftPresentRightAbsent,
      row.leftAbsentRightPresent, row.iterations, row.confidence]));
  const protocolEndpointRows = Object.entries(compiled.frozenProtocol.candidates).flatMap(([candidateArmId, strata]) =>
    Object.entries(strata).flatMap(([stratum, result]) => result.endpoints.map((endpoint) => [stratum,
      compiled.frozenProtocol.baselineArmId, candidateArmId, endpoint.metric, endpoint.pairedProviders,
      endpoint.baselineRate, endpoint.candidateRate, endpoint.candidateMinusBaseline, endpoint.lower95,
      endpoint.upper95, endpoint.margin, endpoint.passes, endpoint.iterations])));
  writeTsv(path.join(config.outputRoot, "raw-frozen-protocol-endpoints.tsv"),
    ["stratum", "baseline_arm_id", "candidate_arm_id", "metric", "paired_providers", "baseline_rate",
      "candidate_rate", "candidate_minus_baseline", "lower95", "upper95", "margin", "passes", "iterations"],
    protocolEndpointRows);
  const protocolGateRows = Object.entries(compiled.frozenProtocol.candidates).flatMap(([candidateArmId, strata]) =>
    Object.entries(strata).flatMap(([stratum, result]) => [
      ...Object.entries(result.issueComparisons).map(([gate, value]) => [stratum, candidateArmId, gate,
        value.countDifference, value.passes, value]),
      ...Object.entries(result.safety).map(([gate, value]) => [stratum, candidateArmId, `safety:${gate}`,
        value.newCandidateClaims.length, value.passes, value]),
      [stratum, candidateArmId, "parser_success_loss", result.parserGate.difference,
        result.parserGate.passes, result.parserGate],
      [stratum, candidateArmId, "unreadability_increase", result.unreadabilityGate.countDifference,
        result.unreadabilityGate.passes, result.unreadabilityGate]
    ]));
  writeTsv(path.join(config.outputRoot, "raw-frozen-protocol-gates.tsv"),
    ["stratum", "candidate_arm_id", "gate", "difference_or_new_count", "passes", "detail_json"],
    protocolGateRows);
  writeTsv(path.join(config.outputRoot, "raw-censored-providers.tsv"),
    ["case_id", "reason", "triggering_arms_json"], [...compiled.caseDisposition]
      .filter(([, disposition]) => disposition.stratum === "censored")
      .map(([caseId, disposition]) => [caseId, disposition.reason, disposition.triggeringArms]));
  writeJson(path.join(config.outputRoot, "summary.json"), { ...compiled.summary,
    inputManifestSealSha256: inputManifest.sealSha256 });
  fs.writeFileSync(path.join(config.outputRoot, "REPORT.md"), markdownReport(compiled));
  const outputs = fs.readdirSync(config.outputRoot).filter((name) => name !== "COMPILATION_COMPLETE.json").sort()
    .map((name) => fileDescriptor(path.join(config.outputRoot, name)));
  const completion = { schemaVersion: 1, status: "CORRECTED_CAMPAIGN_COMPILED", campaignId: config.campaignId,
    noNetworkOrModelCalls: true, noAggregateScore: true,
    authorityProvenance: compiled.summary.authorityProvenance,
    inputManifestSealSha256: inputManifest.sealSha256, outputs };
  completion.sealSha256 = sha256(stable(completion));
  writeJson(path.join(config.outputRoot, "COMPILATION_COMPLETE.json"), completion);
  return completion;
};

const main = () => {
  const configFile = path.resolve(process.argv[2] || "");
  if (!process.argv[2] || !fs.existsSync(configFile)) {
    throw new Error("Usage: compile_campaign.js /absolute/or/relative/manifest.json");
  }
  const raw = JSON.parse(fs.readFileSync(configFile, "utf8"));
  raw.paths = { ...(raw.paths || {}) };
  for (const [envName, key] of [["PACKET_ROOT", "packetRoot"], ["ATOMIC_ROOT", "atomicRoot"],
    ["SYNTHESIS_ROOT", "synthesisRoot"], ["MANUAL_SEAL_FILE", "manualSealFile"],
    ["MANUAL_MAP_FILE", "manualMapFile"], ["CONSISTENCY_TRIGGER_FILE", "consistencyTriggerFile"]]) {
    if (process.env[envName]) raw.paths[key] = process.env[envName];
  }
  raw.arms = (raw.arms || []).map((arm) => {
    const envName = `PRODUCTION_ROOT_${arm.armId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
    return process.env[envName] ? { ...arm, productionRoot: process.env[envName] } : arm;
  });
  const config = normalizeConfig(raw, configFile, process.env.OUTPUT_ROOT || null);
  outputRootFresh(config.outputRoot);
  const reader = createAuditedReader();
  const compiled = compile(config, reader);
  const completion = emit(config, compiled, reader, configFile);
  process.stdout.write(`${JSON.stringify(completion, null, 2)}\n`);
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
}

module.exports = { CRITERIA, assertAtomicToSynthesisManualTransition, assertPlanNetworkIsolation,
  compile, criterionStates,
  createAuditedReader, distribution, emit, loadCaseBattery,
  evaluatorCostBreakdown,
  judgmentWithBindings, manualArtifacts, markdownReport, normalizeConfig, operationalCensor,
  pairedBootstrap, parserSucceeded, passesNoninferiority, productionMetrics, protocolAnalysis,
  protocolBootstrap, protocolIssueFlags,
  protocolMetricParts, quantile, verifyCompilerAuthorityTransition };

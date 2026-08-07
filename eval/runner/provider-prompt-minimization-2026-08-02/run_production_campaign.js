#!/usr/bin/env node
"use strict";

// One manifest-driven production runner for development and holdout campaigns.
// Dataset role changes frozen inputs only; transport capture, scheduling, retry
// ownership, telemetry, and artifact shape remain identical.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { AsyncLocalStorage } = require("node:async_hooks");

const WORKSPACE = "/Users/kui/lucie/EDE";
const RATE_CARD = Object.freeze({
  inputUsdPerMillion: 2.5,
  cachedInputUsdPerMillion: 0.25,
  cacheWriteUsdPerMillion: 3.125,
  outputUsdPerMillion: 15,
  webSearchUsdPerThousand: 14,
  pricingVersion: "azure-public-list-2026-07-30"
});
const RESPONSES_URL = "https://foundry-lucie-ai.openai.azure.com/openai/v1/responses";
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const NON_TREATMENT_FILES = Object.freeze([
  "src/services/ai-provider/responses-provider.client.ts",
  "src/services/ai-provider/usage-telemetry.ts"
]);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const readJsonl = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
const readCases = (file, format) => {
  if (format === "jsonl_rows") return readJsonl(file);
  if (format === "json_object_cases") {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    assert(Array.isArray(value.cases), "json_object_cases input must contain a cases array.");
    return value.cases;
  }
  throw new Error("caseFileFormat must be jsonl_rows or json_object_cases.");
};
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
};
const git = (root, ...args) => childProcess.execFileSync("git", ["-C", root, ...args], {
  encoding: "utf8"
}).trim();
const gitBytes = (root, ...args) => childProcess.execFileSync("git", ["-C", root, ...args]);
const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};
const safeHeaders = (headers, allowed) => {
  const source = new Headers(headers || {});
  return Object.fromEntries(allowed.flatMap((name) => {
    const value = source.get(name);
    return value == null ? [] : [[name, value]];
  }));
};
const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const requestUrl = (input) => typeof input === "string" ? input
  : input instanceof URL ? input.href : input.url;
const requestMethod = (input, init) => String(init?.method
  || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
const requestBodyText = async (input, init) => {
  if (typeof init?.body === "string") return init.body;
  if (typeof Request !== "undefined" && input instanceof Request) return input.clone().text();
  return null;
};
const requestHeaders = (input, init) => new Headers(init?.headers
  || (typeof Request !== "undefined" && input instanceof Request ? input.headers : {}));
const assertSdkTimeoutHeader = (headers, timeoutMs) => {
  const advertisedSeconds = headers.get("x-stainless-timeout");
  // openai 5.23.2 enforces its client default with an AbortController but only
  // advertises this header when timeout is explicit on the request. The loaded
  // SDK's DEFAULT_TIMEOUT is independently verified during manifest admission.
  assert(advertisedSeconds == null || advertisedSeconds === String(timeoutMs / 1000),
    "Outbound SDK timeout header conflicts with the pinned SDK timeout.");
};
const unknownUsage = (latencyMs) => ({
  usagePresent: false, inputTokens: null, cachedInputTokens: null, uncachedInputTokens: null,
  cacheWriteTokens: null, outputTokens: null, reasoningOutputTokens: null, totalTokens: null,
  webSearchCalls: 0, estimated: false, pricingVersion: null, inputUsd: null,
  cachedInputUsd: null, outputUsd: null, cacheWriteUsd: null, webSearchUsd: null,
  totalUsd: null, latencyMs
});
const resolveOpenAiPackage = (armRoot, sdkModules) => {
  const entry = require.resolve("openai", { paths: [path.join(armRoot, "src"), sdkModules] });
  const packageFile = path.join(path.dirname(entry), "package.json");
  const bytes = fs.readFileSync(packageFile);
  return { entry, packageFile, packageJsonSha256: sha256(bytes),
    version: JSON.parse(bytes).version };
};

const serializeError = (error, depth = 0, seen = new Set()) => {
  if (error == null || depth > 8) return null;
  if ((typeof error === "object" || typeof error === "function") && seen.has(error)) return { circular: true };
  if (typeof error === "object" || typeof error === "function") seen.add(error);
  const value = typeof error === "object" || typeof error === "function" ? error : { message: String(error) };
  return {
    constructorName: value?.constructor?.name || null,
    name: value?.name || null,
    status: value?.status ?? null,
    code: value?.code ?? null,
    message: String(value?.message || error).slice(0, 2000),
    cause: value?.cause == null ? null : serializeError(value.cause, depth + 1, seen)
  };
};

const seededRandom = (seed) => {
  let counter = 0;
  return () => {
    const bytes = crypto.createHash("sha256").update(`${seed}:${counter++}`).digest();
    return bytes.readUInt32BE(0) / 0x100000000;
  };
};
const shuffled = (values, random) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};
const buildSchedule = ({ caseIds, armIds, seed }) => {
  const random = seededRandom(seed);
  return shuffled(caseIds, random).flatMap((caseId) => shuffled(armIds, random)
    .map((armId, withinCasePosition) => ({ armId, caseId, withinCasePosition })));
};

const validateManifest = (manifest, manifestFile) => {
  const base = path.dirname(manifestFile);
  const resolve = (value) => path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
  assert(manifest.schemaVersion === 1, "Production campaign manifest schemaVersion must be 1.");
  assert(typeof manifest.campaignId === "string" && manifest.campaignId, "campaignId is required.");
  assert(new Set(["development", "sealed_holdout"]).has(manifest.datasetRole),
    "datasetRole must be development or sealed_holdout.");
  assert(typeof manifest.caseFile === "string" && /^[a-f0-9]{64}$/.test(manifest.caseFileSha256 || ""),
    "caseFile and caseFileSha256 are required.");
  assert(new Set(["jsonl_rows", "json_object_cases"]).has(manifest.caseFileFormat),
    "caseFileFormat must be jsonl_rows or json_object_cases.");
  assert(typeof manifest.outputRoot === "string" && manifest.outputRoot, "outputRoot is required.");
  assert(manifest.model === "gpt-5.6-terra" && manifest.reasoning === "low",
    "Production comparison is pinned to gpt-5.6-terra with low reasoning.");
  assert(Number.isInteger(manifest.concurrency) && manifest.concurrency >= 1 && manifest.concurrency <= 20,
    "concurrency must be an integer from 1 through 20.");
  assert(manifest.maxToolCalls === 8, "maxToolCalls must equal 8.");
  assert(/^[a-f0-9]{40}$/.test(manifest.expectedRunnerCommit || "")
    && /^[a-f0-9]{64}$/.test(manifest.expectedRunnerSha256 || ""),
  "expectedRunnerCommit and expectedRunnerSha256 are required.");
  assert(manifest.runtime?.nodeVersion === process.version
    && manifest.runtime?.openaiVersion === "5.23.2"
    && manifest.runtime?.timeoutMs === 600_000
    && typeof manifest.runtime?.sdkModules === "string"
    && /^[a-f0-9]{64}$/.test(manifest.runtime?.openaiPackageJsonSha256 || ""),
  "runtime must pin this Node version, OpenAI SDK 5.23.2, and its 600000ms timeout.");
  assert(manifest.runtime?.responsesUrl === RESPONSES_URL,
    `runtime.responsesUrl must equal ${RESPONSES_URL}.`);
  assert(manifest.runtime?.retryPolicy?.initialSdkMaxRetries === 1
    && manifest.runtime?.retryPolicy?.semanticRetrySdkMaxRetries === 0
    && manifest.runtime?.retryPolicy?.maxObservedHttpAttempts === 3,
  "runtime.retryPolicy must pin the production client's 1+0 SDK retries and three-send ceiling.");
  assert(NON_TREATMENT_FILES.every((file) => /^[a-f0-9]{64}$/.test(
    manifest.nonTreatmentSurfaceSha256?.[file] || "")),
  "nonTreatmentSurfaceSha256 must pin client and usage telemetry sources.");
  assert(typeof manifest.seed === "string" && manifest.seed, "seed is required.");
  assert(Array.isArray(manifest.arms) && manifest.arms.length >= 2, "At least two arms are required.");
  const sdkModules = resolve(manifest.runtime.sdkModules);
  assert(fs.statSync(sdkModules).isDirectory(), "runtime.sdkModules must be an existing directory.");
  const arms = manifest.arms.map((arm) => ({ ...arm, root: resolve(arm.root) }));
  assert(new Set(arms.map((arm) => arm.armId)).size === arms.length, "armId values must be unique.");
  for (const arm of arms) {
    assert(arm.armId && arm.name && arm.root && /^[a-f0-9]{40}$/.test(arm.commit || ""),
      "Every arm needs armId, name, root, and full commit SHA.");
    assert(git(arm.root, "rev-parse", "HEAD") === arm.commit, `${arm.armId} commit mismatch.`);
    assert(!git(arm.root, "status", "--porcelain", "--untracked-files=all"), `${arm.armId} worktree is dirty.`);
    for (const file of NON_TREATMENT_FILES) {
      assert(sha256(fs.readFileSync(path.join(arm.root, file))) === manifest.nonTreatmentSurfaceSha256[file],
        `${arm.armId} non-treatment surface differs: ${file}`);
    }
  }
  const sdkAudits = Object.fromEntries(arms.map((arm) => {
    const audit = resolveOpenAiPackage(arm.root, sdkModules);
    assert(audit.version === manifest.runtime.openaiVersion,
      `${arm.armId} resolves unexpected OpenAI SDK ${audit.version}.`);
    assert(audit.packageJsonSha256 === manifest.runtime.openaiPackageJsonSha256,
      `${arm.armId} resolves unpinned OpenAI SDK package bytes.`);
    const OpenAI = require(audit.entry).default;
    assert(OpenAI.DEFAULT_TIMEOUT === manifest.runtime.timeoutMs,
      `${arm.armId} OpenAI SDK default timeout differs from the manifest.`);
    return [arm.armId, audit];
  }));
  const caseFile = resolve(manifest.caseFile);
  assert(sha256(fs.readFileSync(caseFile)) === manifest.caseFileSha256, "Frozen case battery changed.");
  const cases = readCases(caseFile, manifest.caseFileFormat);
  assert(cases.length > 0 && cases.every((item) => item.caseId && item.request), "Invalid case battery rows.");
  const allCaseIds = cases.map((item) => item.caseId);
  assert(new Set(allCaseIds).size === allCaseIds.length, "Frozen battery case IDs must be unique.");
  const caseIds = manifest.caseIds || allCaseIds;
  assert(Array.isArray(caseIds) && caseIds.length > 0 && new Set(caseIds).size === caseIds.length,
    "caseIds must be a nonempty unique list.");
  assert(caseIds.every((caseId) => allCaseIds.includes(caseId)), "caseIds contains a case outside the battery.");
  if (manifest.datasetRole === "sealed_holdout") {
    assert(manifest.holdoutAuthorization?.status === "AUTHORIZED_FINAL_CERTIFICATION",
      "Sealed holdout requires explicit final-certification authorization in the manifest.");
  }
  return { ...manifest, runtime: { ...manifest.runtime, sdkModules }, caseFile,
    outputRoot: resolve(manifest.outputRoot), arms, cases, caseIds, sdkAudits };
};

const responseTrace = (raw, parser) => ({
  actionSourceUrls: parser.extractResponseWebSearchSourceUrls(raw),
  openedUrls: parser.extractResponseWebSearchOpenedUrls(raw),
  citationUrls: parser.extractResponseCitationUrls(raw),
  provenanceUrls: parser.extractResponseProvenanceUrls(raw),
  output: (raw?.output || []).map((item) => ({
    id: item.id || null,
    type: item.type || null,
    status: item.status || null,
    action: item.action || null,
    content: item.content || null
  }))
});

const pool = async (items, concurrency, operation) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
};

const main = async () => {
  const manifestFile = path.resolve(process.argv[2] || "");
  const mode = process.argv[3] || "run";
  assert(process.argv[2] && fs.existsSync(manifestFile),
    "Usage: run_production_campaign.js manifest.json [validate]");
  assert(new Set(["run", "validate"]).has(mode), "Mode must be run or validate.");
  const manifestBytes = fs.readFileSync(manifestFile);
  const config = validateManifest(JSON.parse(manifestBytes), manifestFile);
  const runnerRepo = git(__dirname, "rev-parse", "--show-toplevel");
  const runnerFile = path.resolve(__filename);
  const runnerBytes = fs.readFileSync(runnerFile);
  const runnerRelativeFile = path.relative(runnerRepo, runnerFile);
  const runnerCommit = git(runnerRepo, "rev-list", "-1", "HEAD", "--", runnerRelativeFile);
  assert(runnerCommit === config.expectedRunnerCommit,
    "Executing runner file does not descend from the manifest-pinned runner commit.");
  assert(sha256(runnerBytes) === config.expectedRunnerSha256, "Executing runner bytes differ from manifest.");
  assert(sha256(gitBytes(runnerRepo, "show", `${runnerCommit}:${runnerRelativeFile}`))
    === config.expectedRunnerSha256, "Manifest runner hash differs from its committed blob.");
  assert(!git(runnerRepo, "status", "--porcelain", "--", runnerRelativeFile),
    "Executing runner file is dirty.");
  assert(!fs.existsSync(config.outputRoot), `Fresh output path already exists: ${config.outputRoot}`);
  const schedule = buildSchedule({
    caseIds: config.caseIds, armIds: config.arms.map((arm) => arm.armId), seed: config.seed
  });
  if (mode === "validate") {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: "PRODUCTION_CAMPAIGN_ADMITTED",
      campaignId: config.campaignId, datasetRole: config.datasetRole, rows: schedule.length,
      arms: config.arms.map((arm) => arm.armId), cases: config.caseIds.length,
      runnerCommit, runnerSha256: sha256(runnerBytes), networkCallsMade: 0, paidCallsMade: 0 }, null, 2)}\n`);
    return;
  }

  process.env.AI_FEATURE_ENABLED = "true";
  process.env.AI_WEBSEARCH_COMPLIANCE_CONFIRMED = "true";
  process.env.AZURE_OPENAI_ENDPOINT = "https://foundry-lucie-ai.openai.azure.com";
  process.env.AZURE_OPENAI_DEPLOYMENT = config.model;
  process.env.AI_REASONING_EFFORT = config.reasoning;
  process.env.AI_WEBSEARCH_TOOL_CHOICE = "required";
  process.env.AI_WEBSEARCH_MAX_TOOL_CALLS = String(config.maxToolCalls);
  process.env.AI_WEBSEARCH_PARALLEL_TOOL_CALLS = "true";
  process.env.AI_WEBSEARCH_ALLOWED_DOMAINS = "";
  process.env.AI_WEBSEARCH_BLOCKED_DOMAINS = "";
  process.env.AI_COST_INPUT_USD_PER_MILLION = String(RATE_CARD.inputUsdPerMillion);
  process.env.AI_COST_CACHED_INPUT_USD_PER_MILLION = String(RATE_CARD.cachedInputUsdPerMillion);
  process.env.AI_COST_CACHE_WRITE_USD_PER_MILLION = String(RATE_CARD.cacheWriteUsdPerMillion);
  process.env.AI_COST_OUTPUT_USD_PER_MILLION = String(RATE_CARD.outputUsdPerMillion);
  process.env.AI_COST_WEB_SEARCH_USD_PER_THOUSAND = String(RATE_CARD.webSearchUsdPerThousand);
  process.env.AI_COST_PRICING_VERSION = RATE_CARD.pricingVersion;
  if (!process.env.AZURE_OPENAI_API_KEY) {
    process.env.AZURE_OPENAI_API_KEY = fs.readFileSync("/Users/kui/lucie_api_key.txt", "utf8").trim();
  }
  process.env.TS_NODE_PROJECT = path.join(WORKSPACE, "API-AI-Websearch/tsconfig.json");
  process.env.NODE_PATH = [path.join(WORKSPACE, "API-AI-Websearch/node_modules"), process.env.NODE_PATH]
    .filter(Boolean).join(path.delimiter);
  require("node:module").Module._initPaths();
  require(path.join(WORKSPACE, "API-AI-Websearch/node_modules/ts-node/register/transpile-only"));

  const modules = Object.fromEntries(config.arms.map((arm) => {
    const client = require(path.join(arm.root, "src/services/ai-provider/responses-provider.client"));
    return [arm.armId, {
      Client: client.ProviderProfileResponsesClient,
      makeRequest: client.providerProfileResponseRequest,
      parser: require(path.join(arm.root, "src/services/ai-provider/response-parser")),
      sanitizer: require(path.join(arm.root, "src/services/provider-profile-sanitizer.service"))
    }];
  }));
  // Accounting is an evaluation concern, not a treatment. All arms were already
  // admitted with the same source hash, so load one fixed extractor exactly once.
  const hostUsage = require(path.join(config.arms[0].root,
    "src/services/ai-provider/usage-telemetry"));

  const capture = new AsyncLocalStorage();
  const baseFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const context = capture.getStore();
    if (!context) return baseFetch(input, init);
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const bodyText = await requestBodyText(input, init);
    let requestBody = null;
    try { requestBody = bodyText == null ? null : JSON.parse(bodyText); } catch {}
    const bodySha256 = bodyText == null ? null : sha256(Buffer.from(bodyText));
    const outboundHeaders = requestHeaders(input, init);
    assert(url === RESPONSES_URL, `Unexpected outbound URL: ${url}`);
    assert(method === "POST", `Unexpected outbound method: ${method}`);
    assertSdkTimeoutHeader(outboundHeaders, config.runtime.timeoutMs);
    assert(requestBody && context.allowedRequestHashes.has(sha256(stableJson(requestBody))),
      "Outbound Responses body differs from both precomputed production requests.");
    assert(context.sends.length < 3, "Production retry policy exceeded three HTTP sends.");
    const requestRecord = {
      url, method, bodySha256, bodyBytes: bodyText == null ? 0 : Buffer.byteLength(bodyText),
      body: requestBody,
      headers: safeHeaders(outboundHeaders, ["content-type", "user-agent", "x-stainless-retry-count",
        "x-stainless-timeout"])
    };
    const startedAt = new Date().toISOString();
    const start = Date.now();
    try {
      const response = await baseFetch(input, init);
      const bytes = Buffer.from(await response.clone().arrayBuffer());
      const capturedBytes = bytes.subarray(0, MAX_CAPTURE_BYTES);
      let raw = null;
      try { raw = JSON.parse(bytes.toString("utf8")); } catch {}
      context.sends.push({
        startedAt, completedAt: new Date().toISOString(), latencyMs: Date.now() - start,
        request: requestRecord, status: response.status,
        responseHeaders: safeHeaders(response.headers, ["content-type", "content-length", "x-request-id",
          "apim-request-id", "x-ms-request-id", "request-id"]),
        responseBytes: bytes.length, responseSha256: sha256(bytes),
        responseBodyBase64: capturedBytes.toString("base64"),
        responseBodyCapturedBytes: capturedBytes.length,
        responseBodyTruncated: capturedBytes.length !== bytes.length, raw
      });
      return response;
    } catch (error) {
      context.sends.push({
        startedAt, completedAt: new Date().toISOString(), latencyMs: Date.now() - start,
        request: requestRecord, status: null, error: serializeError(error)
      });
      throw error;
    }
  };

  const caseMap = new Map(config.cases.map((item) => [item.caseId, item]));
  const armMap = new Map(config.arms.map((arm) => [arm.armId, arm]));
  const runCell = async ({ armId, caseId, withinCasePosition }, schedulePosition) => {
    const item = caseMap.get(caseId);
    // No object is shared between cells or arms. Freezing also turns accidental
    // treatment mutation into an observable failure instead of cross-arm drift.
    const input = deepFreeze({ lineOfCoverage: "Medical", providers: [cloneJson(item.request)] });
    const arm = armMap.get(armId);
    const mod = modules[armId];
    const expectedInitialRequest = deepFreeze(cloneJson(mod.makeRequest(input, false)));
    const expectedIdentityRequest = deepFreeze(cloneJson(mod.makeRequest(input, true)));
    const expectedRequestHashes = {
      initial: sha256(stableJson(expectedInitialRequest)),
      identity: sha256(stableJson(expectedIdentityRequest))
    };
    const allowedRequestHashes = new Set(Object.values(expectedRequestHashes));
    const sends = [];
    const startedAt = new Date().toISOString();
    const start = Date.now();
    let parserProfiles = [];
    let finalProfiles = [];
    let error = null;
    try {
      parserProfiles = await capture.run({ sends, allowedRequestHashes },
        () => new mod.Client().searchProviderProfiles(input));
      finalProfiles = mod.sanitizer.sanitizeProviderProfilesForRequest(parserProfiles, input.providers);
    } catch (caught) {
      error = serializeError(caught);
    }
    const responseSends = sends.filter((send) => send.raw);
    const finalRaw = responseSends.at(-1)?.raw || null;
    assert(sends.length <= 3, `${armId}/${caseId} exceeded the production retry ceiling.`);
    const usage = sends.map((send) => {
      if (!send.raw) return unknownUsage(send.latencyMs);
      const extracted = hostUsage.extractAiResponseUsage(send.raw);
      return { ...extracted, ...hostUsage.estimateAiResponseCost(extracted, RATE_CARD), latencyMs: send.latencyMs };
    });
    const artifact = {
      schemaVersion: 2, campaignId: config.campaignId, datasetRole: config.datasetRole,
      armId, armName: arm.name, armCommit: arm.commit, caseId, schedulePosition, withinCasePosition,
      startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - start,
      input, cmsBaseline: item.cmsBaseline || null, planNetworkEvidence: item.planNetworkEvidence || null,
      strata: item.strata || null,
      expectedRequests: { initial: expectedInitialRequest, identity: expectedIdentityRequest,
        sha256: expectedRequestHashes },
      sends,
      rawResponses: responseSends.map((send) => send.raw),
      trace: finalRaw ? responseTrace(finalRaw, mod.parser) : null,
      parserProfiles, finalProfiles, usage, error
    };
    writeJsonExclusive(path.join(config.outputRoot, "cells", armId, caseId, "artifact.json"), artifact);
    process.stdout.write(`${schedulePosition + 1}/${schedule.length} ${armId}/${caseId}: `
      + `${error ? "ERROR" : "OK"} ${artifact.durationMs}ms sends=${sends.length}\n`);
    return artifact;
  };

  fs.mkdirSync(config.outputRoot, { recursive: true });
  writeJsonExclusive(path.join(config.outputRoot, "preregistration.json"), {
    schemaVersion: 2, campaignId: config.campaignId, datasetRole: config.datasetRole,
    manifestFile, manifestSha256: sha256(manifestBytes), caseFile: config.caseFile,
    caseFileSha256: config.caseFileSha256, caseFileFormat: config.caseFileFormat,
    caseIds: config.caseIds,
    runner: { file: runnerFile, relativeFile: runnerRelativeFile, sha256: sha256(runnerBytes),
      commit: runnerCommit, nodeExecutable: process.execPath, nodeVersion: process.version },
    arms: config.arms.map(({ armId, name, root, commit }) => ({ armId, name, root, commit })),
    runtime: { endpoint: process.env.AZURE_OPENAI_ENDPOINT, model: config.model,
      reasoning: config.reasoning, maxToolCalls: config.maxToolCalls, concurrency: config.concurrency,
      retryOwner: "production_client", sdkAudits: config.sdkAudits,
      timeoutMs: config.runtime.timeoutMs },
    rateCard: RATE_CARD, seed: config.seed, schedule
  });
  const results = await pool(schedule, config.concurrency, runCell);
  writeJsonExclusive(path.join(config.outputRoot, "summary.json"), {
    schemaVersion: 2, campaignId: config.campaignId, rows: results.length,
    successes: results.filter((item) => !item.error).length,
    errors: results.filter((item) => item.error).map(({ armId, caseId, error }) => ({ armId, caseId, error })),
    arms: Object.fromEntries(config.arms.map(({ armId }) => {
      const rows = results.filter((item) => item.armId === armId);
      const attempts = rows.flatMap((item) => item.usage);
      const knownSubtotal = (field) => attempts.reduce((total, usage) => total
        + (typeof usage[field] === "number" ? usage[field] : 0), 0);
      const completeTotal = (field) => attempts.every((usage) => typeof usage[field] === "number")
        ? knownSubtotal(field) : null;
      const missingUsageAttempts = attempts.filter((usage) => !usage.usagePresent).length;
      const unknownCostAttempts = attempts.filter((usage) => usage.totalUsd === null).length;
      return [armId, { rows: rows.length, profiles: rows.filter((item) => item.finalProfiles.length > 0).length,
        attempts: attempts.length, missingUsageAttempts, unknownCostAttempts,
        inputTokens: completeTotal("inputTokens"), knownInputTokensSubtotal: knownSubtotal("inputTokens"),
        cachedInputTokens: completeTotal("cachedInputTokens"),
        knownCachedInputTokensSubtotal: knownSubtotal("cachedInputTokens"),
        outputTokens: completeTotal("outputTokens"), knownOutputTokensSubtotal: knownSubtotal("outputTokens"),
        searches: knownSubtotal("webSearchCalls"),
        estimatedCostUsd: completeTotal("totalUsd"),
        knownEstimatedCostUsdSubtotal: knownSubtotal("totalUsd"),
        totalsComplete: missingUsageAttempts === 0 && unknownCostAttempts === 0 }];
    }))
  });
};

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

module.exports = { assertSdkTimeoutHeader, buildSchedule, deepFreeze, readCases, requestHeaders,
  seededRandom, serializeError, shuffled, validateManifest };

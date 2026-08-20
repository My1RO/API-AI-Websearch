#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Agent } = require("undici");
const {
  canonicalExactSourceUrl,
  assertFetchablePublicUrl,
  createPublicLookup
} = require("./public_url_canonicalizer.js");

const protocolConfigPath = process.env.PROVIDER_EVALUATOR_PROTOCOL_CONFIG
  ? path.resolve(process.env.PROVIDER_EVALUATOR_PROTOCOL_CONFIG) : null;
const protocolConfig = protocolConfigPath ? JSON.parse(fs.readFileSync(protocolConfigPath, "utf8")) : null;
const synthesisProtocol = protocolConfig?.schemaVersion === 2
  ? require(path.join(__dirname, "synthesis_protocol.js")) : null;
if (synthesisProtocol) synthesisProtocol.validateShape(protocolConfig);
const DEFAULT_NORMALIZER_MODULE = path.join(__dirname, "source_ingestion.js");
const NORMALIZER_MODULE_PATH = path.resolve(process.env.PROVIDER_EVALUATOR_NORMALIZER_MODULE || DEFAULT_NORMALIZER_MODULE);
if (!fs.existsSync(NORMALIZER_MODULE_PATH)) throw new Error(`Evaluator normalizer module is absent: ${NORMALIZER_MODULE_PATH}`);
const FULL_SOURCE = require(NORMALIZER_MODULE_PATH);
const NORMALIZER_MODULE_SHA256 = crypto.createHash("sha256").update(fs.readFileSync(NORMALIZER_MODULE_PATH)).digest("hex");

const SUPPORTED_RUNS = protocolConfig ? Object.freeze({
  [protocolConfig.productionProtocol]: Object.freeze({
    runMode: protocolConfig.runMode,
    expectedRows: protocolConfig.expectedRuns,
    sealMode: protocolConfig.sealMode
  })
}) : Object.freeze({});
// Admit the complete frozen battery so one origin's Retry-After cannot hold
// the cell queue in front of unrelated origins. Network and normalization
// work remain independently bounded below.
const CELL_CONCURRENCY = 120;
const SOURCE_CONCURRENCY_PER_CELL = 6;
const GLOBAL_TRANSFER_CONCURRENCY = 32;
const NORMALIZATION_CONCURRENCY = 8;
const NORMALIZATION_TIMEOUT_MS = 20_000;
const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const ORIGIN_CONCURRENCY = 4;
const ORIGIN_MINIMUM_START_INTERVAL_MS = 2_000;
const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_AFTER_MS = 1_200_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = FULL_SOURCE.FETCH_MAX_TRANSFER_BYTES;
const EXTRACTOR_VERSION = FULL_SOURCE.SEMANTIC_MARKDOWN_EXTRACTOR_VERSION;
const COLLECTOR_VERSION = "provider-evidence-collector-v1";
const EVIDENCE_REQUEST_HEADERS = Object.freeze({
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
  "accept-language": "en-US,en;q=0.9",
  // Request an uncompressed representation so transfer-byte bounds and raw
  // body hashes describe the same bytes the normalizer receives. This is part
  // of the collector itself; no global fetch monkey-patch/preload is needed.
  "accept-encoding": "identity"
});

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const now = () => new Date().toISOString();
const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class OriginConcurrencyLimiter {
  constructor(limit = ORIGIN_CONCURRENCY, minimumStartIntervalMs = ORIGIN_MINIMUM_START_INTERVAL_MS,
    delayImpl = delay, clockMs = monotonicMs) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Origin concurrency must be a positive integer.");
    if (!Number.isInteger(minimumStartIntervalMs) || minimumStartIntervalMs < 0) {
      throw new Error("Origin minimum start interval must be a nonnegative integer.");
    }
    this.limit = limit;
    this.minimumStartIntervalMs = minimumStartIntervalMs;
    this.delayImpl = delayImpl;
    this.clockMs = clockMs;
    this.states = new Map();
  }

  async run(url, operation) {
    const origin = new URL(url).origin;
    let state = this.states.get(origin);
    if (!state) {
      state = { active: 0, queue: [], nextStartAtMs: 0 };
      this.states.set(origin, state);
    }
    if (state.active >= this.limit) {
      await new Promise((resolve) => state.queue.push(resolve));
    }
    state.active += 1;
    try {
      const waitMs = Math.max(0, state.nextStartAtMs - this.clockMs());
      if (waitMs > 0) await this.delayImpl(waitMs);
      state.nextStartAtMs = this.clockMs() + this.minimumStartIntervalMs;
      return await operation();
    } finally {
      state.active -= 1;
      const next = state.queue.shift();
      if (next) next();
    }
  }

  defer(url, waitMs) {
    if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error("Origin cooldown must be a nonnegative finite duration.");
    const origin = new URL(url).origin;
    let state = this.states.get(origin);
    if (!state) {
      state = { active: 0, queue: [], nextStartAtMs: 0 };
      this.states.set(origin, state);
    }
    state.nextStartAtMs = Math.max(state.nextStartAtMs, this.clockMs() + waitMs);
  }
}

class ConcurrencyLimiter {
  constructor(limit = GLOBAL_TRANSFER_CONCURRENCY) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Global concurrency must be a positive integer.");
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async run(operation) {
    if (this.active >= this.limit) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

class ExactRequestUrlFetchCache {
  constructor() {
    this.entries = new Map();
  }

  run(requestedUrl, operation) {
    if (typeof requestedUrl !== "string" || requestedUrl.length === 0) {
      throw new Error("Exact-request-URL cache requires a non-empty URL string.");
    }
    if (!this.entries.has(requestedUrl)) {
      // Store the promise before starting the operation so concurrent callers
      // for the same literal request URL cannot race into duplicate fetches.
      this.entries.set(requestedUrl, Promise.resolve().then(operation));
    }
    return this.entries.get(requestedUrl);
  }

  get size() {
    return this.entries.size;
  }
}

const parseRetryAfterMs = (value, clockMs = Date.now()) => {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Math.max(0, Math.ceil(Number(normalized) * 1_000));
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - clockMs) : null;
};

const retryDelayMs = ({ response, attempt, baseDelayMs = RETRY_BASE_DELAY_MS, maximumRetryAfterMs = MAX_RETRY_AFTER_MS, clockMs = Date.now() }) => {
  const fallback = baseDelayMs * attempt;
  if (response?.status !== 429) return fallback;
  const requested = parseRetryAfterMs(response.headers.get("retry-after"), clockMs);
  return Math.min(maximumRetryAfterMs, Math.max(fallback, requested ?? fallback));
};

const configuredTransportPolicy = () => ({
  timeoutMs: FETCH_TIMEOUT_MS,
  maximumTotalAttempts: FETCH_ATTEMPTS,
  verification: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
    ? "issuer_verification_disabled_by_protocol"
    : process.env.NODE_EXTRA_CA_CERTS
      ? "custom_ca_verified"
      : "runtime_default_verified",
  nodeTlsRejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? "0" : "default",
  nodeExtraCaCertsConfigured: Boolean(process.env.NODE_EXTRA_CA_CERTS)
});

const preflightTlsTransport = async (fetchImpl = globalThis.fetch, timeoutMs = 20_000) => {
  const policy = configuredTransportPolicy();
  const url = "https://npiregistry.cms.hhs.gov/";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("tls_preflight_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: controller.signal });
    await response.body?.cancel("tls_preflight_complete");
    return { schemaVersion: 1, checkedAt: now(), url, httpStatus: response.status, ...policy };
  } catch (error) {
    throw new Error(`Evidence TLS preflight failed under ${policy.verification}: ${String(error?.message || error)}`);
  } finally {
    clearTimeout(timer);
  }
};

const canonicalUrl = (value) => {
  assertFetchablePublicUrl(value);
  const canonical = canonicalExactSourceUrl(value);
  if (!canonical) throw new Error(`Invalid public evidence URL: ${value}`);
  return canonical;
};

const facts = (profiles) => {
  const out = [];
  for (const profile of profiles || []) {
    for (const field of ["specialties", "locations", "phoneNumbers", "ratings", "websites"]) {
      for (const fact of profile[field] || []) out.push({ field, fact });
    }
  }
  return out;
};

const enumerateArmSources = ({ trace = {}, rawProfiles = [], finalProfiles = [] }) => {
  const byCanonical = new Map();
  const add = (url, channel, structured = null) => {
    if (!url) return;
    let canonical;
    try { canonical = canonicalUrl(url); } catch { return; }
    const current = byCanonical.get(canonical) || {
      sourceId: `azure_${sha256(canonical).slice(0, 12)}`,
      requestedUrl: url,
      canonicalUrl: canonical,
      channels: new Set(),
      structuredSourceTitles: new Set()
    };
    current.channels.add(channel);
    if (structured?.citation?.sourceTitle) current.structuredSourceTitles.add(structured.citation.sourceTitle);
    byCanonical.set(canonical, current);
  };
  for (const url of trace.actionSourceUrls || []) add(url, "azure_action_source");
  for (const url of trace.provenanceUrls || []) add(url, "azure_provenance");
  for (const url of trace.citationUrls || []) add(url, "native_url_citation");
  for (const url of trace.openedUrls || []) add(url, "open_page");
  for (const { fact } of [...facts(rawProfiles), ...facts(finalProfiles)]) {
    add(fact?.citation?.sourceUrl, "structured_fact_citation", fact);
  }
  return [...byCanonical.values()]
    .map((source) => ({
      ...source,
      channels: [...source.channels].sort(),
      structuredSourceTitles: [...source.structuredSourceTitles].sort(),
      creditEligible: true,
      evidenceRole: "arm_generated_source",
      recencyPresumption: "none_undated_evidence_remains_eligible"
    }))
    .sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
};

const runPool = async (items, concurrency, operation) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
};

const readBoundedResponseBody = async (response, maximumBytes = MAX_BYTES) => {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel("body_exceeds_limit");
        throw new Error("oversize_unreadable:body_exceeds_limit");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
};

const createPublicDispatcher = (lookupImpl) =>
  new Agent({ connect: { lookup: createPublicLookup(lookupImpl) } });

const boundedFetch = async (url, fetchImpl = globalThis.fetch, policy = {}) => {
  const timeoutMs = policy.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maximumBytes = policy.maximumBytes ?? MAX_BYTES;
  const originLimiter = policy.originLimiter;
  const globalTransferLimiter = policy.globalTransferLimiter;
  const dispatcher = policy.dispatcher || createPublicDispatcher();
  const ownsDispatcher = !policy.dispatcher;
  let current = url;
  const redirects = [];
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      assertFetchablePublicUrl(current);
      const transfer = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("evidence_fetch_timeout")), timeoutMs);
        try {
          const response = await fetchImpl(current, {
            method: "GET",
            redirect: "manual",
            dispatcher,
            signal: controller.signal,
            headers: EVIDENCE_REQUEST_HEADERS
          });
          if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
            await response.body?.cancel("redirect_not_retained");
            return { response, body: null };
          }
          const declared = Number(response.headers.get("content-length") || 0);
          if (declared > maximumBytes) {
            await response.body?.cancel("declared_body_exceeds_limit");
            throw new Error("oversize_unreadable:declared_body_exceeds_limit");
          }
          return { response, body: await readBoundedResponseBody(response, maximumBytes) };
        } finally {
          clearTimeout(timer);
        }
      };
      // Acquire the origin gate before the global transfer gate. A task waiting
      // for a same-origin cooldown therefore consumes no scarce global slot and
      // cannot starve unrelated origins.
      const globallyBoundTransfer = () => globalTransferLimiter
        ? globalTransferLimiter.run(transfer)
        : transfer();
      const { response, body } = originLimiter
        ? await originLimiter.run(current, globallyBoundTransfer)
        : await globallyBoundTransfer();
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (redirect === MAX_REDIRECTS) throw new Error("evidence_redirect_limit");
        const nextUrl = new URL(response.headers.get("location"), current).toString();
        assertFetchablePublicUrl(nextUrl);
        redirects.push({ status: response.status, from: current, to: nextUrl });
        current = nextUrl;
        continue;
      }
      return { response, body, finalUrl: current, redirects };
    }
    throw new Error("evidence_redirect_limit");
  } finally {
    if (ownsDispatcher) await dispatcher.close();
  }
};

const fetchWithRetries = async (url, fetchImpl = globalThis.fetch, policy = {}) => {
  let lastError;
  const retryDelaysMs = [];
  const delayImpl = policy.delayImpl || delay;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const result = await boundedFetch(url, fetchImpl, policy);
      if ((result.response.status === 429 || result.response.status >= 500) && attempt < FETCH_ATTEMPTS) {
        const declaredRetryAfterMs = result.response.status === 429
          ? parseRetryAfterMs(result.response.headers.get("retry-after"), policy.clockMs?.() ?? Date.now())
          : null;
        if (Number.isFinite(policy.retryAfterBudgetMs) && declaredRetryAfterMs != null
          && declaredRetryAfterMs > policy.retryAfterBudgetMs) {
          return { ...result, attempts: attempt, retryDelaysMs,
            retryTerminatedReason: "retry_after_exceeds_campaign_budget",
            declaredRetryAfterMs, retryAfterBudgetMs: policy.retryAfterBudgetMs };
        }
        const waitMs = retryDelayMs({
          response: result.response,
          attempt,
          baseDelayMs: policy.baseRetryDelayMs,
          maximumRetryAfterMs: policy.maximumRetryAfterMs,
          clockMs: policy.clockMs?.() ?? Date.now()
        });
        retryDelaysMs.push(waitMs);
        if (result.response.status === 429 && policy.originLimiter
          && policy.propagateRetryAfterToOrigin !== false) {
          policy.originLimiter.defer(result.finalUrl || url, waitMs);
        }
        await delayImpl(waitMs);
        continue;
      }
      return { ...result, attempts: attempt, retryDelaysMs };
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        const waitMs = (policy.baseRetryDelayMs ?? RETRY_BASE_DELAY_MS) * attempt;
        retryDelaysMs.push(waitMs);
        await delayImpl(waitMs);
      }
    }
  }
  throw lastError || new Error("evidence_fetch_failed");
};

const writeContentAddressed = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = fs.readFileSync(file);
  if (!existing.equals(bytes)) throw new Error(`Content-addressed artifact collision: ${file}`);
};

const descriptor = (base, file) => {
  const bytes = fs.readFileSync(file);
  return { path: path.relative(base, file), sha256: sha256(bytes), byteLength: bytes.length, complete: true };
};

const normalizedTextFor = async ({ body, contentType, url, pool }) => {
  if (typeof FULL_SOURCE.normalizeSourceBody !== "function") {
    throw new Error("Bound evaluator normalizer must export normalizeSourceBody.");
  }
  // One authoritative classifier/normalizer owns every MIME type. Do not
  // duplicate MIME sniffing here: that previously allowed the collector and
  // offline normalizer to produce divergent evidence from identical bytes.
  // The worker entry point calls that same normalizeSourceBody function and
  // preserves parallelism without moving classification back into the host.
  if (pool) {
    if (typeof pool.normalize !== "function") throw new Error("Bound evaluator normalizer worker pool must export normalize().");
    return pool.normalize({ body, contentType, url });
  }
  return FULL_SOURCE.normalizeSourceBody({ body, contentType, url });
};

const fetchSourceResult = async ({ requestedUrl, productionRoot, pool, fetchImpl, transportPolicy, originLimiter, globalTransferLimiter }) => {
  const startedAt = now();
  const start = monotonicMs();
  try {
    const fetched = await fetchWithRetries(requestedUrl, fetchImpl, {
      ...transportPolicy, originLimiter, globalTransferLimiter
    });
    const contentType = fetched.response.headers.get("content-type") || "application/octet-stream";
    const artifactRoot = path.join(productionRoot, "source-artifacts");
    const rawSha = sha256(fetched.body);
    const rawFile = path.join(artifactRoot, `${rawSha}.body`);
    writeContentAddressed(rawFile, fetched.body);
    let semantic = null;
    let normalizationError = null;
    try {
      semantic = await normalizedTextFor({ body: fetched.body, contentType, url: fetched.finalUrl, pool });
      if (!semantic || semantic.sourceBodySha256 !== rawSha) {
        throw new Error("normalizer_source_body_hash_mismatch");
      }
    } catch (error) {
      normalizationError = String(error?.message || error).slice(0, 1200);
    }
    let textFile = null;
    if (semantic?.evidenceText) {
      const textBytes = Buffer.from(semantic.evidenceText, "utf8");
      textFile = path.join(artifactRoot, `${sha256(textBytes)}.txt`);
      writeContentAddressed(textFile, textBytes);
    }
    const { evidenceText: _notDuplicatedInJson, ...semanticAudit } = semantic || {};
    const binaryUnavailable = semantic?.evidenceUnavailable === true
      && semantic?.extractionMode === "metadata_only_binary_unavailable";
    return {
      finalUrl: fetched.finalUrl,
      redirects: fetched.redirects,
      httpStatus: fetched.response.status,
      tlsVerification: transportPolicy.verification,
      durationMs: monotonicMs() - start,
      startedAt,
      completedAt: now(),
      bytesObserved: fetched.body.length,
      bytesRetained: fetched.body.length,
      exceededMaximumBytes: false,
      headers: { contentType, contentEncoding: fetched.response.headers.get("content-encoding"), requestedAcceptEncoding: "identity", etag: fetched.response.headers.get("etag"), lastModified: fetched.response.headers.get("last-modified"), contentLength: fetched.response.headers.get("content-length") },
      dateEvidence: [],
      // Persist the normalizer's complete audit result except the potentially
      // large evidenceText, which is retained content-addressably below.
      semanticExtraction: semantic ? semanticAudit : null,
      fetchPolicyVersion: "exact-url-browser-paced-v1",
      extractorVersion: EXTRACTOR_VERSION,
      outcome: normalizationError ? "normalization_error"
        : binaryUnavailable ? "binary_unavailable"
          : fetched.response.status >= 200 && fetched.response.status < 300 ? "read" : "http_error",
      retentionClass: binaryUnavailable ? "metadata_only_binary_unavailable" : "arm_owned_public_evidence",
      rawBodyArtifact: descriptor(productionRoot, rawFile),
      normalizedTextArtifact: textFile ? descriptor(productionRoot, textFile) : null,
      fetchAttempts: fetched.attempts,
      retryDelaysMs: fetched.retryDelaysMs,
      retryTerminatedReason: fetched.retryTerminatedReason || null,
      declaredRetryAfterMs: fetched.declaredRetryAfterMs ?? null,
      retryAfterBudgetMs: fetched.retryAfterBudgetMs ?? null,
      error: normalizationError
    };
  } catch (error) {
    return {
      finalUrl: null,
      redirects: [],
      httpStatus: null,
      tlsVerification: "not_completed",
      durationMs: monotonicMs() - start,
      startedAt,
      completedAt: now(),
      bytesObserved: 0,
      bytesRetained: 0,
      exceededMaximumBytes: /oversize_unreadable/.test(String(error?.message || error)),
      headers: {},
      dateEvidence: [],
      semanticExtraction: null,
      fetchPolicyVersion: "exact-url-browser-paced-v1",
      extractorVersion: EXTRACTOR_VERSION,
      outcome: /oversize_unreadable/.test(String(error?.message || error)) ? "oversize_unreadable" : "fetch_error",
      retentionClass: "metadata_only_unavailable",
      rawBodyArtifact: null,
      normalizedTextArtifact: null,
      fetchAttempts: FETCH_ATTEMPTS,
      error: String(error?.message || error).slice(0, 1200)
    };
  }
};

const cloneSharedFetchResult = (result) => ({
  ...result,
  redirects: (result.redirects || []).map((redirect) => ({ ...redirect })),
  headers: { ...(result.headers || {}) },
  dateEvidence: (result.dateEvidence || []).map((item) => ({ ...item })),
  semanticExtraction: result.semanticExtraction ? { ...result.semanticExtraction } : null,
  rawBodyArtifact: result.rawBodyArtifact ? { ...result.rawBodyArtifact } : null,
  normalizedTextArtifact: result.normalizedTextArtifact ? { ...result.normalizedTextArtifact } : null,
  retryDelaysMs: result.retryDelaysMs ? [...result.retryDelaysMs] : result.retryDelaysMs
});

const fetchSource = async ({ source, productionRoot, pool, fetchImpl, transportPolicy = configuredTransportPolicy(), originLimiter, globalTransferLimiter, fetchCache = null }) => {
  const operation = () => fetchSourceResult({
    requestedUrl: source.requestedUrl,
    productionRoot,
    pool,
    fetchImpl,
    transportPolicy,
    originLimiter,
    globalTransferLimiter
  });
  const shared = fetchCache
    ? await fetchCache.run(source.requestedUrl, operation)
    : await operation();
  return {
    ...source,
    ...cloneSharedFetchResult(shared),
    fetchSharing: {
      mode: fetchCache ? "global_in_run_exact_request_url" : "not_shared",
      requestUrlSha256: sha256(source.requestedUrl),
      timingSemantics: "underlying_fetch_and_normalization_once_repeated_on_each_logical_source_row"
    }
  };
};

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, jsonBytes(value), { flag: "wx", mode: 0o600 });
};

const fileDescriptor = (base, file) => {
  const bytes = fs.readFileSync(file);
  return { path: path.relative(base, file), sha256: sha256(bytes), byteLength: bytes.length };
};

const verifyDescriptor = (base, item, label) => {
  const resolvedBase = path.resolve(base);
  const file = path.resolve(resolvedBase, item?.path || "");
  if (!file.startsWith(`${resolvedBase}${path.sep}`) || !fs.existsSync(file)) throw new Error(`${label} path is missing or escapes its root.`);
  const value = fs.readFileSync(file);
  if (value.length !== item.byteLength || sha256(value) !== item.sha256) throw new Error(`${label} descriptor mismatch.`);
  return file;
};

const verifyProductionSeal = ({ productionRoot, preregistration }) => {
  const sealPath = path.join(productionRoot, "production-input-seal.json");
  if (!fs.existsSync(sealPath)) throw new Error("Immutable production-input-seal.json is required before evidence collection.");
  const seal = readJson(sealPath);
  const runConfig = SUPPORTED_RUNS[preregistration.protocol];
  const expectedMode = runConfig?.sealMode || (runConfig?.expectedRows === 39 ? "pilot" : "full");
  const preregistrationPath = path.join(productionRoot, "preregistration.json");
  if (seal.schemaVersion !== 1 || seal.status !== "sealed_before_evidence_collection"
    || seal.protocol !== preregistration.protocol || seal.mode !== expectedMode
    || seal.expectedRuns !== runConfig?.expectedRows || seal.productionHostFetchCount !== 0
    || seal.preregistrationSha256 !== sha256(fs.readFileSync(preregistrationPath))) {
    throw new Error("Production seal does not match the frozen production run.");
  }
  for (const name of ["production-summary.json", "production-results.json", "production-results.tsv"]) {
    const artifact = seal.productionAggregateArtifacts?.[name];
    const file = path.join(productionRoot, name);
    if (!artifact || artifact.path !== name || !fs.existsSync(file)) throw new Error(`Production seal is missing ${name}.`);
    const value = fs.readFileSync(file);
    if (artifact.byteLength !== value.length || artifact.sha256 !== sha256(value)) throw new Error(`Sealed production artifact changed: ${name}.`);
  }
  if (seal.phase1ManifestGraphRows !== runConfig.expectedRows || !/^[a-f0-9]{64}$/.test(seal.phase1ManifestGraphSha256 || "")) {
    throw new Error("Production seal has an incomplete phase-1 manifest graph.");
  }
  const graph = [];
  for (const scheduled of preregistration.schedule) {
    const attemptDir = path.join(productionRoot, "phase1", scheduled.armId, scheduled.caseId, "attempts", "attempt-0001");
    const manifestPath = path.join(attemptDir, "manifest.json");
    const manifest = readJson(manifestPath);
    for (const artifact of manifest.artifacts || []) verifyDescriptor(attemptDir, artifact, `phase-1 ${scheduled.armId}/${scheduled.caseId}`);
    const outcome = readJson(path.join(attemptDir, "outcome.json"));
    if (manifest.protocol !== preregistration.protocol || manifest.bindings?.preregistrationSha256 !== seal.preregistrationSha256
      || manifest.bindings?.armId !== scheduled.armId || manifest.bindings?.caseId !== scheduled.caseId
      || outcome.phase !== 1 || outcome.armId !== scheduled.armId || outcome.caseId !== scheduled.caseId) {
      throw new Error(`Sealed phase-1 binding mismatch for ${scheduled.armId}/${scheduled.caseId}.`);
    }
    graph.push({ armId: scheduled.armId, caseId: scheduled.caseId, manifest: fileDescriptor(productionRoot, manifestPath), outcome: outcome.outcome });
  }
  if (graph.length !== seal.phase1ManifestGraphRows || sha256(stableJson(graph)) !== seal.phase1ManifestGraphSha256
    || stableJson(graph) !== stableJson(seal.phase1ManifestGraph)) {
    throw new Error("Phase-1 manifest/artifact graph differs from the immutable production seal.");
  }
  return { seal, sealPath, sha256: sha256(fs.readFileSync(sealPath)) };
};

const loadPhase1 = (productionRoot, scheduled) => {
  const dir = path.join(productionRoot, "phase1", scheduled.armId, scheduled.caseId, "attempts", "attempt-0001");
  const manifestPath = path.join(dir, "manifest.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  return {
    dir,
    manifest: JSON.parse(manifestBytes),
    manifestSha256: sha256(manifestBytes),
    outcome: readJson(path.join(dir, "outcome.json")),
    trace: readJson(path.join(dir, "trace.json")),
    parsed: fs.existsSync(path.join(dir, "parsed.json")) ? readJson(path.join(dir, "parsed.json")) : { profiles: [] }
  };
};

const phase2Bindings = ({ preregistration, scheduled, phase1, launchProvenance = null }) => ({
  runnerSha256: preregistration.runnerSha256,
  preregistrationSha256: sha256(fs.readFileSync(path.join(preregistration.productionRoot, "preregistration.json"))),
  azureRuntimeConfigSha256: preregistration.azureRuntimeConfigSha256,
  postprocessConfigSha256: preregistration.postprocessConfigSha256,
  productionInputSealSha256: preregistration.productionInputSealSha256,
  armId: scheduled.armId,
  armCommit: preregistration.arms[scheduled.armId].commit,
  caseId: scheduled.caseId,
  phase1ManifestSha256: phase1.manifestSha256,
  ...(launchProvenance || {})
});

const collectCell = async ({ productionRoot, preregistration, scheduled, pool, fetchImpl = globalThis.fetch, transportPolicy = configuredTransportPolicy(), originLimiter, globalTransferLimiter, fetchCache = null, launchProvenance = null }) => {
  const protocol = preregistration.protocol;
  const phase1 = loadPhase1(productionRoot, scheduled);
  const attemptDir = path.join(productionRoot, "phase2", scheduled.armId, scheduled.caseId, "attempts", "attempt-0001");
  if (fs.existsSync(path.join(attemptDir, "manifest.json"))) return readJson(path.join(attemptDir, "outcome.json"));
  const bindings = phase2Bindings({ preregistration, scheduled, phase1, launchProvenance });
  const startedAt = now();
  const wallStart = monotonicMs();
  fs.mkdirSync(attemptDir, { recursive: true });
  const phase2Evaluator = { recoveryMode: "parallel_deterministic_exact_url_cache", collectorVersion: COLLECTOR_VERSION, evidencePipelineSha256: sha256(fs.readFileSync(__filename)), normalizerModuleSha256: NORMALIZER_MODULE_SHA256, sourceFetchConcurrencyPerCell: SOURCE_CONCURRENCY_PER_CELL, globalTransferConcurrency: GLOBAL_TRANSFER_CONCURRENCY, originConcurrency: ORIGIN_CONCURRENCY, originMinimumStartIntervalMs: ORIGIN_MINIMUM_START_INTERVAL_MS, cellConcurrency: CELL_CONCURRENCY, schedulerPolicy: "origin_gate_before_global_transfer_gate_all_cells_admitted", globalFetchCacheKey: "literal_requested_url", requestHeaders: EVIDENCE_REQUEST_HEADERS, requestAcceptEncoding: "identity", semanticExtractionConcurrency: NORMALIZATION_CONCURRENCY, semanticExtractionTimeoutMs: NORMALIZATION_TIMEOUT_MS, extractorVersion: EXTRACTOR_VERSION, transportVerification: transportPolicy.verification, ...(launchProvenance || {}) };
  if (phase1.outcome.outcome !== "parsed_success") {
    const outcome = { schemaVersion: 2, protocol, phase: 2, outcome: "skipped_phase1_error", scheduled, armId: scheduled.armId, armCommit: bindings.armCommit, caseId: scheduled.caseId, startedAt, completedAt: now(), bindings, phase1Outcome: phase1.outcome.outcome, phase2Evaluator, timings: { phaseWallMs: monotonicMs() - wallStart }, error: null };
    writeJsonExclusive(path.join(attemptDir, "outcome.json"), outcome);
    const artifacts = [fileDescriptor(attemptDir, path.join(attemptDir, "outcome.json"))];
    writeJsonExclusive(path.join(attemptDir, "manifest.json"), { schemaVersion: 2, protocol, createdAt: now(), bindings, artifacts });
    return outcome;
  }
  const rawProfiles = phase1.parsed.rawStructuredProfiles || phase1.parsed.preSanitizerProfiles || phase1.parsed.profiles || [];
  const finalProfiles = phase1.parsed.finalProfiles || phase1.parsed.profiles || [];
  const sources = enumerateArmSources({ trace: phase1.trace, rawProfiles, finalProfiles });
  const fetchStart = monotonicMs();
  const fetched = await runPool(sources, SOURCE_CONCURRENCY_PER_CELL, (source) => fetchSource({ source, productionRoot, pool, fetchImpl, transportPolicy, originLimiter, globalTransferLimiter, fetchCache }));
  fetched.sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
  const sourceFetchWallMs = monotonicMs() - fetchStart;
  const sourceFetches = { schemaVersion: 2, protocol, policy: { armSourcePolicy: "arm_specific_no_union", nativeProvenance: "action_sources_url_citation_open_page_or_structured_fact", fetchAttempts: FETCH_ATTEMPTS, globalTransferConcurrency: GLOBAL_TRANSFER_CONCURRENCY, originConcurrency: ORIGIN_CONCURRENCY, originMinimumStartIntervalMs: ORIGIN_MINIMUM_START_INTERVAL_MS, retryBaseDelayMs: RETRY_BASE_DELAY_MS, maximumRetryAfterMs: MAX_RETRY_AFTER_MS, retryAfterPolicy: "honor_complete_delta_seconds_or_http_date_up_to_twenty_minutes", schedulerPolicy: "origin_gate_before_global_transfer_gate_all_cells_admitted", requestHeaders: EVIDENCE_REQUEST_HEADERS, maximumBytes: MAX_BYTES, maximumRedirects: MAX_REDIRECTS, timeoutMs: FETCH_TIMEOUT_MS, undatedEvidencePolicy: "eligible_not_stale" }, phase2Evaluator, sources: fetched };
  const postprocessed = { schemaVersion: 2, protocol, armId: scheduled.armId, caseId: scheduled.caseId, phase2Evaluator, rawStructuredProfiles: rawProfiles, baselineProfiles: finalProfiles, finalProfiles, sanitizerDecisions: phase1.parsed.sanitizerDecisions || [], stackDecisions: phase1.parsed.stackDecisions || [], recencyEvidence: [], recencyDecisions: [] };
  writeJsonExclusive(path.join(attemptDir, "source-fetches.json"), sourceFetches);
  writeJsonExclusive(path.join(attemptDir, "postprocessed.json"), postprocessed);
  const outcome = { schemaVersion: 2, protocol, phase: 2, outcome: "postprocess_success", scheduled, armId: scheduled.armId, armName: preregistration.arms[scheduled.armId].name, armCommit: bindings.armCommit, caseId: scheduled.caseId, startedAt, completedAt: now(), bindings, profileOutcome: finalProfiles.length ? "profile" : "no_profile", parsedProfileCount: (phase1.parsed.profiles || []).length, sanitizedProfileCount: finalProfiles.length, finalProfileCount: finalProfiles.length, sourceFetchCount: fetched.length, sourceFetchReadCount: fetched.filter((x) => x.outcome === "read").length, sourceFetchQuarantineCount: 0, timings: { sanitizerMs: 0, sourceFetchWallMs, sourceFetchAttemptMsSum: fetched.reduce((sum, x) => sum + x.durationMs, 0), recencyMs: 0, phaseWallMs: monotonicMs() - wallStart, phase1ActiveWallMs: phase1.outcome.timings?.phaseWallMs || 0, activeCaseWallMs: (phase1.outcome.timings?.phaseWallMs || 0) + monotonicMs() - wallStart }, usageAndCost: phase1.outcome.usageAndCost || null, rawResponseSha256: phase1.outcome.rawResponseSha256 || null, phase2Evaluator, error: null };
  writeJsonExclusive(path.join(attemptDir, "outcome.json"), outcome);
  const artifacts = ["source-fetches.json", "postprocessed.json", "outcome.json"].map((name) => fileDescriptor(attemptDir, path.join(attemptDir, name)));
  writeJsonExclusive(path.join(attemptDir, "manifest.json"), { schemaVersion: 2, protocol, createdAt: now(), bindings, artifacts });
  return outcome;
};

const main = async () => {
  const productionRoot = path.resolve(process.env.PROVIDER_EVALUATOR_INPUT_ROOT || "");
  if (!productionRoot || !fs.existsSync(path.join(productionRoot, "preregistration.json"))) {
    throw new Error("Set PROVIDER_EVALUATOR_INPUT_ROOT to a sealed production root.");
  }
  const launchProvenance = null;
  const preregistration = readJson(path.join(productionRoot, "preregistration.json"));
  preregistration.productionRoot = productionRoot;
  const runConfig = SUPPORTED_RUNS[preregistration.protocol];
  if (preregistration.schemaVersion !== 2 || !runConfig || preregistration.runMode !== runConfig.runMode) throw new Error("Unsupported production preregistration.");
  if (!Array.isArray(preregistration.schedule) || preregistration.schedule.length !== runConfig.expectedRows) throw new Error(`Schedule must contain ${runConfig.expectedRows} arm/case rows.`);
  const productionSeal = verifyProductionSeal({ productionRoot, preregistration });
  preregistration.productionInputSealSha256 = productionSeal.sha256;
  const preflightPath = path.join(productionRoot, "evidence-transport-preflight.json");
  let transportPolicy;
  if (fs.existsSync(preflightPath)) {
    transportPolicy = readJson(preflightPath);
    if (transportPolicy.verification !== configuredTransportPolicy().verification) throw new Error("Evidence transport policy changed during a resumable run.");
  } else {
    transportPolicy = await preflightTlsTransport();
    writeJsonExclusive(preflightPath, transportPolicy);
  }
  const pool = new FULL_SOURCE.SemanticMarkdownWorkerPool({ size: NORMALIZATION_CONCURRENCY, timeoutMs: NORMALIZATION_TIMEOUT_MS });
  const originLimiter = new OriginConcurrencyLimiter(ORIGIN_CONCURRENCY);
  const globalTransferLimiter = new ConcurrencyLimiter(GLOBAL_TRANSFER_CONCURRENCY);
  const fetchCache = new ExactRequestUrlFetchCache();
  try {
    const outcomes = await runPool(preregistration.schedule, CELL_CONCURRENCY, (scheduled) => collectCell({ productionRoot, preregistration, scheduled, pool, transportPolicy, originLimiter, globalTransferLimiter, fetchCache, launchProvenance }));
    const counts = Object.fromEntries([...new Set(outcomes.map((x) => x.outcome))].sort().map((key) => [key, outcomes.filter((x) => x.outcome === key).length]));
    process.stdout.write(`${JSON.stringify({ protocol: preregistration.protocol, cells: outcomes.length, counts }, null, 2)}\n`);
  } finally {
    await pool.close();
  }
};

module.exports = {
  COLLECTOR_VERSION,
  EVIDENCE_REQUEST_HEADERS,
  NORMALIZER_MODULE_PATH,
  NORMALIZER_MODULE_SHA256,
  SUPPORTED_RUNS,
  CELL_CONCURRENCY,
  SOURCE_CONCURRENCY_PER_CELL,
  GLOBAL_TRANSFER_CONCURRENCY,
  NORMALIZATION_CONCURRENCY,
  NORMALIZATION_TIMEOUT_MS,
  FETCH_ATTEMPTS,
  FETCH_TIMEOUT_MS,
  ORIGIN_CONCURRENCY,
  ORIGIN_MINIMUM_START_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  MAX_RETRY_AFTER_MS,
  MAX_REDIRECTS,
  MAX_BYTES,
  configuredTransportPolicy,
  preflightTlsTransport,
  canonicalUrl,
  enumerateArmSources,
  OriginConcurrencyLimiter,
  ConcurrencyLimiter,
  ExactRequestUrlFetchCache,
  parseRetryAfterMs,
  retryDelayMs,
  runPool,
  readBoundedResponseBody,
  createPublicDispatcher,
  boundedFetch,
  fetchWithRetries,
  normalizedTextFor,
  writeContentAddressed,
  fetchSource,
  verifyProductionSeal,
  collectCell
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getGlobalDispatcher } = require("undici");
const collector = require("../core/collect_evidence.js");
const fetchWorker = require("../core/evidence_collector.js");

assert.equal(collector.cellAdmissionConcurrency(60), 60);
assert.equal(collector.cellAdmissionConcurrency(1), 1);
assert.equal(collector.cellAdmissionConcurrency(0), 1);
assert.throws(() => collector.cellAdmissionConcurrency(-1), /nonnegative integer/);
const policy = collector.schedulingPolicy(60);
assert.equal(policy.cellAdmissionConcurrency, 60);
assert.equal(policy.sourceConcurrencyPerCell, null);
assert.equal(policy.sourceAdmissionPolicy, "all_arm_sources_admitted_without_per_cell_retry_wait_slots");
assert.equal(policy.globalTransferConcurrency, 32);
assert.equal(policy.originConcurrency, 4);
assert.equal(policy.requestTimeoutMs, 15_000);
assert.equal(policy.maximumTotalAttempts, 3);
assert.equal(policy.crossCampaignOriginAndGlobalLimitersShared, false);
assert.equal(collector.schedulingPolicy(60, true).crossCampaignOriginAndGlobalLimitersShared, true);
assert.equal(collector.schedulingPolicy(60, true).crossCampaignFetchCacheShared, false);
assert.equal(collector.schedulingPolicy(60, true, true).crossCampaignFetchCacheShared, true);
assert.equal(policy.evidenceSemanticsChanged, false);
assert.equal(policy.retryAfterBudgetMs, 60_000);
assert.equal(policy.retryAfterAboveBudgetDisposition, "terminal_http_outcome_for_exact_url");
assert.equal(policy.propagateRetryAfterToOrigin, false);
assert.deepEqual(collector.configuredV4TransportPolicy(), {
  ...fetchWorker.configuredTransportPolicy(), retryAfterBudgetMs: 60_000,
  propagateRetryAfterToOrigin: false
});
assert.match(policy.policy, /all_cells_and_sources_admitted/);

let sharedRootScans = 0;
const sharedProductionRoot = path.join(os.tmpdir(), "shared-production-root-not-read");
const sharedCampaigns = [{ name: "arm-a", armId: "A", input: sharedProductionRoot },
  { name: "arm-b", armId: "B", input: sharedProductionRoot }];
const sharedPrepared = collector.discoverCampaignCells(sharedCampaigns, () => {
  sharedRootScans += 1;
  return [{ armId: "A", caseId: "P001", requestSha256: "a", sources: [] },
    { armId: "B", caseId: "P001", requestSha256: "a", sources: [] }];
});
assert.equal(sharedRootScans, 1, "one shared production root must be scanned exactly once");
assert.deepEqual(sharedPrepared.map((row) => row.cells.map((cell) => cell.armId)), [["A"], ["B"]],
  "fallback discovery must preserve each manifest armId");
assert.equal(collector.assertSameBattery(sharedCampaigns, sharedPrepared), true);

const pending = [];
const started = [];
const cells = [
  { caseId: "P001", sources: [{ id: "a" }, { id: "b" }] },
  { caseId: "P002", sources: [{ id: "c" }, { id: "d" }] }
];
const all = collector.admitAllCellSources(cells, (cell, source) => {
  started.push(`${cell.caseId}/${source.id}`);
  return new Promise((resolve) => pending.push(() => resolve(source.id)));
});
assert.deepEqual(started, ["P001/a", "P001/b", "P002/c", "P002/d"],
  "every source must be admitted before any Retry-After-like promise resolves");
pending.forEach((resolve) => resolve());
all.then(async (rows) => {
  assert.deepEqual(rows, [["a", "b"], ["c", "d"]]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "provider-evidence-binding-"));
  const sharedRoot = path.join(temporary, "shared");
  const armRoot = path.join(temporary, "arm");
  const body = Buffer.from("exact shared snapshot", "utf8");
  const relative = "source-artifacts/body.txt";
  fs.mkdirSync(path.dirname(path.join(sharedRoot, relative)), { recursive: true });
  fs.writeFileSync(path.join(sharedRoot, relative), body);
  const descriptor = { path: relative,
    sha256: crypto.createHash("sha256").update(body).digest("hex"), byteLength: body.length, complete: true };
  const result = collector.bindSharedArtifactsToCampaign({ rawBodyArtifact: descriptor,
    normalizedTextArtifact: descriptor }, sharedRoot, armRoot);
  assert.equal(result.rawBodyArtifact.sha256, descriptor.sha256);
  assert.deepEqual(fs.readFileSync(path.join(armRoot, relative)), body);
  fs.rmSync(temporary, { recursive: true, force: true });

  let calls = 0;
  const longThrottle = await fetchWorker.fetchWithRetries("https://npiprofile.com/npi/1234567890",
    async () => {
      calls += 1;
      return new Response("rate limited", { status: 429, headers: { "retry-after": "1779" } });
    }, { ...collector.configuredV4TransportPolicy(),
      originLimiter: new fetchWorker.OriginConcurrencyLimiter(2, 0) });
  assert.equal(calls, 1, "a Retry-After beyond the campaign budget must not enter a multi-hour retry queue");
  assert.equal(longThrottle.response.status, 429);
  assert.equal(longThrottle.attempts, 1);
  assert.equal(longThrottle.retryTerminatedReason, "retry_after_exceeds_campaign_budget");
  assert.equal(longThrottle.declaredRetryAfterMs, 1_779_000);
  assert.equal(longThrottle.retryAfterBudgetMs, 60_000);

  let directPrivateCalls = 0;
  await assert.rejects(fetchWorker.boundedFetch("http://127.0.0.1/private", async () => {
    directPrivateCalls += 1;
    return new Response("must not be fetched");
  }), /Non-public evidence URL/);
  assert.equal(directPrivateCalls, 0, "the initial URL must be rejected before invoking transport");

  let redirectCalls = 0;
  await assert.rejects(fetchWorker.boundedFetch("https://example.com/start", async () => {
    redirectCalls += 1;
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/metadata" } });
  }), /Non-public evidence URL/);
  assert.equal(redirectCalls, 1, "a private redirect must be rejected before its transport call");

  const mixedDispatcher = fetchWorker.createPublicDispatcher((_hostname, _options, callback) =>
    callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]));
  try {
    await assert.rejects(
      fetchWorker.boundedFetch("http://mixed.example/", globalThis.fetch,
        { dispatcher: mixedDispatcher, timeoutMs: 1_000 }),
      (error) => error?.cause?.code === "ERR_EVIDENCE_NON_PUBLIC_DNS"
    );
  } finally {
    await mixedDispatcher.close();
  }

  const globalDispatcher = getGlobalDispatcher();
  const redirectDispatchers = [];
  let publicRedirectCalls = 0;
  const publicRedirect = await fetchWorker.boundedFetch("https://example.com/start", async (_url, options) => {
    publicRedirectCalls += 1;
    redirectDispatchers.push(options.dispatcher);
    return publicRedirectCalls === 1
      ? new Response(null, { status: 302, headers: { location: "https://www.cms.gov/provider" } })
      : new Response("public evidence", { status: 200 });
  });
  assert.equal(publicRedirect.finalUrl, "https://www.cms.gov/provider");
  assert.equal(redirectDispatchers.length, 2);
  assert.equal(redirectDispatchers[0], redirectDispatchers[1],
    "every redirect hop must use the same DNS-validating request dispatcher");
  assert.equal(redirectDispatchers[0].closed, true, "the request-scoped dispatcher must be closed after capture");
  assert.equal(getGlobalDispatcher(), globalDispatcher, "evidence fetches must not mutate Undici's global dispatcher");
  process.stdout.write("format-aware collector scheduling tests passed\n");
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

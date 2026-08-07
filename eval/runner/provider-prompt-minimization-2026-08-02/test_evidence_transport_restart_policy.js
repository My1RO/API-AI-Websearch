#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const collectorFile = path.resolve(root,
  "../provider-d-series-2026-07-31/generated/collect_d_evidence_v7.js");
const collector = require(collectorFile);
const compiler = require(path.join(root, "compile_corrected_campaign.js"));
const fixture = JSON.parse(fs.readFileSync(path.join(root,
  "fixtures/evidence_transport_restart_policy.json"), "utf8"));

const declaredInteger = (name) => {
  const source = fs.readFileSync(collectorFile, "utf8");
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)\\s*;`));
  assert.ok(match, `${name} must be an integer constant in the collector`);
  return Number(match[1].replaceAll("_", ""));
};

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const restoreEnvironment = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

(async () => {
  const expected = fixture.policy;
  assert.equal(collector.GLOBAL_TRANSFER_CONCURRENCY, expected.globalConcurrency);
  assert.equal(collector.ORIGIN_CONCURRENCY, expected.perOriginConcurrency);
  assert.equal(collector.FETCH_TIMEOUT_MS ?? declaredInteger("FETCH_TIMEOUT_MS"),
    expected.requestTimeoutMs);
  assert.equal(collector.FETCH_ATTEMPTS, expected.totalAttempts);
  assert.equal(collector.MAX_REDIRECTS, expected.maximumRedirects);
  assert.equal(collector.MAX_BYTES, expected.maximumBytes);

  // The global limiter must reach, but never exceed, the configured bound.
  const globalLimiter = new collector.ConcurrencyLimiter(expected.globalConcurrency);
  const globalGate = deferred();
  let globalActive = 0;
  let globalMaximum = 0;
  const globalTasks = Array.from({ length: expected.globalConcurrency * 2 }, () =>
    globalLimiter.run(async () => {
      globalActive += 1;
      globalMaximum = Math.max(globalMaximum, globalActive);
      await globalGate.promise;
      globalActive -= 1;
    }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(globalMaximum, expected.globalConcurrency);
  globalGate.resolve();
  await Promise.all(globalTasks);

  // A single origin must reach, but never exceed, its independent bound.
  const originLimiter = new collector.OriginConcurrencyLimiter(
    expected.perOriginConcurrency, 0);
  const originGate = deferred();
  let originActive = 0;
  let originMaximum = 0;
  const originTasks = Array.from({ length: expected.perOriginConcurrency * 3 }, (_, index) =>
    originLimiter.run(`https://same-origin.example/${index}`, async () => {
      originActive += 1;
      originMaximum = Math.max(originMaximum, originActive);
      await originGate.promise;
      originActive -= 1;
    }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(originMaximum, expected.perOriginConcurrency);
  originGate.resolve();
  await Promise.all(originTasks);

  // Both retryable HTTP responses and thrown transport failures receive
  // exactly three total attempts, not three retries after an initial call.
  let statusCalls = 0;
  const exhaustedStatus = await collector.fetchWithRetries(
    "https://retry.example/status",
    async () => {
      statusCalls += 1;
      return new Response("temporary", { status: 503 });
    },
    { delayImpl: async () => {}, baseRetryDelayMs: 0 }
  );
  assert.equal(statusCalls, expected.totalAttempts);
  assert.equal(exhaustedStatus.attempts, expected.totalAttempts);
  assert.equal(exhaustedStatus.response.status, 503);

  let errorCalls = 0;
  await assert.rejects(collector.fetchWithRetries(
    "https://retry.example/error",
    async () => {
      errorCalls += 1;
      throw new Error("fixture_transport_failure");
    },
    { delayImpl: async () => {}, baseRetryDelayMs: 0 }
  ), /fixture_transport_failure/);
  assert.equal(errorCalls, expected.totalAttempts);

  // Use an injected short deadline to test abort behavior without waiting for
  // the production 15-second default.
  let observedAbort = false;
  await assert.rejects(collector.boundedFetch(
    "https://timeout.example/source",
    async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(options.signal.reason || new Error("aborted"));
      }, { once: true });
    }),
    { timeoutMs: 5 }
  ), /evidence_fetch_timeout|aborted/);
  assert.equal(observedAbort, true);

  // Five redirects remain allowed. A sixth redirect is rejected.
  let allowedRedirectCalls = 0;
  const allowedRedirects = await collector.boundedFetch(
    "https://redirect.example/0",
    async () => {
      const call = allowedRedirectCalls++;
      return call < expected.maximumRedirects
        ? new Response(null, { status: 302, headers: { location: `/next-${call}` } })
        : new Response("ok", { status: 200 });
    }
  );
  assert.equal(allowedRedirects.redirects.length, expected.maximumRedirects);
  assert.equal(allowedRedirectCalls, expected.maximumRedirects + 1);

  let rejectedRedirectCalls = 0;
  await assert.rejects(collector.boundedFetch(
    "https://redirect.example/limit",
    async () => {
      rejectedRedirectCalls += 1;
      return new Response(null, { status: 302, headers: { location: "/again" } });
    }
  ), /evidence_redirect_limit/);
  assert.equal(rejectedRedirectCalls, expected.maximumRedirects + 1);

  // The existing 32-MiB transfer bound remains active.
  await assert.rejects(collector.boundedFetch(
    "https://size.example/source",
    async () => new Response("small fixture body", {
      status: 200,
      headers: { "content-length": String(expected.maximumBytes + 1) }
    })
  ), /oversize_unreadable:declared_body_exceeds_limit/);

  // TLS verification disablement is explicit and observable in the recorded
  // transport policy. Other values must not be treated as disablement.
  const oldRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const oldExtraCa = process.env.NODE_EXTRA_CA_CERTS;
  try {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_EXTRA_CA_CERTS;
    assert.equal(collector.configuredTransportPolicy().verification,
      fixture.tls.defaultVerificationLabel);

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    assert.equal(collector.configuredTransportPolicy().verification,
      fixture.tls.defaultVerificationLabel);

    process.env.NODE_EXTRA_CA_CERTS = "/fixture/ca.pem";
    assert.equal(collector.configuredTransportPolicy().verification,
      fixture.tls.customCaVerificationLabel);

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const disabled = collector.configuredTransportPolicy();
    assert.equal(disabled.verification, fixture.tls.disabledVerificationLabel);
    assert.equal(disabled.nodeTlsRejectUnauthorized, "0");
  } finally {
    restoreEnvironment("NODE_TLS_REJECT_UNAUTHORIZED", oldRejectUnauthorized);
    restoreEnvironment("NODE_EXTRA_CA_CERTS", oldExtraCa);
  }

  // An unreadable arm-owned exact URL is an evaluation sufficiency limitation,
  // never positive evidence of an arm defect.
  const unreadable = compiler.criterionStates({
    production: { finalProfiles: [] },
    judgment: {
      criticalFindings: [],
      claimAssessments: [{
        claimId: "claim-unreadable",
        exactSupport: "unreadable",
        citedSourceSupport: "unreadable",
        fieldValidity: "unreadable",
        identityLink: "unreadable",
        providerIdentitySpanFidelity: "unreadable",
        factSpanFidelity: "unreadable",
        explicitDateSpanFidelity: "unreadable"
      }],
      fieldAssessments: [{
        fieldType: "location",
        cmsHierarchyConditionalOutcome: "indeterminate",
        contractFidelity: "indeterminate"
      }]
    }
  });
  for (const criterion of [
    "readable_material_support_defect",
    "own_citation_support_defect",
    "identity_attachment_defect",
    "citation_span_or_contract_defect"
  ]) {
    assert.equal(unreadable[criterion].state,
      fixture.unreadableExactUrlDisposition.criterionState, criterion);
  }
  assert.equal(unreadable.critical_safety_finding.state, "absent");

  process.stdout.write("Evidence transport restart policy: PASS\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.PROVIDER_EVAL_NODE_MODULES ||= path.resolve(__dirname, "../../../node_modules");
const collector = require("../core/evidence_collector.js");
const formatNormalizer = require("../core/format_aware_source_normalizer.js");
const evidenceResume = require("../core/resume_evidence.js");
const { evaluatorRunnerAuthority } = require("../core/evaluator_runner_authority.js");
const { verifyProductionBinding } = require("../core/run_evaluator_campaign.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const makeDescriptor = (root, body, extension) => {
  const file = path.join(root, "source-artifacts", `${sha256(body)}.${extension}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return { path: path.relative(root, file), sha256: sha256(body), byteLength: body.length, complete: true };
};
const baseResult = (source) => ({ ...source, finalUrl: source.requestedUrl, redirects: [], httpStatus: 200,
  tlsVerification: "issuer_verification_disabled_by_protocol", durationMs: 1,
  startedAt: "2000-01-01T00:00:00.000Z", completedAt: "2000-01-01T00:00:00.001Z",
  bytesObserved: 1, bytesRetained: 1, exceededMaximumBytes: false,
  headers: { contentType: "text/html" }, dateEvidence: [], semanticExtraction: {},
  fetchPolicyVersion: "test", extractorVersion: "test", outcome: "read",
  retentionClass: "arm_owned_public_evidence", fetchAttempts: 1, error: null,
  fetchSharing: { mode: "test", requestUrlSha256: sha256(source.requestedUrl) } });

(async () => {
  assert.equal(evidenceResume.isResponseFreeFetchError({ outcome: "fetch_error", finalUrl: null,
    httpStatus: null, rawBodyArtifact: null, normalizedTextArtifact: null,
    bytesObserved: 0, bytesRetained: 0 }), true);
  assert.equal(evidenceResume.isResponseFreeFetchError({ outcome: "fetch_error", finalUrl: "https://example.test",
    httpStatus: 500, rawBodyArtifact: null, normalizedTextArtifact: null,
    bytesObserved: 0, bytesRetained: 0 }), false);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "provider-evidence-resume-"));
  try {
    const productionRoot = path.join(temporary, "production");
    const evidenceRoot = path.join(temporary, "evidence", "ARM-format-aware-evidence-v4");
    const urls = ["https://preserved.test/provider", "https://normalize.test/provider",
      "https://retry.test/provider", "https://interrupted.test/provider"];
    const artifactFile = path.join(productionRoot, "cells", "ARM", "P001", "artifact.json");
    const artifact = { input: { providers: [{ npi: "1234567890", name: "Test Provider" }] },
      trace: { actionSourceUrls: urls }, parserProfiles: [], finalProfiles: [] };
    writeJson(artifactFile, artifact);
    const immutable = collector.enumerateArmSources({ trace: artifact.trace });
    const byUrl = new Map(immutable.map((source) => [source.requestedUrl, source]));

    const preservedBody = Buffer.from("<html><body>preserved exact response</body></html>");
    const preservedText = Buffer.from("preserved exact response");
    const preserved = { ...baseResult(byUrl.get(urls[0])),
      bytesObserved: preservedBody.length, bytesRetained: preservedBody.length,
      rawBodyArtifact: makeDescriptor(evidenceRoot, preservedBody, "body"),
      normalizedTextArtifact: makeDescriptor(evidenceRoot, preservedText, "txt") };
    const normalizeBody = Buffer.from("<html><head><title>Provider</title></head><body>local retained evidence</body></html>");
    const normalizationError = { ...baseResult(byUrl.get(urls[1])),
      bytesObserved: normalizeBody.length, bytesRetained: normalizeBody.length,
      outcome: "normalization_error", semanticExtraction: null,
      rawBodyArtifact: makeDescriptor(evidenceRoot, normalizeBody, "body"),
      normalizedTextArtifact: null, error: "normalizer worker pool is closed" };
    const fetchError = { ...byUrl.get(urls[2]), finalUrl: null, redirects: [], httpStatus: null,
      tlsVerification: "not_completed", durationMs: 30, startedAt: "2000-01-01T00:00:00.000Z",
      completedAt: "2000-01-01T00:00:00.030Z", bytesObserved: 0, bytesRetained: 0,
      exceededMaximumBytes: false, headers: {}, dateEvidence: [], semanticExtraction: null,
      fetchPolicyVersion: "test", extractorVersion: "test", outcome: "fetch_error",
      retentionClass: "metadata_only_unavailable", rawBodyArtifact: null,
      normalizedTextArtifact: null, fetchAttempts: 3, error: "network unavailable" };
    const interruptedFetchError = { ...fetchError, ...byUrl.get(urls[3]) };
    const sourceFile = path.join(evidenceRoot, "cells", "ARM", "P001", "sources.json");
    const sourceDocument = { schemaVersion: 4, armId: "ARM", caseId: "P001",
      sourcePolicy: "arm_specific_no_union", productionArtifactSha256: sha256(fs.readFileSync(artifactFile)),
      sources: [preserved, normalizationError, fetchError, interruptedFetchError]
        .sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)) };
    writeJson(sourceFile, sourceDocument);
    const sourceAuthority = "a".repeat(64);
    process.env.SOURCE_EVALUATOR_AUTHORITY_SHA256 = sourceAuthority;
    const priorSummary = { schemaVersion: 4, campaign: "ARM", sourcePolicy: "arm_specific_no_union",
      runnerAuthority: { authoritySha256: sourceAuthority }, cells: 1, sourceRows: 4,
      outcomes: { fetch_error: 2, normalization_error: 1, read: 1 }, invalidNormalizationCount: 1 };
    writeJson(path.join(evidenceRoot, "summary.json"), priorSummary);

    const authority = evaluatorRunnerAuthority(path.join(__dirname, "../core"));
    const campaign = { name: "ARM", armId: "ARM", input: productionRoot, outputRoot: evidenceRoot };
    const plan = evidenceResume.validateCampaign({ campaign, currentAuthority: authority });
    assert.equal(plan.renormalizeCount, 1);
    assert.equal(plan.refetchCount, 2);
    assert.equal(plan.actionCount, 3);

    const drifted = structuredClone(sourceDocument);
    drifted.sources[0].channels.push("invented_channel");
    writeJson(sourceFile, drifted);
    assert.throws(() => evidenceResume.validateCampaign({ campaign, currentAuthority: authority }),
      /source rows drifted/);
    writeJson(sourceFile, sourceDocument);

    const responseBearingError = structuredClone(sourceDocument);
    const retryIndex = responseBearingError.sources.findIndex((source) => source.requestedUrl === urls[2]);
    responseBearingError.sources[retryIndex].finalUrl = urls[2];
    writeJson(sourceFile, responseBearingError);
    assert.throws(() => evidenceResume.validateCampaign({ campaign, currentAuthority: authority }),
      /contains response evidence/);
    writeJson(sourceFile, sourceDocument);

    let fetchCalls = 0;
    let interruptedSiblingSettled = false;
    let poolClosedAfterAllSiblingsSettled = false;
    const poolFactory = () => {
      const pool = new formatNormalizer.SemanticMarkdownWorkerPool({ size: 2, timeoutMs: 20_000 });
      const close = pool.close.bind(pool);
      pool.close = async () => {
        poolClosedAfterAllSiblingsSettled = interruptedSiblingSettled;
        return close();
      };
      return pool;
    };
    const fetchImpl = async (url) => {
      fetchCalls += 1;
      assert([urls[2], urls[3]].includes(url), "only response-free URLs may be fetched");
      return new Response("<html><body>retried evidence</body></html>", {
        status: 200, headers: { "content-type": "text/html" }
      });
    };
    const realFetchSource = collector.fetchSource;
    await assert.rejects(evidenceResume.executePlans([plan], { fetchImpl, poolFactory,
      fetchSourceImpl: async (options) => {
        if (options.source.requestedUrl !== urls[3]) return realFetchSource(options);
        await new Promise((resolve) => setTimeout(resolve, 100));
        interruptedSiblingSettled = true;
        throw new Error("fixture interruption after sibling source completion");
      }
    }), /fixture interruption/);
    assert.equal(poolClosedAfterAllSiblingsSettled, true,
      "worker pool must close only after every sibling action settles");
    assert.equal(fetchCalls, 1, "exceptional sibling must not invoke transport in this fixture");

    const interruptedCheckpoint = readJson(sourceFile);
    const firstArchiveRoot = fs.readdirSync(path.join(evidenceRoot, "resume-archives")).sort()
      .map((name) => path.join(evidenceRoot, "resume-archives", name))[0];
    const firstArchiveSemanticSha256 = sha256(JSON.stringify(readJson(path.join(firstArchiveRoot,
      "ARCHIVE_MANIFEST.json"))));
    const checkpointedSource = interruptedCheckpoint.sources.find((source) => source.requestedUrl === urls[2]);
    assert.equal(checkpointedSource.outcome, "read",
      "fulfilled source must be atomically checkpointed before a sibling rejection propagates");
    assert.equal(checkpointedSource.evidenceResume.archiveManifestSemanticSha256,
      firstArchiveSemanticSha256, "each checkpoint must bind its current byte-audited archive manifest");
    assert.deepEqual(checkpointedSource.evidenceResume.archiveLineageSha256, [firstArchiveSemanticSha256]);
    assert.equal(interruptedCheckpoint.sources.find((source) => source.requestedUrl === urls[3]).outcome, "fetch_error");
    const resumedPlan = evidenceResume.validateCampaign({ campaign, currentAuthority: authority });
    assert.equal(resumedPlan.refetchCount, 1,
      "the next resume may admit only the source that never completed");
    let resumedFetchCalls = 0;
    const result = await evidenceResume.executePlans([resumedPlan], { fetchImpl: async (url) => {
      resumedFetchCalls += 1;
      assert.equal(url, urls[3], "already response-bearing recovered URL must not be refetched");
      return new Response("<html><body>final interrupted evidence</body></html>", {
        status: 200, headers: { "content-type": "text/html" }
      });
    } });
    assert.equal(resumedFetchCalls, 1);
    assert.equal(result[0].ready, true);
    const recovered = readJson(sourceFile);
    assert.deepEqual(recovered.sources.find((source) => source.requestedUrl === urls[0]), preserved,
      "completed response-bearing source must remain byte-for-byte equivalent as a JSON value");
    const renormalized = recovered.sources.find((source) => source.requestedUrl === urls[1]);
    assert.equal(renormalized.outcome, "read");
    assert.deepEqual(renormalized.rawBodyArtifact, normalizationError.rawBodyArtifact,
      "local re-normalization must retain the exact raw body descriptor");
    assert.equal(renormalized.evidenceResume.networkCallsMade, 0);
    const retried = recovered.sources.find((source) => source.requestedUrl === urls[2]);
    assert.equal(retried.outcome, "read");
    assert.equal(retried.evidenceResume.action, "response_free_fetch_error_exact_url_retry");

    const ready = readJson(path.join(evidenceRoot, "NORMALIZATION_READY.json"));
    assert.equal(ready.producerAuthoritySha256, authority.authoritySha256);
    const summary = readJson(path.join(evidenceRoot, "summary.json"));
    assert.equal(summary.runnerAuthority.authoritySha256, authority.authoritySha256);
    assert.deepEqual(summary.outcomes, { read: 4 });
    const archiveRoots = fs.readdirSync(path.join(evidenceRoot, "resume-archives")).sort()
      .map((name) => path.join(evidenceRoot, "resume-archives", name));
    assert.equal(archiveRoots.length, 2, "interrupted and resumed attempts must each retain an audit archive");
    for (const archiveRoot of archiveRoots) {
      const archiveManifest = readJson(path.join(archiveRoot, "ARCHIVE_MANIFEST.json"));
      for (const item of archiveManifest.archived) {
        const body = fs.readFileSync(path.join(archiveRoot, item.path));
        assert.equal(body.length, item.byteLength);
        assert.equal(sha256(body), item.sha256);
      }
    }
    assert.deepEqual(readJson(path.join(archiveRoots[0], path.relative(evidenceRoot, sourceFile))), sourceDocument,
      "prior failure source manifest must be archived byte-for-byte before replacement");
    const secondArchiveSemanticSha256 = sha256(JSON.stringify(readJson(path.join(result[0].archiveRoot,
      "ARCHIVE_MANIFEST.json"))));
    const archiveSemanticHashes = [firstArchiveSemanticSha256, secondArchiveSemanticSha256];
    assert.deepEqual(summary.evidenceResume.archiveLineageSha256, archiveSemanticHashes,
      "summary must retain the unique ordered lineage across interrupted resumes");
    assert.deepEqual(ready.recoveryArchiveLineageSha256, archiveSemanticHashes,
      "readiness seal must bind the same recovery archive lineage");
    assert.equal(recovered.sources.find((source) => source.requestedUrl === urls[3])
      .evidenceResume.archiveManifestSemanticSha256, secondArchiveSemanticSha256);
    assert.deepEqual(recovered.sources.find((source) => source.requestedUrl === urls[3])
      .evidenceResume.archiveLineageSha256, archiveSemanticHashes,
    "a later recovered row must carry the complete ordered prior archive lineage");

    const secondPlan = evidenceResume.validateCampaign({ campaign, currentAuthority: authority });
    assert.equal(secondPlan.actionCount, 0,
      "a resumed campaign must treat newly response-bearing checkpoints as complete");
    let secondFetchCalls = 0;
    const archivesBeforeNoOp = fs.readdirSync(path.join(evidenceRoot, "resume-archives")).length;
    const noOp = await evidenceResume.executePlans([secondPlan], { fetchImpl: async () => {
      secondFetchCalls += 1;
      throw new Error("completed rows must never reach transport");
    }, poolFactory: () => { throw new Error("no-op resume must not construct a normalizer pool"); } });
    assert.equal(secondFetchCalls, 0, "a repeated resume must not refetch completed checkpoints");
    assert.equal(noOp[0].noOpAlreadyRecovered, true);
    assert.equal(fs.readdirSync(path.join(evidenceRoot, "resume-archives")).length, archivesBeforeNoOp,
      "idempotent no-op resume must not grow archive lineage");

    const productionManifest = path.join(temporary, "production-manifest.json");
    writeJson(productionManifest, { frozen: true });
    const preregistration = path.join(productionRoot, "preregistration.json");
    const productionSummary = path.join(productionRoot, "summary.json");
    writeJson(preregistration, { frozen: true });
    writeJson(productionSummary, { frozen: true });
    const bindingManifest = { productionBinding: {
      manifestFile: productionManifest, manifestSha256: sha256(fs.readFileSync(productionManifest)),
      resolvedOutputRoot: productionRoot,
      preregistrationSha256: sha256(fs.readFileSync(preregistration)),
      summarySha256: sha256(fs.readFileSync(productionSummary))
    }, arms: [{ armId: "ARM", productionRoot }] };
    assert.equal(verifyProductionBinding(bindingManifest, (value) => value), true);
    fs.appendFileSync(productionSummary, "drift");
    assert.throws(() => verifyProductionBinding(bindingManifest, (value) => value), /frozen SHA-256/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write("evidence resume tests passed\n");
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

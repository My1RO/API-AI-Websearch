#!/usr/bin/env node
"use strict";

// Recovery for an interrupted/partially unavailable evidence collection. This
// is deliberately not a second collector: it admits an existing, frozen
// collection and changes only normalization_error rows (from retained bytes)
// and response-free fetch_error rows (with a new exact-URL request).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const normalizer = require("./format_aware_source_normalizer.js");
const collector = require("./evidence_collector.js");
const evidence = require("./collect_evidence.js");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const isWithin = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
};
const atomicWrite = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.resume-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
};
const descriptor = (base, file) => {
  const bytes = fs.readFileSync(file);
  return { path: path.relative(base, file), sha256: sha256(bytes), byteLength: bytes.length, complete: true };
};
const verifyDescriptor = (base, item, label) => {
  assert(item && typeof item.path === "string" && /^[a-f0-9]{64}$/.test(item.sha256 || "")
    && Number.isSafeInteger(item.byteLength), `${label} descriptor is incomplete.`);
  const file = path.resolve(base, item.path);
  assert(isWithin(base, file) && fs.existsSync(file), `${label} artifact is absent or escapes its evidence root.`);
  const bytes = fs.readFileSync(file);
  assert(bytes.length === item.byteLength && sha256(bytes) === item.sha256,
    `${label} artifact differs from its retained hash/length.`);
  return { file, bytes };
};

const IMMUTABLE_SOURCE_KEYS = Object.freeze([
  "sourceId", "requestedUrl", "canonicalUrl", "channels", "structuredSourceTitles",
  "creditEligible", "evidenceRole", "recencyPresumption"
]);
const immutableSource = (source) => Object.fromEntries(IMMUTABLE_SOURCE_KEYS.map((key) => [key, source[key]]));
const sourceKey = (source) => `${source.sourceId}\u0000${source.requestedUrl}\u0000${source.canonicalUrl}`;
const immutableSourceSet = (sources) => [...sources].map(immutableSource)
  .sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
const unique = (values) => [...new Set(values.filter(Boolean))];
const sourceArchiveLineage = (source) => unique([
  ...(source?.evidenceResume?.archiveLineageSha256 || []),
  source?.evidenceResume?.archiveManifestSemanticSha256,
  source?.evidenceResume?.recoveryArchiveManifestSha256
]);
const archiveLineageForSources = (sources) => unique(sources.flatMap(sourceArchiveLineage));
const sortedSourceSnapshot = (sources) => [...sources]
  .sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl));
const isResponseFreeFetchError = (source) => source?.outcome === "fetch_error"
  && source.finalUrl == null && source.httpStatus == null
  && source.rawBodyArtifact == null && source.normalizedTextArtifact == null
  && source.bytesObserved === 0 && source.bytesRetained === 0;

const validateCampaign = ({ campaign, currentAuthority }) => {
  const productionCells = evidence.discoverCells(campaign);
  const outputRoot = path.resolve(campaign.outputRoot);
  assert(fs.existsSync(outputRoot), `Evidence root is absent for ${campaign.name}: ${outputRoot}`);
  const expectedCellKeys = productionCells.map((cell) => `${cell.armId}/${cell.caseId}`).sort();
  const actualCellFiles = [];
  const cellsRoot = path.join(outputRoot, "cells");
  assert(fs.existsSync(cellsRoot), `Evidence cells root is absent for ${campaign.name}.`);
  for (const armId of fs.readdirSync(cellsRoot).sort()) {
    for (const caseId of fs.readdirSync(path.join(cellsRoot, armId)).sort()) {
      const file = path.join(cellsRoot, armId, caseId, "sources.json");
      if (fs.existsSync(file)) actualCellFiles.push({ key: `${armId}/${caseId}`, file });
    }
  }
  assert(JSON.stringify(actualCellFiles.map((row) => row.key).sort()) === JSON.stringify(expectedCellKeys),
    `${campaign.name}: evidence cells differ from the frozen production cells; recovery refuses partial discovery.`);

  const cellPlans = [];
  for (const cell of productionCells) {
    const file = path.join(outputRoot, "cells", cell.armId, cell.caseId, "sources.json");
    const stored = readJson(file);
    assert(stored.schemaVersion === 4 && stored.armId === cell.armId && stored.caseId === cell.caseId
      && stored.sourcePolicy === "arm_specific_no_union", `${campaign.name}/${cell.armId}/${cell.caseId}: invalid source manifest identity.`);
    const productionBytes = fs.readFileSync(cell.artifactPath);
    assert(stored.productionArtifactSha256 === sha256(productionBytes),
      `${campaign.name}/${cell.armId}/${cell.caseId}: production artifact hash drifted.`);
    assert(JSON.stringify(immutableSourceSet(stored.sources)) === JSON.stringify(immutableSourceSet(cell.sources)),
      `${campaign.name}/${cell.armId}/${cell.caseId}: exact arm-local source rows drifted.`);
    for (const source of stored.sources) {
      if (source.rawBodyArtifact) verifyDescriptor(outputRoot, source.rawBodyArtifact,
        `${campaign.name}/${cell.armId}/${cell.caseId}/${source.sourceId} raw body`);
      if (source.normalizedTextArtifact) verifyDescriptor(outputRoot, source.normalizedTextArtifact,
        `${campaign.name}/${cell.armId}/${cell.caseId}/${source.sourceId} normalized text`);
      if (source.outcome === "normalization_error") {
        assert(source.rawBodyArtifact, `${campaign.name}/${cell.armId}/${cell.caseId}: normalization_error lacks retained body.`);
      } else if (source.outcome === "fetch_error") {
        assert(isResponseFreeFetchError(source),
          `${campaign.name}/${cell.armId}/${cell.caseId}: fetch_error contains response evidence and must be preserved.`);
      }
    }
    const actions = stored.sources.map((source, index) => source.outcome === "normalization_error"
      ? { type: "renormalize", index } : isResponseFreeFetchError(source) ? { type: "refetch", index } : null).filter(Boolean);
    cellPlans.push({ cell, file, stored, actions });
  }
  const priorSummaryFile = path.join(outputRoot, "summary.json");
  const priorReadyFile = path.join(outputRoot, "NORMALIZATION_READY.json");
  assert(fs.existsSync(priorSummaryFile), `${campaign.name}: prior summary.json is required for recovery audit.`);
  const priorSummary = readJson(priorSummaryFile);
  assert(priorSummary.campaign === campaign.name && priorSummary.sourcePolicy === "arm_specific_no_union",
    `${campaign.name}: prior summary identity differs.`);
  const sourceAuthority = process.env.SOURCE_EVALUATOR_AUTHORITY_SHA256 || "";
  const priorAuthority = priorSummary.runnerAuthority?.authoritySha256;
  assert(sourceAuthority && [sourceAuthority, currentAuthority.authoritySha256].includes(priorAuthority),
    `${campaign.name}: prior evidence authority is neither the sealed source nor current recovery authority.`);
  const priorReady = fs.existsSync(priorReadyFile) ? readJson(priorReadyFile) : null;
  const actionCount = cellPlans.reduce((sum, row) => sum + row.actions.length, 0);
  const priorReadyValid = priorReady?.schemaVersion === 1
    && priorReady?.status === "zero_invalid_normalizations"
    && priorReady?.summarySha256 === sha256(JSON.stringify(priorSummary));
  const authorityRefreshRequired = priorAuthority !== currentAuthority.authoritySha256
    || priorReady?.producerAuthoritySha256 !== currentAuthority.authoritySha256 || !priorReadyValid;
  return { campaign, outputRoot, productionCells, cellPlans, priorSummaryFile, priorReadyFile,
    priorSummary, priorAuthority, currentAuthority,
    priorReady, actionCount, authorityRefreshRequired,
    mutationRequired: actionCount > 0 || authorityRefreshRequired,
    renormalizeCount: cellPlans.flatMap((row) => row.actions).filter((row) => row.type === "renormalize").length,
    refetchCount: cellPlans.flatMap((row) => row.actions).filter((row) => row.type === "refetch").length };
};

const archivePriorManifests = (plan) => {
  const files = [plan.priorSummaryFile, ...(fs.existsSync(plan.priorReadyFile) ? [plan.priorReadyFile] : []),
    ...plan.cellPlans.filter((row) => row.actions.length).map((row) => row.file)];
  const archiveId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha256(Buffer.concat(files.map((file) => fs.readFileSync(file)))).slice(0, 16)}`;
  const archiveRoot = path.join(plan.outputRoot, "resume-archives", archiveId);
  fs.mkdirSync(path.dirname(archiveRoot), { recursive: true, mode: 0o700 });
  fs.mkdirSync(archiveRoot, { recursive: false, mode: 0o700 });
  const archived = files.map((file) => {
    const relative = path.relative(plan.outputRoot, file);
    assert(!relative.startsWith("..") && !path.isAbsolute(relative), "Archive source escapes evidence root.");
    const bytes = fs.readFileSync(file);
    const target = path.join(archiveRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    assert(fs.readFileSync(target).equals(bytes), `Archive copy differs for ${relative}.`);
    return { path: relative, sha256: sha256(bytes), byteLength: bytes.length };
  });
  const manifest = { schemaVersion: 1, status: "prior_failure_manifests_archived_byte_for_byte",
    campaign: plan.campaign.name, priorEvaluatorAuthoritySha256: plan.priorAuthority,
    sealedSourceEvaluatorAuthoritySha256: process.env.SOURCE_EVALUATOR_AUTHORITY_SHA256,
    recoveryEvaluatorAuthoritySha256: plan.currentAuthority.authoritySha256,
    priorArchiveLineageSha256: unique([
      ...(plan.priorSummary?.evidenceResume?.archiveLineageSha256 || []),
      ...archiveLineageForSources(plan.cellPlans.flatMap((row) => row.stored.sources))
    ]),
    archived };
  fs.writeFileSync(path.join(archiveRoot, "ARCHIVE_MANIFEST.json"), jsonBytes(manifest), { flag: "wx", mode: 0o600 });
  return { archiveRoot, manifest, manifestSha256: sha256(JSON.stringify(manifest)) };
};

const renormalizeSource = async ({ source, outputRoot, pool }) => {
  const retained = verifyDescriptor(outputRoot, source.rawBodyArtifact, `${source.sourceId} raw body`);
  const contentType = source.headers?.contentType || "application/octet-stream";
  const url = source.finalUrl || source.requestedUrl;
  let semantic = null;
  let error = null;
  try {
    semantic = await collector.normalizedTextFor({ body: retained.bytes, contentType, url, pool });
    if (!semantic || semantic.sourceBodySha256 !== source.rawBodyArtifact.sha256) {
      throw new Error("normalizer_source_body_hash_mismatch");
    }
  } catch (caught) {
    error = String(caught?.message || caught).slice(0, 1200);
  }
  let normalizedTextArtifact = null;
  if (semantic?.evidenceText) {
    const textBytes = Buffer.from(semantic.evidenceText, "utf8");
    const textFile = path.join(outputRoot, "source-artifacts", `${sha256(textBytes)}.txt`);
    collector.writeContentAddressed(textFile, textBytes);
    normalizedTextArtifact = descriptor(outputRoot, textFile);
  }
  const { evidenceText: _omitted, ...semanticAudit } = semantic || {};
  const binaryUnavailable = semantic?.evidenceUnavailable === true
    && semantic?.extractionMode === "metadata_only_binary_unavailable";
  return { ...source, semanticExtraction: semantic ? semanticAudit : null,
    extractorVersion: normalizer.SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
    outcome: error ? "normalization_error" : binaryUnavailable ? "binary_unavailable"
      : source.httpStatus >= 200 && source.httpStatus < 300 ? "read" : "http_error",
    retentionClass: binaryUnavailable ? "metadata_only_binary_unavailable" : "arm_owned_public_evidence",
    normalizedTextArtifact, error,
    evidenceResume: { action: "local_renormalization_from_retained_raw_body", networkCallsMade: 0,
      retainedRawBodySha256: source.rawBodyArtifact.sha256,
      recoveryAuthoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 } };
};

const rebuildSummary = ({ plan, cellDocuments, archive }) => {
  const allSources = cellDocuments.flatMap((row) => row.sources);
  const invalid = allSources.filter((source) => source.outcome === "normalization_error");
  const archiveLineageSha256 = unique([
    ...(archive.manifest.priorArchiveLineageSha256 || []),
    ...archiveLineageForSources(allSources), archive.manifestSha256
  ]);
  return { ...plan.priorSummary,
    normalizerPath: path.join(__dirname, "format_aware_source_normalizer.js"),
    normalizerSha256: sha256(fs.readFileSync(path.join(__dirname, "format_aware_source_normalizer.js"))),
    runnerAuthority: plan.currentAuthority,
    runtimeProvenance: evidence.runtimeProvenance(),
    cells: plan.productionCells.length, sourceRows: allSources.length,
    uniqueRequestUrls: new Set(allSources.map((source) => source.requestedUrl)).size,
    outcomes: Object.fromEntries([...new Set(allSources.map((source) => source.outcome))].sort()
      .map((outcome) => [outcome, allSources.filter((source) => source.outcome === outcome).length])),
    invalidNormalizationCount: invalid.length,
    invalidNormalizations: invalid.map((source) => ({ sourceId: source.sourceId,
      requestedUrl: source.requestedUrl, error: source.error })),
    evidenceResume: { schemaVersion: 1, mode: "selective_local_normalize_or_response_free_exact_url_refetch",
      priorSummarySha256: sha256(JSON.stringify(plan.priorSummary)), archiveManifestSha256: archive.manifestSha256,
      archiveManifestSemanticSha256: archive.manifestSha256, archiveLineageSha256,
      sourceEvaluatorAuthoritySha256: process.env.SOURCE_EVALUATOR_AUTHORITY_SHA256,
      recoveryEvaluatorAuthoritySha256: plan.currentAuthority.authoritySha256,
      renormalizedRows: plan.renormalizeCount, refetchedRows: plan.refetchCount,
      preservedRows: allSources.length - plan.actionCount } };
};

const executePlans = async (plans, { fetchImpl = globalThis.fetch,
  fetchSourceImpl = collector.fetchSource, renormalizeSourceImpl = renormalizeSource,
  poolFactory = () => new normalizer.SemanticMarkdownWorkerPool({
    size: collector.NORMALIZATION_CONCURRENCY, timeoutMs: collector.NORMALIZATION_TIMEOUT_MS
  }) } = {}) => {
  // The caller must validate every campaign before this point. Archiving is the
  // first mutation, so a later failure remains recoverable byte-for-byte.
  const archives = plans.map((plan) => plan.mutationRequired ? archivePriorManifests(plan) : null);
  if (plans.every((plan) => !plan.mutationRequired)) return plans.map((plan) => ({
    campaign: plan.campaign.name, outputRoot: plan.outputRoot, actionCount: 0,
    renormalizeCount: 0, refetchCount: 0, outcomes: plan.priorSummary.outcomes,
    ready: true, archiveRoot: null, noOpAlreadyRecovered: true
  }));
  const pool = poolFactory();
  const originLimiter = new collector.OriginConcurrencyLimiter(collector.ORIGIN_CONCURRENCY);
  const globalTransferLimiter = new collector.ConcurrencyLimiter(collector.GLOBAL_TRANSFER_CONCURRENCY);
  const fetchCache = new collector.ExactRequestUrlFetchCache();
  const transportPolicy = evidence.configuredV4TransportPolicy();
  const sharedArtifactRoot = path.join(path.dirname(plans[0].outputRoot), "_evidence-resume-shared-artifacts-v4");
  try {
    const results = [];
    for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
      const plan = plans[planIndex];
      if (!plan.mutationRequired) {
        results.push({ campaign: plan.campaign.name, outputRoot: plan.outputRoot, actionCount: 0,
          renormalizeCount: 0, refetchCount: 0, outcomes: plan.priorSummary.outcomes,
          ready: true, archiveRoot: null, noOpAlreadyRecovered: true });
        continue;
      }
      const cellDocuments = [];
      for (const cellPlan of plan.cellPlans) {
        const sources = [...cellPlan.stored.sources];
        const archive = archives[planIndex];
        const actionSettlements = await Promise.allSettled(cellPlan.actions.map(async (action) => {
          const prior = sources[action.index];
          let recovered;
          if (action.type === "renormalize") {
            recovered = await renormalizeSourceImpl({ source: prior, outputRoot: plan.outputRoot, pool });
          } else {
            const fetched = await fetchSourceImpl({ source: immutableSource(prior),
              productionRoot: sharedArtifactRoot, pool, fetchImpl, transportPolicy,
              originLimiter, globalTransferLimiter, fetchCache });
            const rebound = evidence.bindSharedArtifactsToCampaign(fetched, sharedArtifactRoot, plan.outputRoot);
            recovered = { ...rebound, evidenceResume: {
              action: "response_free_fetch_error_exact_url_retry", priorOutcome: prior.outcome,
              priorError: prior.error, recoveryAuthoritySha256: plan.currentAuthority.authoritySha256 } };
          }
          const archiveLineageSha256 = unique([
            ...(archive.manifest.priorArchiveLineageSha256 || []),
            ...sourceArchiveLineage(prior), archive.manifestSha256
          ]);
          recovered.evidenceResume = { ...(recovered.evidenceResume || {}),
            archiveManifestSemanticSha256: archive.manifestSha256,
            archiveLineageSha256 };
          sources[action.index] = recovered;
          // The synchronous replace is the per-source recovery journal. JS
          // continuations cannot interleave between the in-memory assignment
          // and atomic rename, so simultaneous completions serialize their
          // progressively fuller cell snapshots without a lost update.
          atomicWrite(cellPlan.file, jsonBytes({ ...cellPlan.stored,
            sources: sortedSourceSnapshot(sources) }));
        }));
        const rejected = actionSettlements.find((row) => row.status === "rejected");
        if (rejected) throw rejected.reason;
        const cellDocument = { ...cellPlan.stored, sources: sortedSourceSnapshot(sources) };
        cellDocuments.push(cellDocument);
        if (cellPlan.actions.length) atomicWrite(cellPlan.file, jsonBytes(cellDocument));
      }
      const summary = rebuildSummary({ plan, cellDocuments, archive: archives[planIndex] });
      atomicWrite(plan.priorSummaryFile, jsonBytes(summary));
      if (summary.invalidNormalizationCount === 0) {
        atomicWrite(plan.priorReadyFile, jsonBytes({ schemaVersion: 1,
          status: "zero_invalid_normalizations", summarySha256: sha256(JSON.stringify(summary)),
          producerAuthoritySha256: plan.currentAuthority.authoritySha256,
          recoveryArchiveManifestSha256: archives[planIndex].manifestSha256,
          recoveryArchiveLineageSha256: summary.evidenceResume.archiveLineageSha256 }));
      } else if (fs.existsSync(plan.priorReadyFile)) {
        fs.unlinkSync(plan.priorReadyFile);
      }
      results.push({ campaign: plan.campaign.name, outputRoot: plan.outputRoot,
        actionCount: plan.actionCount, renormalizeCount: plan.renormalizeCount,
        refetchCount: plan.refetchCount, outcomes: summary.outcomes,
        ready: summary.invalidNormalizationCount === 0,
        archiveRoot: archives[planIndex].archiveRoot });
    }
    return results;
  } finally {
    await pool.close();
  }
};

const main = async () => {
  const campaigns = JSON.parse(process.env.EVIDENCE_RESUME_CAMPAIGNS_JSON || "null");
  assert(Array.isArray(campaigns) && campaigns.length && campaigns.every((row) =>
    row.name && row.input && row.outputRoot && (!row.armId || typeof row.armId === "string")),
  "EVIDENCE_RESUME_CAMPAIGNS_JSON must contain name, input, outputRoot, and optional armId.");
  const currentAuthority = evaluatorRunnerAuthority(__dirname);
  const plans = campaigns.map((campaign) => validateCampaign({ campaign: {
    ...campaign, input: path.resolve(campaign.input), outputRoot: path.resolve(campaign.outputRoot)
  }, currentAuthority }));
  evidence.assertSameBattery(campaigns, campaigns.map((campaign, index) => ({
    campaign, cells: plans[index].productionCells
  })));
  const inspection = plans.map((plan) => ({ campaign: plan.campaign.name, outputRoot: plan.outputRoot,
    cells: plan.productionCells.length, sourceRows: plan.cellPlans.reduce((sum, row) => sum + row.stored.sources.length, 0),
    renormalizeCount: plan.renormalizeCount, refetchCount: plan.refetchCount,
    preservedRows: plan.cellPlans.reduce((sum, row) => sum + row.stored.sources.length, 0) - plan.actionCount }));
  if (process.env.RESUME_INSPECT_ONLY === "1") {
    process.stdout.write(`${JSON.stringify({ status: "EVIDENCE_RESUME_ADMITTED_NO_MUTATION", inspection }, null, 2)}\n`);
    return;
  }
  const results = await executePlans(plans);
  process.stdout.write(`${JSON.stringify({ status: "EVIDENCE_RESUME_COMPLETE", inspection, results }, null, 2)}\n`);
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { IMMUTABLE_SOURCE_KEYS, archivePriorManifests, atomicWrite, executePlans,
  archiveLineageForSources, immutableSource, immutableSourceSet, isResponseFreeFetchError, rebuildSummary,
  renormalizeSource, validateCampaign, verifyDescriptor };

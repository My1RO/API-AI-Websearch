#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");
const { assertAuthorizedComponentCli } = require("./evaluator_runner_guard.js");

const NORMALIZER = path.join(__dirname, "format_aware_source_normalizer.js");
process.env.PROVIDER_EVALUATOR_NORMALIZER_MODULE = NORMALIZER;
const normalizer = require(NORMALIZER);
const collector = require(path.join(__dirname,
  "./evidence_collector.js"));

const DRY_RUN = process.env.DRY_RUN !== "0";
const OUTPUT_BASE = process.env.OUTPUT_BASE ? path.resolve(process.env.OUTPUT_BASE) : null;
const RETRY_AFTER_BUDGET_MS = 60_000;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fileAudit = (file) => file && fs.existsSync(file) ? {
  path: fs.realpathSync(file), sha256: sha256(fs.readFileSync(file)), byteLength: fs.statSync(file).size
} : null;
const runtimeProvenance = () => {
  const python = process.env.WORKBOOK_PYTHON || null;
  const soffice = process.env.WORKBOOK_SOFFICE || null;
  return {
    node: { executable: process.execPath, version: process.version, dependencyModules: process.env.PROVIDER_EVAL_NODE_MODULES || null },
    normalizer: fileAudit(NORMALIZER),
    workbookScript: fileAudit(path.join(__dirname, "format_aware_workbook.py")),
    python: python && fs.existsSync(python) ? {
      ...fileAudit(python),
      version: execFileSync(python, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim(),
      openpyxlVersion: execFileSync(python, ["-c", "import openpyxl; print(openpyxl.__version__)"],
        { encoding: "utf8", timeout: 10_000 }).trim()
    } : null,
    libreOffice: soffice && fs.existsSync(soffice) ? {
      ...fileAudit(soffice),
      version: execFileSync(soffice, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim()
    } : null
  };
};
const runnerAuthority = () => evaluatorRunnerAuthority(__dirname);
const writeJsonExclusive = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
};
const cellAdmissionConcurrency = (cellCount) => {
  if (!Number.isSafeInteger(cellCount) || cellCount < 0) throw new Error("cellCount must be a nonnegative integer.");
  return Math.max(1, cellCount);
};
const schedulingPolicy = (cellCount, sharedAcrossCampaigns = false, sharedFetchCache = false) => ({
  policy: "all_cells_and_sources_admitted_origin_and_global_limiters_own_fairness_v2",
  cellAdmissionConcurrency: cellAdmissionConcurrency(cellCount),
  sourceAdmissionPolicy: "all_arm_sources_admitted_without_per_cell_retry_wait_slots",
  sourceConcurrencyPerCell: null,
  globalTransferConcurrency: collector.GLOBAL_TRANSFER_CONCURRENCY,
  originConcurrency: collector.ORIGIN_CONCURRENCY,
  requestTimeoutMs: collector.FETCH_TIMEOUT_MS,
  maximumTotalAttempts: collector.FETCH_ATTEMPTS,
  crossCampaignOriginAndGlobalLimitersShared: sharedAcrossCampaigns,
  crossCampaignFetchCacheShared: sharedFetchCache,
  retryAfterOwner: "exact_url_fetch_worker",
  retryAfterBudgetMs: RETRY_AFTER_BUDGET_MS,
  retryAfterAboveBudgetDisposition: "terminal_http_outcome_for_exact_url",
  propagateRetryAfterToOrigin: false,
  evidenceSemanticsChanged: false
});
const configuredV4TransportPolicy = () => ({
  ...collector.configuredTransportPolicy(),
  retryAfterBudgetMs: RETRY_AFTER_BUDGET_MS,
  propagateRetryAfterToOrigin: false
});
const admitAllCellSources = (cells, operation, onCellComplete = (_cell, sources) => sources) =>
  Promise.all(cells.map(async (cell) => {
    const sources = await Promise.all(cell.sources.map((source) => operation(cell, source)));
    return onCellComplete(cell, sources);
  }));
const bindSharedArtifactsToCampaign = (result, sharedArtifactRoot, campaignRoot) => {
  const sharedRoot = path.resolve(sharedArtifactRoot);
  const armRoot = path.resolve(campaignRoot);
  for (const key of ["rawBodyArtifact", "normalizedTextArtifact"]) {
    const item = result?.[key];
    if (!item?.path) continue;
    const source = path.resolve(sharedRoot, item.path);
    const target = path.resolve(armRoot, item.path);
    if (!source.startsWith(`${sharedRoot}${path.sep}`) || !target.startsWith(`${armRoot}${path.sep}`)
      || !fs.existsSync(source)) throw new Error(`Shared ${key} descriptor is invalid.`);
    const sourceBody = fs.readFileSync(source);
    if (sourceBody.length !== item.byteLength || sha256(sourceBody) !== item.sha256) {
      throw new Error(`Shared ${key} descriptor hash/length mismatch.`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.linkSync(source, target);
    } catch (error) {
      if (error?.code === "EXDEV") fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      else if (error?.code !== "EEXIST") throw error;
    }
    const targetBody = fs.readFileSync(target);
    if (targetBody.length !== item.byteLength || sha256(targetBody) !== item.sha256) {
      throw new Error(`Campaign ${key} binding hash/length mismatch.`);
    }
  }
  return result;
};

const campaignArguments = process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  if (separator <= 0) throw new Error("Campaign arguments must be NAME=/absolute/production/root");
  return { name: argument.slice(0, separator), input: path.resolve(argument.slice(separator + 1)) };
});
const configuredCampaigns = process.env.EVALUATOR_EVIDENCE_CAMPAIGNS_JSON
  ? JSON.parse(process.env.EVALUATOR_EVIDENCE_CAMPAIGNS_JSON) : null;
const campaigns = configuredCampaigns || campaignArguments;
if ((require.main === module || campaigns.length) && (!Array.isArray(campaigns) || !campaigns.length
  || campaigns.some((campaign) => !campaign.name || !campaign.input
    || (campaign.armId != null && !campaign.armId)))) {
  throw new Error("Evidence campaigns require name, input, and optional nonempty armId.");
}
campaigns.forEach((campaign) => { campaign.input = path.resolve(campaign.input); });

const discoverAllCells = (productionRoot) => {
  const cellsRoot = path.join(productionRoot, "cells");
  if (!fs.existsSync(cellsRoot)) throw new Error(`Campaign cells root is absent: ${cellsRoot}`);
  const cells = [];
  for (const armId of fs.readdirSync(cellsRoot).sort()) {
    for (const caseId of fs.readdirSync(path.join(cellsRoot, armId)).sort()) {
      const artifactPath = path.join(cellsRoot, armId, caseId, "artifact.json");
      if (!fs.existsSync(artifactPath)) continue;
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      const rawProfiles = artifact.parserProfiles || artifact.finalProfiles || [];
      const finalProfiles = artifact.finalProfiles || [];
      const sources = collector.enumerateArmSources({ trace: artifact.trace, rawProfiles, finalProfiles });
      const requestPayload = artifact.input?.providers?.[0];
      if (!requestPayload) throw new Error(`Production artifact lacks input.providers[0]: ${artifactPath}`);
      cells.push({ armId, caseId, artifactPath, sources,
        requestSha256: sha256(JSON.stringify(requestPayload)) });
    }
  }
  return cells;
};
const discoverCells = (campaign) => discoverAllCells(campaign.input)
  .filter((cell) => !campaign.armId || campaign.armId === cell.armId);
const discoverCampaignCells = (campaignsToDiscover, scan = discoverAllCells) => {
  const cache = new Map();
  return campaignsToDiscover.map((campaign) => {
    const key = fs.existsSync(campaign.input) ? fs.realpathSync(campaign.input) : path.resolve(campaign.input);
    if (!cache.has(key)) cache.set(key, scan(campaign.input));
    const cells = cache.get(key).filter((cell) => !campaign.armId || campaign.armId === cell.armId);
    return { campaign, cells };
  });
};

const assertSameBattery = (campaignsToCheck, prepared = discoverCampaignCells(campaignsToCheck)) => {
  let reference = null;
  for (const campaign of campaignsToCheck) {
    const cells = prepared.find((row) => row.campaign === campaign)?.cells;
    if (!cells) throw new Error(`Prepared evidence cells are absent for ${campaign.name}.`);
    const rows = cells.map((cell) => [cell.caseId, cell.requestSha256]);
    const serialized = JSON.stringify(rows);
    if (reference && reference.serialized !== serialized) {
      throw new Error(`Campaign ${campaign.name} is not the same case/request battery as ${reference.name}.`);
    }
    reference ||= { name: campaign.name, serialized };
  }
  return true;
};

const runCampaign = async (campaign, shared = {}, preparedCells = null) => {
  if (!OUTPUT_BASE) throw new Error("OUTPUT_BASE is required.");
  const cells = preparedCells || discoverCells(campaign);
  const sourceRows = cells.reduce((sum, cell) => sum + cell.sources.length, 0);
  const uniqueRequestUrls = new Set(cells.flatMap((cell) => cell.sources.map((source) => source.requestedUrl))).size;
  const outputRoot = path.join(OUTPUT_BASE, `${campaign.name}-format-aware-evidence-v4`);
  const sharedAcrossCampaigns = Boolean(shared.pool || shared.originLimiter || shared.globalTransferLimiter);
  const scheduler = schedulingPolicy(cells.length, sharedAcrossCampaigns, Boolean(shared.fetchCache));
  if (DRY_RUN) return { name: campaign.name, input: campaign.input, outputRoot, cells: cells.length,
    sourceRows, uniqueRequestUrls, runtimeProvenance: runtimeProvenance(), runnerAuthority: runnerAuthority(),
    schedulingPolicy: scheduler, dryRun: true };
  if (fs.existsSync(outputRoot)) throw new Error(`Fresh evidence output already exists: ${outputRoot}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  const transportPolicy = configuredV4TransportPolicy();
  const originLimiter = shared.originLimiter
    || new collector.OriginConcurrencyLimiter(collector.ORIGIN_CONCURRENCY);
  const globalTransferLimiter = shared.globalTransferLimiter
    || new collector.ConcurrencyLimiter(collector.GLOBAL_TRANSFER_CONCURRENCY);
  const fetchCache = shared.fetchCache || new collector.ExactRequestUrlFetchCache();
  const fetchArtifactRoot = shared.artifactRoot || outputRoot;
  const ownsPool = !shared.pool;
  const pool = shared.pool || new normalizer.SemanticMarkdownWorkerPool({
    size: collector.NORMALIZATION_CONCURRENCY,
    timeoutMs: collector.NORMALIZATION_TIMEOUT_MS
  });
  let fetchedCells;
  try {
    // Admit every source promise in the arm before awaiting completion. A
    // Retry-After wait is owned by that URL/origin and must not consume one of
    // a small number of per-cell admission slots; otherwise six throttled
    // sources can prevent every later, unrelated origin in that case from
    // ever reaching the global transfer limiter.
    fetchedCells = await admitAllCellSources(cells, async (_cell, source) => {
      const result = await collector.fetchSource({
        source, productionRoot: fetchArtifactRoot, pool, transportPolicy, originLimiter,
        globalTransferLimiter, fetchCache
      });
      return fetchArtifactRoot === outputRoot ? result
        : bindSharedArtifactsToCampaign(result, fetchArtifactRoot, outputRoot);
    }, (cell, sources) => {
      const cellFile = path.join(outputRoot, "cells", cell.armId, cell.caseId, "sources.json");
      writeJsonExclusive(cellFile, { schemaVersion: 4, armId: cell.armId, caseId: cell.caseId,
        sourcePolicy: "arm_specific_no_union", productionArtifactSha256: sha256(fs.readFileSync(cell.artifactPath)),
        sources: sources.sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl)) });
      return { armId: cell.armId, caseId: cell.caseId, sources };
    });
  } finally {
    if (ownsPool) await pool.close();
  }
  const allSources = fetchedCells.flatMap((cell) => cell.sources);
  const invalid = allSources.filter((source) => source.outcome === "normalization_error");
  const summary = {
    schemaVersion: 4,
    campaign: campaign.name,
    sourcePolicy: "arm_specific_no_union",
    normalizerPath: NORMALIZER,
    normalizerSha256: sha256(fs.readFileSync(NORMALIZER)),
    runnerAuthority: runnerAuthority(),
    runtimeProvenance: runtimeProvenance(),
    schedulingPolicy: scheduler,
    transportPolicy,
    cells: cells.length,
    sourceRows: allSources.length,
    uniqueRequestUrls,
    outcomes: Object.fromEntries([...new Set(allSources.map((source) => source.outcome))].sort()
      .map((outcome) => [outcome, allSources.filter((source) => source.outcome === outcome).length])),
    invalidNormalizationCount: invalid.length,
    invalidNormalizations: invalid.map((source) => ({ sourceId: source.sourceId,
      requestedUrl: source.requestedUrl, error: source.error }))
  };
  writeJsonExclusive(path.join(outputRoot, "summary.json"), summary);
  if (invalid.length) {
    throw new Error(`${campaign.name}: ${invalid.length} invalid normalizations; evaluator admission is forbidden.`);
  }
  writeJsonExclusive(path.join(outputRoot, "NORMALIZATION_READY.json"), {
    schemaVersion: 1, status: "zero_invalid_normalizations", summarySha256: sha256(JSON.stringify(summary)),
    producerAuthoritySha256: summary.runnerAuthority.authoritySha256
  });
  return summary;
};

const main = async () => {
  if (!OUTPUT_BASE) throw new Error("OUTPUT_BASE is required.");
  // A comparison campaign must bind identical case IDs and request payloads.
  const prepared = discoverCampaignCells(campaigns);
  assertSameBattery(campaigns, prepared);
  if (DRY_RUN) {
    const results = await Promise.all(prepared.map(({ campaign, cells }) => runCampaign(campaign, {}, cells)));
    process.stdout.write(`${JSON.stringify({ dryRun: DRY_RUN, normalizer: NORMALIZER, campaigns: results }, null, 2)}\n`);
    return;
  }
  // Share exact-literal-URL transport/cache, pacing, and immutable
  // content-addressed snapshots. Each arm still writes a separate source
  // manifest and packet containing only URLs returned by that arm; URLs and
  // semantic judgments are never unioned. A single origin limiter also keeps
  // parallel arms from multiplying request rate against one public site.
  const shared = {
    originLimiter: new collector.OriginConcurrencyLimiter(collector.ORIGIN_CONCURRENCY),
    globalTransferLimiter: new collector.ConcurrencyLimiter(collector.GLOBAL_TRANSFER_CONCURRENCY),
    fetchCache: new collector.ExactRequestUrlFetchCache(),
    artifactRoot: path.join(OUTPUT_BASE, "_shared-exact-url-artifacts-v4"),
    pool: new normalizer.SemanticMarkdownWorkerPool({
      size: collector.NORMALIZATION_CONCURRENCY,
      timeoutMs: collector.NORMALIZATION_TIMEOUT_MS
    })
  };
  let results;
  try {
    results = await Promise.all(prepared.map(({ campaign, cells }) => runCampaign(campaign, shared, cells)));
  } finally {
    await shared.pool.close();
  }
  process.stdout.write(`${JSON.stringify({ dryRun: DRY_RUN, normalizer: NORMALIZER, campaigns: results }, null, 2)}\n`);
};

if (require.main === module) {
  assertAuthorizedComponentCli({ script: __filename,
    authoritySha256: evaluatorRunnerAuthority(__dirname).authoritySha256 });
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { admitAllCellSources, assertSameBattery, bindSharedArtifactsToCampaign,
  cellAdmissionConcurrency, configuredV4TransportPolicy, discoverCells,
  discoverAllCells, discoverCampaignCells, runCampaign, runtimeProvenance, schedulingPolicy };

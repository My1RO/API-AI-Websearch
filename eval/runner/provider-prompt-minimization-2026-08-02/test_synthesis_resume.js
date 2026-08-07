#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const synthesis = require("./run_bounded_synthesis.js");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const reseal = (artifact) => {
  const unsigned = { ...artifact };
  delete unsigned.sealSha256;
  return { ...unsigned, sealSha256: sha256(JSON.stringify(unsigned)) };
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const treeHashes = (root) => Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((item) => item.isFile()).map((item) => {
    const file = path.join(item.parentPath || item.path, item.name);
    return [path.relative(root, file), sha256(fs.readFileSync(file))];
  }).sort(([left], [right]) => left.localeCompare(right)));

const packet = {
  caseId: "H001",
  identityContext: { request: { npi: "1234567890", name: "Jane Doe" } },
  evaluationGate: null,
  evaluationGuidance: null,
  claims: [], preSanitizerCandidates: [],
  expectedFields: ["phone", "address", "website", "rating", "specialty"],
  actionTrace: { calls: [], annotations: [] }, sources: []
};
const merged = {
  status: "atomic_read_complete", invalidNormalizations: [], sourceCoverage: [],
  sourceAssessments: [], claimSourceAssessments: [], candidateSourceAssessments: [], evidence: []
};
const output = {
  sourceAssessments: [],
  identityAssessment: { npiEntity: "unreadable", nameMatch: "unreadable",
    requestedLocationMatch: "not_established", evidenceSpans: [], reason: "No returned evidence." },
  claimAssessments: [], candidateDecisionAssessments: [],
  fieldAssessments: packet.expectedFields.map((field, fieldIndex) => ({
    fieldIndex, topFactDisposition: field === "rating" ? "indeterminate" : "missing_no_eligible_arm_found_fact",
    crossNpiConflict: "none", requestedNpiResolution: "none",
    armFoundBestEligibleClass: field === "rating" ? "indeterminate" : "none",
    topSelectedClass: "none", hierarchyOpportunity: field === "rating" ? "indeterminate" : "no_cross_tier_choice",
    cmsHierarchyConditionalOutcome: "not_applicable",
    recencyOpportunity: field === "rating" ? "indeterminate" : "no_recency_choice",
    contractFidelity: "not_applicable", directoryComparison: "not_comparable",
    evidenceRefs: [], reason: "No returned fact." })),
  cmsRoleAssessment: { nppesIdentityTaxonomyUse: "not_applicable",
    directoryAuthorityTreatment: "not_applicable", contactConflictTreatment: "no_conflict",
    ratingSourceNeutrality: "not_applicable", reasons: [], evidenceRefs: [] },
  casePolicyAssessment: { listedValueTreatment: "not_applicable", evidenceRefs: [], reason: "No gate." },
  criticalFindings: [], findings: []
};

const makeItem = (dir) => {
  const input = synthesis.compactAtomicInput(packet, merged);
  return { armId: "A", caseId: "H001", dir, packet, plan: { input, request: { fixture: true } } };
};
const successfulRaw = () => ({ id: "resp_fixture", status: "completed", output_parsed: output,
  usage: { input_tokens: 10, output_tokens: 20 } });
assert.doesNotThrow(() => synthesis.validateSynthesisOutput(output, packet,
  synthesis.compactAtomicInput(packet, merged)));

const helperRoot = fs.mkdtempSync(path.join(os.tmpdir(), "synthesis-resume-helpers-"));
try {
  const missing = makeItem(path.join(helperRoot, "missing"));
  assert.equal(synthesis.inspectSynthesisResumeItem(missing).disposition, "retry");

  const orphan = makeItem(path.join(helperRoot, "orphan"));
  const firstFilteredUsage = { input_tokens: 3, output_tokens: 4 };
  writeJson(path.join(orphan.dir, "raw-response-semantic-01.json"), {
    id: "resp_filtered", status: "incomplete", incomplete_details: { reason: "content_filter" },
    usage: firstFilteredUsage
  });
  writeJson(path.join(orphan.dir, "raw-response-semantic-02.json"), successfulRaw());
  const orphanBefore = treeHashes(orphan.dir);
  const readOnly = synthesis.inspectSynthesisResumeItem(orphan, { readOnly: true });
  assert.equal(readOnly.disposition, "completed");
  assert.equal(readOnly.recoveredWithoutPaidCall, true);
  assert.deepEqual(treeHashes(orphan.dir), orphanBefore, "read-only recovery inventory must not materialize files");
  const recovered = synthesis.inspectSynthesisResumeItem(orphan);
  assert.equal(recovered.disposition, "completed");
  assert(fs.existsSync(path.join(orphan.dir, "parsed-v14.json")));
  assert(fs.existsSync(path.join(orphan.dir, "result.json")));
  const orphanResultFile = path.join(orphan.dir, "result.json");
  const orphanResultBytes = fs.readFileSync(orphanResultFile);
  const orphanResult = JSON.parse(orphanResultBytes);
  assert.equal(orphanResult.attempts.length, 2);
  assert.equal(orphanResult.retryPolicy.semanticAttemptsUsed, 2);
  assert.equal(orphanResult.totalEstimatedUsd,
    synthesis.estimateCost(firstFilteredUsage).estimatedUsd
      + synthesis.estimateCost(successfulRaw().usage).estimatedUsd,
  "orphan reconstruction must retain cost for every semantic response");
  const badDescriptor = { ...orphanResult,
    parsedArtifact: { ...orphanResult.parsedArtifact, sha256: "0".repeat(64) } };
  writeJson(orphanResultFile, badDescriptor);
  assert.throws(() => synthesis.inspectSynthesisResumeItem(orphan), /parsedArtifact descriptor/);
  const badAttempt = { ...orphanResult, attempts: orphanResult.attempts.map((attempt) => ({ ...attempt })) };
  badAttempt.attempts[1].responseId = "resp_wrong";
  writeJson(orphanResultFile, badAttempt);
  assert.throws(() => synthesis.inspectSynthesisResumeItem(orphan), /attempt metadata/);
  fs.writeFileSync(orphanResultFile, orphanResultBytes);
  assert.equal(synthesis.inspectSynthesisResumeItem(orphan).disposition, "completed");

  const malformed = makeItem(path.join(helperRoot, "malformed"));
  writeJson(path.join(malformed.dir, "raw-response-semantic-01.json"),
    { id: "resp_malformed", status: "completed", output_text: "not-json", usage: { input_tokens: 1 } });
  assert.equal(synthesis.inspectSynthesisResumeItem(malformed).disposition, "manual");

  const incomplete = makeItem(path.join(helperRoot, "incomplete"));
  writeJson(path.join(incomplete.dir, "raw-response-semantic-01.json"),
    { id: "resp_incomplete", status: "incomplete", incomplete_details: { reason: "content_filter" },
      usage: { input_tokens: 1 } });
  assert.equal(synthesis.inspectSynthesisResumeItem(incomplete).disposition, "manual");

  const responseBearing = makeItem(path.join(helperRoot, "response-bearing"));
  writeJson(path.join(responseBearing.dir, "result.json"), {
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", reason: "EVALUATOR_TRANSPORT_FAILURE",
    responseId: "resp_should_not_retry", usage: null, attempts: []
  });
  assert.equal(synthesis.inspectSynthesisResumeItem(responseBearing).disposition, "manual");

  const transport = makeItem(path.join(helperRoot, "transport"));
  const transportBytes = Buffer.from("{\n  \"status\": \"transport_error_after_native_retries\"\n}\n");
  fs.mkdirSync(transport.dir, { recursive: true });
  fs.writeFileSync(path.join(transport.dir, "transport-error.json"), transportBytes);
  writeJson(path.join(transport.dir, "result.json"), {
    status: "EVALUATOR_MANUAL_REVIEW_REQUIRED", reason: "EVALUATOR_TRANSPORT_FAILURE",
    attempts: [{ rawFile: "transport-error.json", responseId: null, usage: null }]
  });
  const transportInspection = synthesis.inspectSynthesisResumeItem(transport);
  assert.equal(transportInspection.disposition, "retry");
  const archived = synthesis.preservePreResumeSynthesisFailure(transportInspection);
  assert.equal(archived.priorAttempts[0].sha256, sha256(transportBytes));
  assert.deepEqual(fs.readFileSync(archived.priorAttempts[0].path), transportBytes,
    "transport failure archive must preserve exact bytes");
} finally {
  fs.rmSync(helperRoot, { recursive: true, force: true });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "synthesis-resume-campaign-"));
  const originalEnv = { ...process.env };
  try {
    const packetRoot = path.join(root, "packets");
    const atomicRoot = path.join(root, "atomic");
    const dryRoot = path.join(root, "dry");
    const liveRoot = path.join(root, "live");
    writeJson(path.join(packetRoot, "A", "H001", "packet.json"), packet);
    writeJson(path.join(packetRoot, "B", "H002", "packet.json"), { ...packet, caseId: "H002" });
    writeJson(path.join(packetRoot, "C", "H003", "packet.json"), { ...packet, caseId: "H003" });
    writeJson(path.join(packetRoot, "D", "H004", "packet.json"), { ...packet, caseId: "H004" });
    writeJson(path.join(atomicRoot, "cells", "A", "H001", "atomic-merged.json"), merged);
    writeJson(path.join(atomicRoot, "cells", "B", "H002", "atomic-merged.json"), merged);
    writeJson(path.join(atomicRoot, "cells", "C", "H003", "atomic-merged.json"), merged);
    writeJson(path.join(atomicRoot, "cells", "D", "H004", "atomic-merged.json"), merged);
    const tokenizerFile = path.join(root, "tokenizer.js");
    fs.writeFileSync(tokenizerFile,
      "module.exports.getEncoding = () => ({ encode: (value) => Array.from(value) });\n");
    const modulesRoot = path.join(root, "node_modules");
    fs.mkdirSync(path.join(modulesRoot, "openai", "helpers"), { recursive: true });
    fs.writeFileSync(path.join(modulesRoot, "openai", "helpers", "zod.js"),
      "module.exports.zodTextFormat = () => ({ type: 'json_schema', name: 'fixture', strict: true, schema: { type: 'object' } });\n");
    fs.writeFileSync(path.join(modulesRoot, "openai", "index.js"), `
      const fs = require("node:fs");
      module.exports.default = class FakeOpenAI {
        constructor() {
          if (process.env.FAKE_OPENAI_CONSTRUCTION_LOG) fs.appendFileSync(process.env.FAKE_OPENAI_CONSTRUCTION_LOG, "constructed\\n");
          this.responses = { create: async () => {
            if (process.env.FAKE_OPENAI_MODE === "transport") throw new Error("fixture transport failure");
            return JSON.parse(process.env.FAKE_OPENAI_RESPONSE);
          } };
        }
      };
    `);
    const constructionLog = path.join(root, "client-constructions.log");
    Object.assign(process.env, {
      PACKET_ROOT: packetRoot, ATOMIC_ROOT: atomicRoot,
      TOKENIZER_MODULES: tokenizerFile, PROVIDER_EVAL_NODE_MODULES: modulesRoot,
      FAKE_OPENAI_CONSTRUCTION_LOG: constructionLog,
      SOURCE_EVALUATOR_AUTHORITY_SHA256: evaluatorRunnerAuthority(__dirname).authoritySha256
    });
    delete process.env.RESUME;
    delete process.env.RESUME_INSPECT_ONLY;
    delete process.env.EXPECTED_SYNTHESIS_CELLS;
    process.env.DRY_RUN = "1";
    process.env.OUTPUT_ROOT = dryRoot;
    await synthesis.main();

    process.env.DRY_RUN = "0";
    process.env.OUTPUT_ROOT = liveRoot;
    process.env.EXPECTED_DRY_PLAN_SEAL = path.join(dryRoot, "CAMPAIGN_PLAN_SEAL.json");
    process.env.FAKE_OPENAI_MODE = "transport";
    await synthesis.main();
    const terminalManualDir = path.join(liveRoot, "cells", "A", "H001");
    const terminalRaw = { id: "resp_terminal_filter", status: "incomplete",
      incomplete_details: { reason: "content_filter" }, usage: { input_tokens: 7, output_tokens: 0 } };
    writeJson(path.join(terminalManualDir, "raw-response-semantic-01.json"), terminalRaw);
    writeJson(path.join(terminalManualDir, "result.json"), {
      schemaVersion: 1, status: "EVALUATOR_MANUAL_REVIEW_REQUIRED",
      disposition: "evaluator_sufficiency_exception_not_arm_failure",
      reason: "EVALUATOR_CONTENT_FILTER", responseId: terminalRaw.id, usage: terminalRaw.usage,
      attempts: [{ semanticAttempt: 1, rawFile: "raw-response-semantic-01.json",
        responseId: terminalRaw.id, responseStatus: terminalRaw.status, usage: terminalRaw.usage }]
    });
    const terminalResultHash = sha256(fs.readFileSync(path.join(terminalManualDir, "result.json")));
    const failedResultFile = path.join(liveRoot, "cells", "B", "H002", "result.json");
    const failedResultBytes = fs.readFileSync(failedResultFile);
    const orphanDir = path.join(liveRoot, "cells", "C", "H003");
    fs.unlinkSync(path.join(orphanDir, "result.json"));
    fs.unlinkSync(path.join(orphanDir, "transport-error.json"));
    writeJson(path.join(orphanDir, "raw-response-semantic-01.json"), successfulRaw());
    const corruptDir = path.join(liveRoot, "cells", "D", "H004");
    const corruptTransportResultBytes = fs.readFileSync(path.join(corruptDir, "result.json"));
    const corruptTransportBytes = fs.readFileSync(path.join(corruptDir, "transport-error.json"));
    await synthesis.executeSynthesisSemanticAttempts({
      client: { responses: { create: async () => successfulRaw() } },
      item: { armId: "D", caseId: "H004", dir: corruptDir,
        packet: { ...packet, caseId: "H004" },
        plan: { request: { fixture: true },
          input: synthesis.compactAtomicInput({ ...packet, caseId: "H004" }, merged) } }
    });
    const corruptResult = JSON.parse(fs.readFileSync(path.join(corruptDir, "result.json"), "utf8"));
    corruptResult.parsedArtifact.sha256 = "0".repeat(64);
    writeJson(path.join(corruptDir, "result.json"), corruptResult);

    process.env.RESUME = "1";
    process.env.EXPECTED_SYNTHESIS_CELLS = "4";
    const constructionsBeforeGlobalAdmission = fs.readFileSync(constructionLog, "utf8").trim().split("\n").length;
    await assert.rejects(synthesis.main(), /parsedArtifact descriptor/);
    assert.equal(fs.existsSync(path.join(orphanDir, "result.json")), false);
    assert.equal(fs.existsSync(path.join(orphanDir, "parsed-v14.json")), false,
      "live resume must inspect the entire tree before materializing an earlier successful orphan");
    assert.equal(fs.readFileSync(constructionLog, "utf8").trim().split("\n").length,
      constructionsBeforeGlobalAdmission, "failed global admission must not construct a provider client");
    fs.unlinkSync(path.join(corruptDir, "raw-response-semantic-01.json"));
    fs.unlinkSync(path.join(corruptDir, "parsed-v14.json"));
    fs.writeFileSync(path.join(corruptDir, "result.json"), corruptTransportResultBytes);
    fs.writeFileSync(path.join(corruptDir, "transport-error.json"), corruptTransportBytes);
    const beforeInspection = treeHashes(liveRoot);

    process.env.RESUME_INSPECT_ONLY = "1";
    await synthesis.main();
    assert.deepEqual(treeHashes(liveRoot), beforeInspection,
      "synthesis resume dry admission must be completely read-only");
    assert.equal(fs.readFileSync(constructionLog, "utf8").trim().split("\n").length, 1,
      "read-only inventory must not construct a second provider client");

    delete process.env.RESUME_INSPECT_ONLY;
    await assert.rejects(synthesis.main(), /remains retryable for 2 planned cells/,
      "a repeated response-free failure remains resumable without blocking the terminal manual cell");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(liveRoot, "summary.json"), "utf8"))
      .runtimeManualCaseIds, ["H001", "H002", "H004"]);
    assert.equal(sha256(fs.readFileSync(path.join(terminalManualDir, "result.json"))), terminalResultHash,
      "terminal response-bearing result must be preserved while another cell is retried");
    assert(fs.readdirSync(path.dirname(failedResultFile)).some((name) =>
      name.startsWith("result.pre-resume-")
        && sha256(fs.readFileSync(path.join(path.dirname(failedResultFile), name))) === sha256(failedResultBytes)),
    "the first response-free failure must remain archived after an interrupted resume");

    process.env.FAKE_OPENAI_MODE = "success";
    process.env.FAKE_OPENAI_RESPONSE = JSON.stringify(successfulRaw());
    await synthesis.main();
    const completion = JSON.parse(fs.readFileSync(path.join(liveRoot, "RESUME_COMPLETION_SEAL.json"), "utf8"));
    assert.equal(completion.expectedCellCount, 4);
    assert.equal(completion.completedCellCount, 3);
    assert.equal(completion.terminalManualCellCount, 1);
    assert.deepEqual(completion.terminalManualCaseIds, ["H001"]);
    assert.equal(completion.retriedCellCount, 2);
    assert.equal(completion.recoveredWithoutPaidCallCount, 1);
    assert.equal(completion.cellArtifacts.length, 4);
    assert.equal(completion.resultArtifacts.length, 4);
    assert.equal(fs.existsSync(path.join(liveRoot, "manual-review-required-runtime.json")), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(liveRoot, "manual-review-required-runtime.json"), "utf8"))
      .caseIds, ["H001"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(liveRoot, "summary.json"), "utf8"))
      .runtimeManualCaseIds, ["H001"]);
    assert.equal(sha256(fs.readFileSync(path.join(terminalManualDir, "result.json"))), terminalResultHash);
    const completedResultHash = sha256(fs.readFileSync(failedResultFile));
    const constructionsAfterResume = fs.readFileSync(constructionLog, "utf8").trim().split("\n").length;
    await synthesis.main();
    assert.equal(sha256(fs.readFileSync(failedResultFile)), completedResultHash,
      "idempotent resume must preserve completed result bytes");
    assert.equal(fs.readFileSync(constructionLog, "utf8").trim().split("\n").length, constructionsAfterResume,
      "completed idempotent resume must not construct a provider client");

    const staleSummary = JSON.parse(fs.readFileSync(path.join(liveRoot, "summary.json"), "utf8"));
    staleSummary.runtimeManualCaseIds = ["H999"];
    writeJson(path.join(liveRoot, "summary.json"), staleSummary);
    await synthesis.main();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(liveRoot, "summary.json"), "utf8"))
      .runtimeManualCaseIds, ["H001"], "idempotent completion must reconcile dynamic summary state");

    const completedResultBytes = fs.readFileSync(failedResultFile);
    const tamperedResult = JSON.parse(completedResultBytes);
    tamperedResult.completedAt = "2099-01-01T00:00:00.000Z";
    writeJson(failedResultFile, tamperedResult);
    await assert.rejects(synthesis.main(), /completion seal disagrees with current artifacts/,
      "idempotent resume must recompute the sealed result hash ledger");
    fs.writeFileSync(failedResultFile, completedResultBytes);

    const completionFile = path.join(liveRoot, "RESUME_COMPLETION_SEAL.json");
    const completionBytes = fs.readFileSync(completionFile);
    writeJson(completionFile, reseal({ ...completion, kind: "wrong_completion_kind" }));
    await assert.rejects(synthesis.main(), /completion seal disagrees with current artifacts/);
    writeJson(completionFile, reseal({ ...completion, expectedCellCount: 99 }));
    await assert.rejects(synthesis.main(), /completion seal disagrees with current artifacts/);
    fs.writeFileSync(completionFile, completionBytes);

    process.env.EXPECTED_SYNTHESIS_CELLS = "5";
    await assert.rejects(synthesis.main(), /cardinality differs from expectation/);
    process.env.EXPECTED_SYNTHESIS_CELLS = "4";
    const requestFile = path.join(liveRoot, "cells", "A", "H001", "request.json");
    const requestBytes = fs.readFileSync(requestFile);
    fs.appendFileSync(requestFile, " ");
    await assert.rejects(synthesis.main(), /request artifact differs/);
    fs.writeFileSync(requestFile, requestBytes);
    const planFile = path.join(liveRoot, "cells", "A", "H001", "synthesis-plan.json");
    const planBytes = fs.readFileSync(planFile);
    fs.appendFileSync(planFile, " ");
    await assert.rejects(synthesis.main(), /cell plan differs/);
    fs.writeFileSync(planFile, planBytes);
    const liveSealFile = path.join(liveRoot, "CAMPAIGN_PLAN_SEAL.json");
    const liveSealBytes = fs.readFileSync(liveSealFile);
    const driftedSeal = JSON.parse(liveSealBytes);
    driftedSeal.reason = "fixture drift";
    writeJson(liveSealFile, driftedSeal);
    await assert.rejects(synthesis.main(), /campaign plan seal is internally invalid/);
    fs.writeFileSync(liveSealFile, liveSealBytes);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write("synthesis resume tests passed\n");
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const planner = require("./evaluator_packet_planner.js");

const runRoot = process.argv[2];
const tokenizerModule = process.argv[3];
if (!runRoot || !tokenizerModule) {
  throw new Error("Usage: backtest_evaluator_packet_planner.js <judge-cells-root> <js-tiktoken-module-dir>");
}
const { getEncoding } = require(tokenizerModule);
const encoding = getEncoding("o200k_base");
const countTokens = (text) => encoding.encode(text).length;
const rows = [];
for (const armId of fs.readdirSync(runRoot)) {
  for (const caseId of fs.readdirSync(path.join(runRoot, armId))) {
    const dir = path.join(runRoot, armId, caseId);
    const packetFile = path.join(dir, "packet.json");
    const preflightFile = path.join(dir, "preflight.json");
    const requestFile = path.join(dir, "request.json");
    if (!fs.existsSync(packetFile) || (!fs.existsSync(preflightFile) && !fs.existsSync(requestFile))) continue;
    const packet = JSON.parse(fs.readFileSync(packetFile, "utf8"));
    const preflight = fs.existsSync(preflightFile)
      ? JSON.parse(fs.readFileSync(preflightFile, "utf8"))
      : { localEncodedTokens: countTokens(fs.readFileSync(requestFile, "utf8")), failureCode: null };
    const plan = planner.planEvidenceShards(packet, { countTokens, maximumSourceTokens: 200_000 });
    rows.push({
      armId,
      caseId,
      originalInputTokens: preflight.localEncodedTokens,
      originalOverflow: preflight.failureCode === "CONTEXT_OVERFLOW",
      sourceCount: packet.sources.length,
      shardCount: plan.manifest.shardCount,
      maximumShardSourceTokens: Math.max(0, ...plan.shards.map((shard) => shard.sourceTokens)),
      oversizeSourceCount: plan.manifest.oversizeSourceCount,
      oversizeSources: plan.manifest.oversizeSources.map((source) => ({
        sourceId: source.sourceId,
        url: source.url,
        serializedTokens: source.serializedTokens
      }))
    });
  }
}
rows.sort((left, right) => left.caseId.localeCompare(right.caseId) || left.armId.localeCompare(right.armId));
const summary = {
  cases: rows.length,
  originalOverflows: rows.filter((row) => row.originalOverflow).length,
  casesNeedingMultipleShards: rows.filter((row) => row.shardCount > 1).length,
  casesWithIndividuallyOversizeSources: rows.filter((row) => row.oversizeSourceCount > 0).length,
  totalShards: rows.reduce((sum, row) => sum + row.shardCount, 0),
  maximumShardSourceTokens: Math.max(0, ...rows.map((row) => row.maximumShardSourceTokens)),
  rows
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

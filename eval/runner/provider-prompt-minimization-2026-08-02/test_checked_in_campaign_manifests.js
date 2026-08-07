#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluatorRunnerAuthority } = require("./evaluator_runner_authority.js");

const authority = evaluatorRunnerAuthority(__dirname).authoritySha256;
for (const [name, datasetRole] of [
  ["citation-metadata-privacy-development-full-evaluator.manifest.json", "development"],
  ["citation-metadata-privacy-holdout-full-evaluator-compile-erratum-v1.manifest.json", "sealed_holdout"]
]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
  assert.match(manifest.status, /^authorized_(development|holdout)_evaluation$/);
  assert.equal(manifest.datasetRole, datasetRole);
  assert.equal(manifest.runtime.evaluatorAuthoritySha256, authority);
  assert.match(manifest.protocolSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.caseBatterySha256, /^[a-f0-9]{64}$/);
}

process.stdout.write("checked-in final campaign manifest audit tests passed\n");

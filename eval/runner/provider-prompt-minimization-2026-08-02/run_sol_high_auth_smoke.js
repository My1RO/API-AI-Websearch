#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { estimateCost } = require("./run_atomic_evaluator.js");

const outputRoot = "/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/contact-resolution-successor-sol-high-auth-smoke-v1";
const keyFile = "/Users/kui/lucie_api_key.txt";
const baseURL = "https://foundry-lucie-ai.openai.azure.com/openai/v1";
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
};

const main = async () => {
  if (fs.existsSync(outputRoot)) throw new Error(`Fresh smoke output already exists: ${outputRoot}`);
  const apiKey = fs.readFileSync(keyFile, "utf8").trim();
  if (!apiKey) throw new Error("Provisioned Azure key file is empty.");
  const OpenAI = require(path.join(process.env.PROVIDER_EVAL_NODE_MODULES, "openai")).default;
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 180_000 });
  const request = {
    model: "gpt-5.6-sol",
    reasoning: { effort: "high" },
    input: [{ role: "user", content: [{ type: "input_text", text: "Return status ok." }] }],
    text: { format: { type: "json_schema", name: "auth_smoke", strict: true,
      schema: { type: "object", additionalProperties: false, required: ["status"],
        properties: { status: { type: "string", enum: ["ok"] } } } } },
    max_output_tokens: 256,
    store: false
  };
  writeJson(path.join(outputRoot, "request.json"), request);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const response = await client.responses.create(request);
  const completedAt = new Date().toISOString();
  writeJson(path.join(outputRoot, "raw-response.json"), response);
  const parsed = JSON.parse(response.output_text);
  const summary = {
    schemaVersion: 1,
    status: response.status === "completed" && parsed.status === "ok" ? "passed" : "failed",
    modelRequested: request.model,
    modelReturned: response.model || null,
    reasoningEffort: request.reasoning.effort,
    structuredOutputStrict: request.text.format.strict,
    responseId: response.id || null,
    responseStatus: response.status || null,
    startedAt,
    completedAt,
    durationMs: Date.now() - started,
    usage: response.usage || null,
    estimatedCost: estimateCost(response.usage)
  };
  writeJson(path.join(outputRoot, "summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.status !== "passed") process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

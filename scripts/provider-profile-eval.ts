import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  aggregateScores,
  EvalObservation,
  pollProviderProfileJob,
  ProviderEvalCase,
  providerEvalCaseSchema,
  repeatVariance,
  scoreCase
} from "../src/eval/provider-profile-eval";

const argumentsList = process.argv.slice(2);
const command = argumentsList.shift();

const option = (name: string, required = true): string | undefined => {
  const index = argumentsList.indexOf(`--${name}`);
  const value = index >= 0 ? argumentsList[index + 1] : undefined;
  if (required && !value) {
    throw new Error(`--${name} is required`);
  }
  return value;
};

const readJsonLines = <T>(path: string): T[] => readFileSync(path, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line) as T);

const readCases = (path: string): ProviderEvalCase[] => readJsonLines<unknown>(path)
  .map((value) => providerEvalCaseSchema.parse(value));

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const validate = (): void => {
  const casesPath = option("cases") as string;
  const cases = readCases(casesPath);
  process.stdout.write(`Validated ${cases.length} locked provider evaluation cases from ${basename(casesPath)}.\n`);
};

const run = async (): Promise<void> => {
  if (process.env.PROVIDER_EVAL_LIVE !== "true") {
    throw new Error("Set PROVIDER_EVAL_LIVE=true to authorize calls to the configured current provider-profile API.");
  }
  const cases = readCases(option("cases") as string);
  const apiBase = option("api-base") as string;
  const repeats = Number(option("repeats", false) || "3");
  const out = option("out") as string;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) {
    throw new Error("--repeats must be an integer from 1 through 10");
  }
  mkdirSync(out, { recursive: true });
  const headers: Record<string, string> = {};
  if (process.env.PROVIDER_EVAL_AUTHORIZATION) headers.authorization = process.env.PROVIDER_EVAL_AUTHORIZATION;
  if (process.env.PROVIDER_EVAL_ORIGIN) headers.origin = process.env.PROVIDER_EVAL_ORIGIN;
  if (process.env.PROVIDER_EVAL_SUBDOMAIN) headers["Lifecycle-Subdomain"] = process.env.PROVIDER_EVAL_SUBDOMAIN;

  for (const evalCase of cases) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      let observation: EvalObservation;
      try {
        observation = await pollProviderProfileJob({
          apiBase,
          request: evalCase.request,
          caseId: evalCase.caseId,
          repeat,
          headers
        });
      } catch (error) {
        const timestamp = new Date().toISOString();
        observation = {
          schemaVersion: 1,
          caseId: evalCase.caseId,
          repeat,
          startedAt: timestamp,
          completedAt: timestamp,
          latencyMs: 0,
          terminalStatus: "failed",
          errorCode: error instanceof Error ? error.message.slice(0, 120) : "unknown_error"
        };
      }
      writeJson(join(out, `${evalCase.caseId}-r${repeat}.json`), observation);
      process.stdout.write(`${evalCase.caseId} repeat ${repeat}: ${observation.terminalStatus}\n`);
    }
  }
};

const score = (): void => {
  const cases = readCases(option("cases") as string);
  const observationManifest = option("observations") as string;
  const out = option("out") as string;
  const observationPaths = readFileSync(observationManifest, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const observations = observationPaths.map((path) => JSON.parse(readFileSync(path, "utf8")) as EvalObservation);
  const caseIndex = new Map(cases.map((evalCase) => [evalCase.caseId, evalCase]));
  const hmacKey = process.env.PROVIDER_EVAL_HMAC_KEY;
  const scores = observations.map((observation) => {
    const evalCase = caseIndex.get(observation.caseId);
    if (!evalCase) throw new Error(`Observation references unknown case ${observation.caseId}`);
    return scoreCase(evalCase, observation, { hmacKey });
  });
  mkdirSync(out, { recursive: true });
  writeJson(join(out, "case-scores.json"), scores);
  writeJson(join(out, "aggregate.json"), aggregateScores(scores));
  writeJson(join(out, "repeat-variance.json"), repeatVariance(observations));
};

const main = async (): Promise<void> => {
  if (command === "validate") return validate();
  if (command === "run") return run();
  if (command === "score") return score();
  throw new Error("Usage: provider-profile-eval <validate|run|score> [options]");
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Provider evaluation failed"}\n`);
  process.exitCode = 1;
});

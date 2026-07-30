import { env } from "../../config/env";

export type AiProviderAttempt = "initial" | "full_retry" | "identity_retry";
export type AiProviderRetryReason = "content_filter_full_retry" | "malformed_identity_retry";
export type AiProviderAttemptOutcome = "completed" | "incomplete" | "malformed" | "refusal" | "request_error";

interface UnknownRecord {
  [key: string]: unknown;
}

export interface AiResponseUsage {
  usagePresent: boolean;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  uncachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  webSearchCalls: number;
}

export interface AiCostRateCard {
  inputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  webSearchUsdPerThousand?: number;
  pricingVersion?: string;
}

export interface AiEstimatedCost {
  estimated: boolean;
  pricingVersion: string | null;
  inputUsd: number | null;
  cachedInputUsd: number | null;
  outputUsd: number | null;
  cacheWriteUsd: number | null;
  webSearchUsd: number | null;
  totalUsd: number | null;
}

export interface AiProviderUsageRecord extends AiResponseUsage, AiEstimatedCost {
  provider: "azure";
  model: string;
  operation: "provider_profile_search";
  attempt: AiProviderAttempt;
  retryReason: AiProviderRetryReason | null;
  outcome: AiProviderAttemptOutcome;
  durationMs: number;
  semanticAttemptId: string | null;
  transportHttpAttemptCount: number;
  transportRetryCount: number;
}

const asRecord = (value: unknown): UnknownRecord | undefined => (
  value !== null && typeof value === "object" ? value as UnknownRecord : undefined
);

const tokenValue = (value: unknown): number | null => (
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
);

const roundUsd = (value: number): number => Number(value.toFixed(12));

export const extractAiResponseUsage = (response: unknown): AiResponseUsage => {
  const responseRecord = asRecord(response);
  const usage = asRecord(responseRecord?.usage);
  const inputDetails = asRecord(usage?.input_tokens_details);
  const outputDetails = asRecord(usage?.output_tokens_details);
  const inputTokens = tokenValue(usage?.input_tokens);
  const cachedInputTokens = tokenValue(inputDetails?.cached_tokens);
  const uncachedInputTokens = inputTokens !== null && cachedInputTokens !== null && cachedInputTokens <= inputTokens
    ? inputTokens - cachedInputTokens
    : null;
  const output = Array.isArray(responseRecord?.output) ? responseRecord.output : [];

  return {
    usagePresent: Boolean(usage),
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    cacheWriteTokens: tokenValue(inputDetails?.cache_write_tokens),
    outputTokens: tokenValue(usage?.output_tokens),
    reasoningOutputTokens: tokenValue(outputDetails?.reasoning_tokens),
    totalTokens: tokenValue(usage?.total_tokens),
    webSearchCalls: output.filter((item) => asRecord(item)?.type === "web_search_call").length
  };
};

export const estimateAiResponseCost = (
  usage: AiResponseUsage,
  rates: AiCostRateCard
): AiEstimatedCost => {
  const standardInputTokens = usage.uncachedInputTokens !== null && usage.cacheWriteTokens !== null
    ? usage.cacheWriteTokens <= usage.uncachedInputTokens
      ? usage.uncachedInputTokens - usage.cacheWriteTokens
      : null
    : usage.uncachedInputTokens;
  const inputUsd = componentCost(standardInputTokens, rates.inputUsdPerMillion, 1_000_000);
  const cachedInputUsd = componentCost(usage.cachedInputTokens, rates.cachedInputUsdPerMillion, 1_000_000);
  const outputUsd = componentCost(usage.outputTokens, rates.outputUsdPerMillion, 1_000_000);
  const cacheWriteUsd = optionalComponentCost(
    usage.cacheWriteTokens,
    rates.cacheWriteUsdPerMillion,
    1_000_000
  );
  const webSearchUsd = componentCost(usage.webSearchCalls, rates.webSearchUsdPerThousand, 1_000);
  const components = [inputUsd, cachedInputUsd, outputUsd, cacheWriteUsd, webSearchUsd];
  const estimated = usage.usagePresent
    && Boolean(rates.pricingVersion)
    && components.every((component) => component !== null);

  return {
    estimated,
    pricingVersion: estimated && rates.pricingVersion ? rates.pricingVersion : null,
    inputUsd,
    cachedInputUsd,
    outputUsd,
    cacheWriteUsd,
    webSearchUsd,
    totalUsd: estimated
      ? roundUsd(components.reduce<number>((sum, component) => sum + (component as number), 0))
      : null
  };
};

const componentCost = (
  units: number | null,
  rate: number | undefined,
  divisor: number
): number | null => (
  units !== null && rate !== undefined ? roundUsd((units * rate) / divisor) : null
);

const optionalComponentCost = (
  units: number | null,
  rate: number | undefined,
  divisor: number
): number | null => {
  if (units === null || units === 0) {
    return 0;
  }

  return componentCost(units, rate, divisor);
};

export const recordAiProviderUsage = ({
  model,
  attempt,
  retryReason = null,
  outcome,
  durationMs,
  response,
  semanticAttemptId = null,
  transportHttpAttemptCount = 0,
  transportRetryCount = 0
}: {
  model: string;
  attempt: AiProviderAttempt;
  retryReason?: AiProviderRetryReason | null;
  outcome: AiProviderAttemptOutcome;
  durationMs: number;
  response?: unknown;
  semanticAttemptId?: string | null;
  transportHttpAttemptCount?: number;
  transportRetryCount?: number;
}): AiProviderUsageRecord => {
  const usage = extractAiResponseUsage(response);
  const cost = estimateAiResponseCost(usage, env.aiCostRates);
  const record: AiProviderUsageRecord = {
    provider: "azure",
    model,
    operation: "provider_profile_search",
    attempt,
    retryReason,
    outcome,
    durationMs: Math.max(0, Math.round(durationMs)),
    semanticAttemptId,
    transportHttpAttemptCount: Math.max(0, Math.round(transportHttpAttemptCount)),
    transportRetryCount: Math.max(0, Math.round(transportRetryCount)),
    ...usage,
    ...cost
  };

  console.log("AI provider usage telemetry", record);
  return record;
};

const sumKnown = (
  records: AiProviderUsageRecord[],
  field: keyof AiResponseUsage
): number | null => {
  const values = records.map((record) => record[field]);
  return values.every((value) => typeof value === "number")
    ? (values as number[]).reduce((sum, value) => sum + value, 0)
    : null;
};

export const logAiProviderSearchSummary = (
  records: AiProviderUsageRecord[],
  outcome: "completed" | "failed",
  durationMs: number
): void => {
  if (records.length === 0) {
    return;
  }

  const totalCosts = records.map((record) => record.totalUsd);
  const estimated = totalCosts.every((cost) => cost !== null);
  const transportHttpAttemptCount = records.reduce(
    (sum, record) => sum + record.transportHttpAttemptCount,
    0
  );
  const transportRetryCount = records.reduce((sum, record) => sum + record.transportRetryCount, 0);

  console.log("AI provider search telemetry", {
    provider: records[0].provider,
    model: records[0].model,
    operation: "provider_profile_search",
    outcome,
    durationMs: Math.max(0, Math.round(durationMs)),
    attemptCount: records.length,
    fullRetryCount: records.filter((record) => record.attempt === "full_retry").length,
    identityRetryCount: records.filter((record) => record.attempt === "identity_retry").length,
    retryReasons: [...new Set(
      records
        .map((record) => record.retryReason)
        .filter((reason): reason is AiProviderRetryReason => reason !== null)
    )],
    usageMissingAttempts: records.filter((record) => !record.usagePresent).length,
    inputTokens: sumKnown(records, "inputTokens"),
    cachedInputTokens: sumKnown(records, "cachedInputTokens"),
    uncachedInputTokens: sumKnown(records, "uncachedInputTokens"),
    cacheWriteTokens: sumKnown(records, "cacheWriteTokens"),
    outputTokens: sumKnown(records, "outputTokens"),
    reasoningOutputTokens: sumKnown(records, "reasoningOutputTokens"),
    totalTokens: sumKnown(records, "totalTokens"),
    webSearchCalls: records.reduce((sum, record) => sum + record.webSearchCalls, 0),
    estimated,
    pricingVersion: estimated ? records[0].pricingVersion : null,
    totalUsd: estimated
      ? roundUsd((totalCosts as number[]).reduce((sum, cost) => sum + cost, 0))
      : null,
    initialSdkMaxRetries: 1,
    semanticRetrySdkMaxRetries: 0,
    maxHttpAttempts: 3,
    transportHttpAttemptCount,
    transportRetryCount,
    transportRetryUsageObservable: transportHttpAttemptCount > 0
  });
};

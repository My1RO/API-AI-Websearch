"use strict";

const asRecord = (value) => value !== null && typeof value === "object" ? value : undefined;
const tokenValue = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const roundUsd = (value) => Number(value.toFixed(12));
const componentCost = (units, rate, divisor) => units !== null && rate !== undefined
  ? roundUsd((units * rate) / divisor) : null;
const optionalComponentCost = (units, rate, divisor) => {
  if (units === null || units === 0) return 0;
  return componentCost(units, rate, divisor);
};

const extractAiResponseUsage = (response) => {
  const responseRecord = asRecord(response);
  const usage = asRecord(responseRecord?.usage);
  const inputDetails = asRecord(usage?.input_tokens_details);
  const outputDetails = asRecord(usage?.output_tokens_details);
  const inputTokens = tokenValue(usage?.input_tokens);
  const cachedInputTokens = tokenValue(inputDetails?.cached_tokens);
  const uncachedInputTokens = inputTokens !== null && cachedInputTokens !== null
    && cachedInputTokens <= inputTokens ? inputTokens - cachedInputTokens : null;
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

const estimateAiResponseCost = (usage, rates) => {
  const standardInputTokens = usage.uncachedInputTokens !== null && usage.cacheWriteTokens !== null
    ? usage.cacheWriteTokens <= usage.uncachedInputTokens
      ? usage.uncachedInputTokens - usage.cacheWriteTokens : null
    : usage.uncachedInputTokens;
  const inputUsd = componentCost(standardInputTokens, rates.inputUsdPerMillion, 1_000_000);
  const cachedInputUsd = componentCost(usage.cachedInputTokens, rates.cachedInputUsdPerMillion, 1_000_000);
  const outputUsd = componentCost(usage.outputTokens, rates.outputUsdPerMillion, 1_000_000);
  const cacheWriteUsd = optionalComponentCost(
    usage.cacheWriteTokens, rates.cacheWriteUsdPerMillion, 1_000_000);
  const webSearchUsd = componentCost(usage.webSearchCalls, rates.webSearchUsdPerThousand, 1_000);
  const components = [inputUsd, cachedInputUsd, outputUsd, cacheWriteUsd, webSearchUsd];
  const estimated = usage.usagePresent && Boolean(rates.pricingVersion)
    && components.every((component) => component !== null);
  return {
    estimated,
    pricingVersion: estimated ? rates.pricingVersion : null,
    inputUsd,
    cachedInputUsd,
    outputUsd,
    cacheWriteUsd,
    webSearchUsd,
    totalUsd: estimated
      ? roundUsd(components.reduce((sum, component) => sum + component, 0)) : null
  };
};

module.exports = { estimateAiResponseCost, extractAiResponseUsage };

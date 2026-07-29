const {
  estimateAiResponseCost,
  extractAiResponseUsage
} = require("../src/services/ai-provider/usage-telemetry");

describe("AI response usage and cost telemetry", () => {
  it("normalizes input, cached, uncached, cache-write, output, reasoning, and web-search usage", () => {
    expect(extractAiResponseUsage({
      usage: {
        input_tokens: 1_000,
        input_tokens_details: {
          cached_tokens: 200,
          cache_write_tokens: 50
        },
        output_tokens: 100,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 1_100
      },
      output: [
        { type: "web_search_call" },
        { type: "message" },
        { type: "web_search_call" }
      ]
    })).toEqual({
      usagePresent: true,
      inputTokens: 1_000,
      cachedInputTokens: 200,
      uncachedInputTokens: 800,
      cacheWriteTokens: 50,
      outputTokens: 100,
      reasoningOutputTokens: 20,
      totalTokens: 1_100,
      webSearchCalls: 2
    });
  });

  it("prices cached input separately and does not double-charge reasoning tokens", () => {
    const usage = extractAiResponseUsage({
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens: 100,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 1_100
      },
      output: [{ type: "web_search_call" }, { type: "web_search_call" }]
    });

    expect(estimateAiResponseCost(usage, {
      inputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 15,
      webSearchUsdPerThousand: 10,
      pricingVersion: "test-rates"
    })).toEqual({
      estimated: true,
      pricingVersion: "test-rates",
      inputUsd: 0.002,
      cachedInputUsd: 0.00005,
      outputUsd: 0.0015,
      cacheWriteUsd: 0,
      webSearchUsd: 0.02,
      totalUsd: 0.02355
    });
  });

  it("prices cache writes instead of also charging them as ordinary uncached input", () => {
    const usage = extractAiResponseUsage({
      usage: {
        input_tokens: 1_000,
        input_tokens_details: {
          cached_tokens: 200,
          cache_write_tokens: 50
        },
        output_tokens: 100,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 1_100
      }
    });

    expect(estimateAiResponseCost(usage, {
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      cacheWriteUsdPerMillion: 3,
      outputUsdPerMillion: 10,
      webSearchUsdPerThousand: 10,
      pricingVersion: "test-cache-write-rates"
    })).toEqual({
      estimated: true,
      pricingVersion: "test-cache-write-rates",
      inputUsd: 0.0015,
      cachedInputUsd: 0.00004,
      outputUsd: 0.001,
      cacheWriteUsd: 0.00015,
      webSearchUsd: 0,
      totalUsd: 0.00269
    });
  });

  it("keeps cost non-authoritative when usage or rates are missing or inconsistent", () => {
    const usage = extractAiResponseUsage({
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 101 },
        output_tokens: -1,
        total_tokens: 100.5
      }
    });

    expect(usage).toEqual(expect.objectContaining({
      usagePresent: true,
      inputTokens: 100,
      cachedInputTokens: 101,
      uncachedInputTokens: null,
      outputTokens: null,
      totalTokens: null,
      webSearchCalls: 0
    }));
    expect(estimateAiResponseCost(usage, {})).toEqual(expect.objectContaining({
      estimated: false,
      pricingVersion: null,
      totalUsd: null
    }));
  });

  it("requires a versioned rate card before publishing a total estimate", () => {
    const usage = extractAiResponseUsage({
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 2,
        total_tokens: 12
      }
    });

    expect(estimateAiResponseCost(usage, {
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 1,
      outputUsdPerMillion: 1,
      webSearchUsdPerThousand: 1
    })).toEqual(expect.objectContaining({
      estimated: false,
      pricingVersion: null,
      totalUsd: null
    }));
  });
});

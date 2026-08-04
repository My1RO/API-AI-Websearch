const mockCreateResponse = jest.fn();
const mockOpenAIConstructor = jest.fn().mockImplementation(() => ({
  responses: {
    create: mockCreateResponse
  }
}));
const ORIGINAL_ENV = process.env;
let consoleLogSpy;
const nativeRefusalFixture = require("./fixtures/azure-native-refusal/contract-example.json");
const auditedCompletionFilterFixtures = [
  {
    name: "confirmatory-v2 V0/P049",
    response: require("./fixtures/azure-content-filter/v0-p049.json"),
    expectedOutputTypes: ["web_search_call", "reasoning", "web_search_call", "message"],
    expectedUsage: {
      inputTokens: 10353,
      cachedInputTokens: 6144,
      uncachedInputTokens: 4209,
      outputTokens: 142,
      reasoningOutputTokens: 142,
      totalTokens: 10495,
      webSearchCalls: 2,
      totalUsd: 0.0341885
    }
  },
  {
    name: "confirmatory-v2 V1/P056",
    response: require("./fixtures/azure-content-filter/v1-p056.json"),
    expectedOutputTypes: ["web_search_call", "message"],
    expectedUsage: {
      inputTokens: 6763,
      cachedInputTokens: 5120,
      uncachedInputTokens: 1643,
      outputTokens: 43,
      reasoningOutputTokens: 43,
      totalTokens: 6806,
      webSearchCalls: 1,
      totalUsd: 0.0160325
    }
  }
];

jest.mock("openai", () => ({
  __esModule: true,
  default: mockOpenAIConstructor
}));

const loadClient = (overrides = {}) => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    AZURE_OPENAI_API_KEY: "test-azure-key",
    AZURE_OPENAI_DEPLOYMENT: "gpt-5.4",
    AZURE_OPENAI_ENDPOINT: "https://azure.example.openai.azure.com",
    AI_WEBSEARCH_TOOL_CHOICE: "required",
    AI_WEBSEARCH_MAX_TOOL_CALLS: "8",
    AI_WEBSEARCH_PARALLEL_TOOL_CALLS: "true",
    AI_REASONING_EFFORT: "medium",
    AI_WEBSEARCH_ALLOWED_DOMAINS: "",
    AI_WEBSEARCH_BLOCKED_DOMAINS: "",
    AI_COST_INPUT_USD_PER_MILLION: "",
    AI_COST_CACHED_INPUT_USD_PER_MILLION: "",
    AI_COST_OUTPUT_USD_PER_MILLION: "",
    AI_COST_CACHE_WRITE_USD_PER_MILLION: "",
    AI_COST_WEB_SEARCH_USD_PER_THOUSAND: "",
    AI_COST_PRICING_VERSION: "",
    ...overrides
  };

  return require("../src/services/ai-provider/responses-provider.client");
};

const citedProfileResponse = profiles => {
  const strictProfiles = profiles.map(profile => {
    const sourcesById = new Map((profile.sources || []).map(source => [source.id, source]));
    const citation = (sourceId, factSpan) => {
      const source = sourcesById.get(sourceId);
      return {
        sourceUrl: source?.url || "https://npiprofile.com/provider/123",
        sourceTitle: source?.title || null,
        providerIdentitySpan: profile.providerName,
        factSpan,
        explicitFactDateSpan: null
      };
    };
    const sourcedValue = value => ({
      value: value.value,
      citation: citation(value.sourceId, value.value)
    });

    return {
      providerId: profile.providerId ?? null,
      npi: profile.npi ?? null,
      providerName: profile.providerName,
      specialties: (profile.specialties || []).map(sourcedValue),
      locations: (profile.locations || []).map(location => ({
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2 ?? null,
        city: location.city ?? null,
        state: location.state ?? null,
        zip: location.zip ?? null,
        citation: citation(location.sourceId, [
          location.addressLine1,
          location.addressLine2,
          location.city,
          location.state,
          location.zip
        ].filter(Boolean).join(" "))
      })),
      phoneNumbers: (profile.phoneNumbers || []).map(sourcedValue),
      websites: (profile.websites || []).map(sourcedValue)
    };
  });
  const outputText = JSON.stringify({ profiles: strictProfiles });
  const openedUrls = [...new Set(strictProfiles.flatMap(profile => [
    ...profile.specialties,
    ...profile.locations,
    ...profile.phoneNumbers,
    ...profile.websites
  ].map(fact => fact.citation.sourceUrl)))];
  return {
    status: "completed",
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 25 },
      output_tokens: 10,
      output_tokens_details: { reasoning_tokens: 4 },
      total_tokens: 110
    },
    output_parsed: { profiles: strictProfiles },
    output_text: outputText,
    output: [
      ...openedUrls.map(url => ({
        type: "web_search_call",
        action: { type: "open_page", url }
      })),
      {
      type: "message",
      content: [{
        type: "output_text",
        text: outputText,
        annotations: [{
          type: "url_citation",
          url: "https://npiprofile.com/provider/123"
        }]
      }]
      }
    ]
  };
};

const successfulProfileResponse = () => citedProfileResponse([
  {
    providerId: "provider-123",
    providerName: "Public Provider",
    specialties: [],
    locations: [],
    phoneNumbers: [{ value: "2164442200", sourceId: "src-1" }],
    ratings: [],
    confidenceNotes: [],
    sources: [{
      id: "src-1",
      title: "Public directory",
      domain: "npiprofile.com",
      url: "https://npiprofile.com/provider/123"
    }]
  }
]);

const completionContentFilter = (usage = undefined) => ({
  status: "incomplete",
  incomplete_details: { reason: "content_filter" },
  content_filters: [{
    blocked: true,
    source_type: "completion",
    content_filter_results: {
      protected_material_text: { detected: true, filtered: true }
    }
  }],
  ...(usage ? { usage } : {})
});

describe("Azure OpenAI Responses client privacy contract", () => {
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockCreateResponse.mockReset();
    mockOpenAIConstructor.mockClear();
    mockCreateResponse.mockResolvedValue(successfulProfileResponse());
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it.each(auditedCompletionFilterFixtures)(
    "retains the audited Azure completion-filter shape for $name",
    ({ response, expectedOutputTypes, expectedUsage }) => {
      expect(response).toEqual(expect.objectContaining({
        object: "response",
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
        output_text: "I'm sorry, but I cannot assist with that request.",
        usage: {
          input_tokens: expectedUsage.inputTokens,
          input_tokens_details: { cached_tokens: expectedUsage.cachedInputTokens },
          output_tokens: expectedUsage.outputTokens,
          output_tokens_details: { reasoning_tokens: expectedUsage.reasoningOutputTokens },
          total_tokens: expectedUsage.totalTokens
        }
      }));
      expect(response.content_filters.map(filter => [filter.source_type, filter.blocked])).toEqual([
        ["prompt", false],
        ["completion", true]
      ]);
      expect(response.content_filters[1]).toEqual(expect.objectContaining({
        content_filter_results: expect.objectContaining({
          protected_material_text: { detected: true, filtered: true }
        }),
        content_filter_offsets: expect.objectContaining({
          start_offset: expect.any(Number),
          end_offset: expect.any(Number),
          check_offset: expect.any(Number)
        })
      }));
      expect(response.output.map(item => item.type)).toEqual(expectedOutputTypes);
      const webSearchCalls = response.output.filter(item => item.type === "web_search_call");
      expect(webSearchCalls.map(item => item.status)).toEqual(webSearchCalls.map(() => "completed"));
      for (const reasoning of response.output.filter(item => item.type === "reasoning")) {
        expect(reasoning).not.toHaveProperty("status");
      }
      const message = response.output.find(item => item.type === "message");
      expect(message).toEqual(expect.objectContaining({
        status: "incomplete",
        content: [{
          type: "output_text",
          annotations: [],
          logprobs: [],
          text: "I'm sorry, but I cannot assist with that request."
        }]
      }));
      expect(message.content).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "refusal" })
      ]));
    }
  );

  it("uses only the normalized Azure OpenAI Responses endpoint", async () => {
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(mockOpenAIConstructor).toHaveBeenCalledWith({
      apiKey: "test-azure-key",
      baseURL: "https://azure.example.openai.azure.com/openai/v1",
      maxRetries: 1,
      fetch: expect.any(Function)
    });
    expect(mockCreateResponse).toHaveBeenCalledTimes(1);

    const request = mockCreateResponse.mock.calls[0][0];
    expect(mockCreateResponse.mock.calls[0][1]).toEqual({ maxRetries: 1 });
    expect(request).toEqual(
      expect.objectContaining({
        model: "gpt-5.4",
        tool_choice: "required",
        max_tool_calls: 8,
        parallel_tool_calls: true,
        include: ["web_search_call.action.sources"],
        store: false,
        reasoning: { effort: "medium" }
      })
    );
    expect(request.tools).toEqual([{ type: "web_search" }]);
    expect(request.text.format).toEqual(expect.objectContaining({
      type: "json_schema",
      name: "provider_profiles",
      strict: true
    }));
    expect(JSON.stringify(request.text.format)).toMatch(/Verified professional location/i);
    expect(JSON.stringify(request.text.format)).toMatch(/Professional voice number/i);
    expect(JSON.stringify(request.text.format)).toMatch(/providerIdentitySpan/);
    expect(JSON.stringify(request.text.format)).toMatch(/factSpan/);
    expect(JSON.stringify(request.text.format)).toMatch(/explicitFactDateSpan/);
    expect(JSON.stringify(request.text.format)).toMatch(/factSpan.*complete value/i);
    expect(JSON.stringify(request.text.format)).not.toMatch(/sourceId|"sources"/);
    expect(JSON.stringify(request.text.format)).not.toMatch(/insurance|payer|health.?plan|network|coverage/i);
    expect(request.instructions).not.toMatch(/return json|citation annotations|citation payloads/i);
    expect(request.instructions).toMatch(/Never search for or return insurance, payer, plan\/network\/coverage\/enrollment/i);
    expect(request.instructions).toMatch(/professional voice number/i);
    expect(request.instructions).toMatch(/uncertain-purpose/i);
    expect(request.instructions).toMatch(/professional office, practice, clinic, facility, or hospital location/i);
    expect(request.input).not.toMatch(/return json/i);
    expect(JSON.stringify(request)).not.toMatch(/web_search_preview|background":true|store":true/i);
    expect(request.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider request metadata",
      expect.objectContaining({
        provider: "azure",
        model: "gpt-5.4",
        toolType: "web_search",
        toolChoice: "required",
        store: false,
        maxToolCalls: 8,
        parallelToolCalls: true,
        reasoningEffort: "medium"
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/Public Provider|provider-123|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it.each(["", "https://api.openai.com/v1", "https://example.invalid/openai/v1"])(
    "fails before constructing the SDK client for endpoint %p",
    async endpoint => {
      const { ProviderProfileResponsesClient } = loadClient({
        AZURE_OPENAI_ENDPOINT: endpoint,
        OPENAI_API_KEY: "public-openai-key",
        OPENAI_BASE_URL: "https://api.openai.com/v1"
      });
      const client = new ProviderProfileResponsesClient();

      await expect(client.searchProviderProfiles({
        lineOfCoverage: "Medical",
        providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
      })).rejects.toThrow("AI provider profile search failed.");

      expect(mockOpenAIConstructor).not.toHaveBeenCalled();
      expect(mockCreateResponse).not.toHaveBeenCalled();
    }
  );

  it("applies Azure web-search filters without public OpenAI-only tool flags", async () => {
    const { ProviderProfileResponsesClient } = loadClient({
      AI_WEBSEARCH_MAX_TOOL_CALLS: "12",
      AI_WEBSEARCH_ALLOWED_DOMAINS: "npiprofile.com,healthgrades.com",
      AI_WEBSEARCH_BLOCKED_DOMAINS: "facebook.com"
    });
    const client = new ProviderProfileResponsesClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(mockOpenAIConstructor).toHaveBeenCalledWith({
      apiKey: "test-azure-key",
      baseURL: "https://azure.example.openai.azure.com/openai/v1",
      maxRetries: 1,
      fetch: expect.any(Function)
    });
    expect(mockCreateResponse).toHaveBeenCalledTimes(1);

    const request = mockCreateResponse.mock.calls[0][0];
    expect(request).toEqual(
      expect.objectContaining({
        model: "gpt-5.4",
        tool_choice: "required",
        max_tool_calls: 12,
        parallel_tool_calls: true,
        include: ["web_search_call.action.sources"],
        store: false,
        reasoning: { effort: "medium" }
      })
    );
    expect(request.tools).toEqual([
      {
        type: "web_search",
        filters: {
          allowed_domains: ["npiprofile.com", "healthgrades.com"],
          blocked_domains: ["facebook.com"]
        }
      }
    ]);
    expect(request.tools[0]).not.toHaveProperty("external_web_access");
    expect(request.tools[0]).not.toHaveProperty("search_context_size");
    expect(JSON.stringify(request)).not.toMatch(/web_search_preview|background":true|store":true/i);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider request metadata",
      expect.objectContaining({
        provider: "azure",
        model: "gpt-5.4",
        toolType: "web_search",
        toolChoice: "required",
        store: false,
        maxToolCalls: 12,
        parallelToolCalls: true,
        reasoningEffort: "medium"
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/Public Provider|provider-123|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("retries once with provider identity only when the first profile payload is not parseable", async () => {
    mockCreateResponse
      .mockResolvedValueOnce({ status: "completed", output_text: "No JSON profile was returned." })
      .mockResolvedValueOnce(citedProfileResponse([
            {
              providerId: "1679525919",
              npi: "1679525919",
              providerName: "THE CLEVELAND CLINIC FOUNDATION",
              specialties: [],
              locations: [
                {
                  addressLine1: "9500 Euclid Ave",
                  city: "Cleveland",
                  state: "OH",
                  zip: "44195",
                  sourceId: "src-1"
                }
              ],
              phoneNumbers: [{ value: "216-444-2200", sourceId: "src-1" }],
              ratings: [],
              confidenceNotes: [],
              sources: [{
                id: "src-1",
                title: "THE CLEVELAND CLINIC FOUNDATION — NPI 1679525919",
                domain: "npiprofile.com",
                url: "https://npiprofile.com/provider/123"
              }]
            }
      ]));
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [
        {
          providerId: "1679525919",
          npi: "1679525919",
          name: "THE CLEVELAND CLINIC FOUNDATION",
          specialty: "General Acute Care Hospital",
          city: "Cleveland",
          state: "OH",
          zip: "44195"
        }
      ]
    });

    expect(profiles).toHaveLength(1);
    expect(mockCreateResponse).toHaveBeenCalledTimes(2);

    const firstRequest = mockCreateResponse.mock.calls[0][0];
    const retryRequest = mockCreateResponse.mock.calls[1][0];
    expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
      { maxRetries: 1 },
      { maxRetries: 0 }
    ]);

    expect(firstRequest.input).toMatch(/General Acute Care Hospital/);
    expect(firstRequest.input).toMatch(/Cleveland/);
    expect(retryRequest.input).toMatch(/1679525919/);
    expect(retryRequest.input).toMatch(/THE CLEVELAND CLINIC FOUNDATION/);
    expect(retryRequest.input).not.toMatch(/General Acute Care Hospital|Cleveland|44195/);
    expect(retryRequest.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "initial",
        outcome: "malformed",
        retryReason: "malformed_identity_retry"
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "identity_retry",
        outcome: "completed",
        retryReason: "malformed_identity_retry"
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/THE CLEVELAND CLINIC FOUNDATION|1679525919|General Acute Care Hospital|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it.each(auditedCompletionFilterFixtures)(
    "classifies $name and retries the identical full request with raw usage and cost",
    async ({ response, expectedUsage }) => {
      mockCreateResponse.mockResolvedValueOnce(response);
      const { ProviderProfileResponsesClient } = loadClient({
        AZURE_OPENAI_ENDPOINT: "https://azure.example.openai.azure.com/openai/v1",
        AI_COST_INPUT_USD_PER_MILLION: "2.5",
        AI_COST_CACHED_INPUT_USD_PER_MILLION: "0.25",
        AI_COST_OUTPUT_USD_PER_MILLION: "15",
        AI_COST_WEB_SEARCH_USD_PER_THOUSAND: "10",
        AI_COST_PRICING_VERSION: "azure-contract-2026-07"
      });
      const client = new ProviderProfileResponsesClient();

      await expect(client.searchProviderProfiles({
        lineOfCoverage: "Medical",
        providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
      })).resolves.toHaveLength(1);

      expect(mockCreateResponse).toHaveBeenCalledTimes(2);
      expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
        { maxRetries: 1 },
        { maxRetries: 0 }
      ]);
      expect(mockCreateResponse.mock.calls[1][0]).toEqual(mockCreateResponse.mock.calls[0][0]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "AI provider usage telemetry",
        expect.objectContaining({
          attempt: "initial",
          outcome: "incomplete",
          retryReason: "content_filter_full_retry",
          ...expectedUsage,
          estimated: true,
          pricingVersion: "azure-contract-2026-07"
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "AI provider usage telemetry",
        expect.objectContaining({
          attempt: "full_retry",
          outcome: "completed",
          retryReason: "content_filter_full_retry"
        })
      );
      expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/incomplete_details|output_text|profiles|Public Provider|provider-123/i);
    }
  );

  it.each(auditedCompletionFilterFixtures)(
    "fails closed after one identical full retry when $name repeats",
    async ({ response, expectedUsage }) => {
      mockCreateResponse
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(response);
      const { ProviderProfileResponsesClient } = loadClient();
      const client = new ProviderProfileResponsesClient();

      await expect(client.searchProviderProfiles({
        lineOfCoverage: "Medical",
        providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
      })).rejects.toThrow("AI provider profile search failed.");

      expect(mockCreateResponse).toHaveBeenCalledTimes(2);
      expect(mockCreateResponse.mock.calls[1][0]).toEqual(mockCreateResponse.mock.calls[0][0]);
      expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
        { maxRetries: 1 },
        { maxRetries: 0 }
      ]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "AI provider usage telemetry",
        expect.objectContaining({
          attempt: "full_retry",
          outcome: "incomplete",
          retryReason: "content_filter_full_retry",
          inputTokens: expectedUsage.inputTokens,
          cachedInputTokens: expectedUsage.cachedInputTokens,
          uncachedInputTokens: expectedUsage.uncachedInputTokens,
          outputTokens: expectedUsage.outputTokens,
          reasoningOutputTokens: expectedUsage.reasoningOutputTokens,
          totalTokens: expectedUsage.totalTokens,
          webSearchCalls: expectedUsage.webSearchCalls
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "AI provider search telemetry",
        expect.objectContaining({
          outcome: "failed",
          attemptCount: 2,
          fullRetryCount: 1,
          identityRetryCount: 0,
          retryReasons: ["content_filter_full_retry"],
          initialSdkMaxRetries: 1,
          semanticRetrySdkMaxRetries: 0,
          maxHttpAttempts: 3
        })
      );
    }
  );

  it("does not stack identity recovery after the full content-filter retry", async () => {
    mockCreateResponse
      .mockResolvedValueOnce(completionContentFilter())
      .mockResolvedValueOnce({ status: "completed", output_text: "not structured output" });
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockCreateResponse).toHaveBeenCalledTimes(2);
    expect(mockCreateResponse.mock.calls[1][0]).toEqual(mockCreateResponse.mock.calls[0][0]);
    expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
      { maxRetries: 1 },
      { maxRetries: 0 }
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider search telemetry",
      expect.objectContaining({
        attemptCount: 2,
        fullRetryCount: 1,
        identityRetryCount: 0,
        retryReasons: ["content_filter_full_retry"],
        maxHttpAttempts: 3
      })
    );
  });

  it("recovers once when JSON violates the strict output envelope", async () => {
    mockCreateResponse.mockResolvedValueOnce({
      status: "completed",
      output_text: JSON.stringify({ profiles: null }),
      usage: {
        input_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 5,
        total_tokens: 25
      }
    });
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).resolves.toHaveLength(1);

    expect(mockCreateResponse).toHaveBeenCalledTimes(2);
    expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
      { maxRetries: 1 },
      { maxRetries: 0 }
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "initial",
        outcome: "malformed",
        retryReason: "malformed_identity_retry",
        totalTokens: 25
      })
    );
  });

  it("never starts a second semantic retry when malformed recovery also fails", async () => {
    mockCreateResponse
      .mockResolvedValueOnce({ status: "completed", output_text: "not structured output" })
      .mockResolvedValueOnce({ status: "completed", output_text: "still not structured output" });
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockCreateResponse).toHaveBeenCalledTimes(2);
    expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
      { maxRetries: 1 },
      { maxRetries: 0 }
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider search telemetry",
      expect.objectContaining({
        outcome: "failed",
        attemptCount: 2,
        identityRetryCount: 1,
        retryReasons: ["malformed_identity_retry"],
        initialSdkMaxRetries: 1,
        semanticRetrySdkMaxRetries: 0,
        maxHttpAttempts: 3
      })
    );
  });

  it("retries a native refusal once with the identical full request", async () => {
    mockCreateResponse.mockResolvedValueOnce(nativeRefusalFixture);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).resolves.toHaveLength(1);

    expect(mockCreateResponse).toHaveBeenCalledTimes(2);
    expect(mockCreateResponse.mock.calls[1][0]).toEqual(mockCreateResponse.mock.calls[0][0]);
    expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
      { maxRetries: 1 },
      { maxRetries: 0 }
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "initial",
        outcome: "refusal",
        retryReason: "native_refusal_full_retry",
        totalTokens: 110
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "full_retry",
        outcome: "completed",
        retryReason: "native_refusal_full_retry"
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider search telemetry",
      expect.objectContaining({
        outcome: "completed",
        attemptCount: 2,
        fullRetryCount: 1,
        identityRetryCount: 0,
        retryReasons: ["native_refusal_full_retry"],
        initialSdkMaxRetries: 1,
        semanticRetrySdkMaxRetries: 0,
        maxHttpAttempts: 3
      })
    );
  });

  it("fails closed after one full retry when a native refusal repeats", async () => {
    mockCreateResponse
      .mockResolvedValueOnce(nativeRefusalFixture)
      .mockResolvedValueOnce(nativeRefusalFixture);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockCreateResponse).toHaveBeenCalledTimes(2);
    expect(mockCreateResponse.mock.calls.map(call => call[1])).toEqual([
      { maxRetries: 1 },
      { maxRetries: 0 }
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "full_retry",
        outcome: "refusal",
        retryReason: "native_refusal_full_retry"
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider search telemetry",
      expect.objectContaining({
        outcome: "failed",
        attemptCount: 2,
        fullRetryCount: 1,
        retryReasons: ["native_refusal_full_retry"],
        maxHttpAttempts: 3
      })
    );
  });

  it("fails closed without semantic retry for non-content-filter incomplete responses", async () => {
    mockCreateResponse.mockResolvedValueOnce({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" }
    });
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        outcome: "incomplete",
        retryReason: null
      })
    );
  });

  it("does not retry a prompt-side content filter as completion recovery", async () => {
    mockCreateResponse.mockResolvedValueOnce({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      content_filters: [{ blocked: true, source_type: "prompt" }]
    });
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        attempt: "initial",
        outcome: "incomplete",
        retryReason: null
      })
    );
  });

  it("aggregates separately billed response usage across the identity-only retry", async () => {
    const firstResponse = {
      status: "completed",
      output_text: "No JSON profile was returned.",
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens: 100,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 1_100
      },
      output: [{ type: "web_search_call" }, { type: "web_search_call" }]
    };
    const retryResponse = successfulProfileResponse();
    retryResponse.output.unshift({ type: "web_search_call" });
    mockCreateResponse
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(retryResponse);

    const { ProviderProfileResponsesClient } = loadClient({
      AI_COST_INPUT_USD_PER_MILLION: "2.5",
      AI_COST_CACHED_INPUT_USD_PER_MILLION: "0.25",
      AI_COST_OUTPUT_USD_PER_MILLION: "15",
      AI_COST_WEB_SEARCH_USD_PER_THOUSAND: "10",
      AI_COST_PRICING_VERSION: "azure-contract-2026-07"
    });
    const client = new ProviderProfileResponsesClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider search telemetry",
      expect.objectContaining({
        outcome: "completed",
        attemptCount: 2,
        identityRetryCount: 1,
        usageMissingAttempts: 0,
        inputTokens: 1_100,
        cachedInputTokens: 225,
        uncachedInputTokens: 875,
        outputTokens: 110,
        reasoningOutputTokens: 24,
        totalTokens: 1_210,
        webSearchCalls: 4,
        estimated: true,
        pricingVersion: "azure-contract-2026-07",
        retryReasons: ["malformed_identity_retry"],
        initialSdkMaxRetries: 1,
        semanticRetrySdkMaxRetries: 0,
        maxHttpAttempts: 3,
        transportRetryUsageObservable: false
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(
      /Public Provider|provider-123|prompt|raw|sourceUrl|citation|api-key|authorization|userId|orgId/i
    );
  });

  it("retains a direct structured citation absent from every Azure provenance channel", async () => {
    const response = successfulProfileResponse();
    response.output_text = response.output_text.replace(
      "https://npiprofile.com/provider/123",
      "https://npiprofile.com/provider/not-cited"
    );
    response.output_parsed.profiles[0].phoneNumbers[0].citation.sourceUrl = "https://npiprofile.com/provider/not-cited";
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toEqual([
      expect.objectContaining({
        value: "2164442200",
        citation: expect.objectContaining({
          sourceUrl: "https://npiprofile.com/provider/not-cited"
        })
      })
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider citation provenance mismatch",
      expect.objectContaining({
        reason: "absent_from_all_native_provenance_channels",
        mismatchCount: 1
      })
    );
  });

  it("accepts an action.sources citation without requiring an annotation or open-page action", async () => {
    const response = successfulProfileResponse();
    response.output.find(item => item.type === "message").content[0].annotations = [];
    response.output.unshift({
      type: "web_search_call",
      action: {
        type: "search",
        sources: [{ type: "url", url: "https://npiprofile.com/provider/123" }]
      }
    });
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toEqual([
      {
        value: "2164442200",
        citation: {
          explicitFactDateSpan: null,
          factSpan: "2164442200",
          providerIdentitySpan: "Public Provider",
          sourceTitle: "Public directory",
          sourceUrl: "https://npiprofile.com/provider/123"
        }
      }
    ]);
    expect(profiles[0]).not.toHaveProperty("sources");
    expect(JSON.stringify(profiles)).toMatch(/providerIdentitySpan|factSpan|explicitFactDateSpan/);
  });

  it("retains exact pages opened by Azure web search as API provenance", async () => {
    const response = successfulProfileResponse();
    response.output.find(item => item.type === "message").content[0].annotations = [];
    response.output_parsed.profiles[0].phoneNumbers[0].citation.sourceUrl = "https://npiregistry.cms.hhs.gov/api/?number=123&version=2.1";
    response.output.unshift({
      type: "web_search_call",
      action: {
        type: "open_page",
        url: "https://npiregistry.cms.hhs.gov/api/?number=123&version=2.1"
      }
    });
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toHaveLength(1);
  });

  it("canonicalizes equivalent NPPES provider-view and API URLs by exact NPI", async () => {
    const response = successfulProfileResponse();
    response.output.find(item => item.type === "message").content[0].annotations = [];
    response.output_parsed.profiles[0].npi = "1234567890";
    response.output_parsed.profiles[0].phoneNumbers[0].citation = {
      sourceUrl: "https://npiregistry.cms.hhs.gov/api/?number=1234567890&version=2.1",
      sourceTitle: "NPPES record for NPI 1234567890",
      providerIdentitySpan: "Public Provider NPI 1234567890",
      factSpan: "2164442200",
      explicitFactDateSpan: null
    };
    response.output.unshift({
      type: "web_search_call",
      action: {
        type: "search",
        sources: [{ type: "url", url: "https://npiregistry.cms.hhs.gov/provider-view/1234567890" }]
      }
    });
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toHaveLength(1);
  });

  it("drops a phone when its own fact span omits the complete number", async () => {
    const response = successfulProfileResponse();
    response.output_parsed.profiles[0].phoneNumbers[0].citation.factSpan = "Scheduling is available by telephone.";
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toEqual([]);
  });

  it("does not host-reject a location because one emitted component is absent from its fact span", async () => {
    const response = citedProfileResponse([{
      providerId: "provider-123",
      providerName: "Public Provider",
      specialties: [],
      locations: [{
        addressLine1: "9500 Euclid Ave",
        city: "Cleveland",
        state: "OH",
        zip: "44195",
        sourceId: "src-1"
      }],
      phoneNumbers: [],
      ratings: [],
      websites: [],
      sources: [{
        id: "src-1",
        title: "Public provider page",
        url: "https://provider.example.org/location"
      }]
    }]);
    response.output_parsed.profiles[0].locations[0].citation.factSpan = "9500 Euclid Ave, Cleveland, OH";
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();

    const profiles = await new ProviderProfileResponsesClient().searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].locations).toHaveLength(1);
  });

  it("does not include legacy rating input in the model-shaped response", async () => {
    const response = citedProfileResponse([{
      providerId: "provider-123",
      providerName: "Public Provider",
      specialties: [],
      locations: [],
      phoneNumbers: [{ value: "216-444-2200", sourceId: "src-1" }],
      ratings: [{ value: "4.8", scale: "5", sourceId: "src-1" }],
      websites: [],
      sources: [{
        id: "src-1",
        title: "Public rating page",
        url: "https://ratings.example.org/provider"
      }]
    }]);
    mockCreateResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();

    const profiles = await new ProviderProfileResponsesClient().searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].ratings).toEqual([]);
  });
});

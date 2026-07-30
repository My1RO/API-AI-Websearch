const mockParseResponse = jest.fn();
const mockOpenAIConstructor = jest.fn().mockImplementation(() => ({
  responses: {
    parse: mockParseResponse
  }
}));
const ORIGINAL_ENV = process.env;
let consoleLogSpy;

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
  const outputText = JSON.stringify({ profiles });
  return {
    status: "completed",
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 25 },
      output_tokens: 10,
      output_tokens_details: { reasoning_tokens: 4 },
      total_tokens: 110
    },
    output_parsed: { profiles },
    output_text: outputText,
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: outputText,
        annotations: [{
          type: "url_citation",
          url: "https://npiprofile.com/provider/123"
        }]
      }]
    }]
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
    publicInsuranceMentions: [],
    confidenceNotes: [],
    sources: [{
      id: "src-1",
      title: "Public directory",
      domain: "npiprofile.com",
      url: "https://npiprofile.com/provider/123"
    }]
  }
]);

describe("Azure OpenAI Responses client privacy contract", () => {
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockParseResponse.mockReset();
    mockOpenAIConstructor.mockClear();
    mockParseResponse.mockResolvedValue(successfulProfileResponse());
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

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
      maxRetries: 2
    });
    expect(mockParseResponse).toHaveBeenCalledTimes(1);

    const request = mockParseResponse.mock.calls[0][0];
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
    expect(request.instructions).not.toMatch(/return json|citation annotations|citation payloads/i);
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
      expect(mockParseResponse).not.toHaveBeenCalled();
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
      maxRetries: 2
    });
    expect(mockParseResponse).toHaveBeenCalledTimes(1);

    const request = mockParseResponse.mock.calls[0][0];
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
    mockParseResponse
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
              publicInsuranceMentions: [],
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
    expect(mockParseResponse).toHaveBeenCalledTimes(2);

    const firstRequest = mockParseResponse.mock.calls[0][0];
    const retryRequest = mockParseResponse.mock.calls[1][0];

    expect(firstRequest.input).not.toMatch(/General Acute Care Hospital/);
    expect(firstRequest.input).toMatch(/Cleveland/);
    expect(retryRequest.input).toMatch(/1679525919/);
    expect(retryRequest.input).toMatch(/THE CLEVELAND CLINIC FOUNDATION/);
    expect(retryRequest.input).not.toMatch(/General Acute Care Hospital|Cleveland|44195/);
    expect(retryRequest.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/THE CLEVELAND CLINIC FOUNDATION|1679525919|General Acute Care Hospital|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("fails closed on non-completed provider responses without logging raw response content", async () => {
    mockParseResponse.mockResolvedValueOnce({
      status: "incomplete",
      usage: {
        input_tokens: 80,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 5,
        output_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 85
      },
      incomplete_details: { reason: "content_filter" },
      output_text: JSON.stringify({ profiles: [] })
    });
    const { ProviderProfileResponsesClient } = loadClient({
      AZURE_OPENAI_ENDPOINT: "https://azure.example.openai.azure.com/openai/v1"
    });
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockParseResponse).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider usage telemetry",
      expect.objectContaining({
        outcome: "incomplete",
        inputTokens: 80,
        cachedInputTokens: 20,
        uncachedInputTokens: 60,
        outputTokens: 5,
        reasoningOutputTokens: 2,
        totalTokens: 85
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/content_filter|incomplete_details|output_text|profiles|Public Provider|provider-123/i);
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
    mockParseResponse
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
        webSearchCalls: 3,
        estimated: true,
        pricingVersion: "azure-contract-2026-07",
        transportRetryUsageObservable: false
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(
      /Public Provider|provider-123|prompt|raw|sourceUrl|citation|api-key|authorization|userId|orgId/i
    );
  });

  it("retains only sources backed by actual response citation annotations", async () => {
    const response = successfulProfileResponse();
    response.output_text = response.output_text.replace(
      "https://npiprofile.com/provider/123",
      "https://npiprofile.com/provider/not-cited"
    );
    response.output_parsed.profiles[0].sources[0].url = "https://npiprofile.com/provider/not-cited";
    mockParseResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toEqual([]);
  });

  it("retains sources returned in Azure web-search action metadata", async () => {
    const response = successfulProfileResponse();
    response.output[0].content[0].annotations = [];
    response.output.unshift({
      type: "web_search_call",
      action: {
        type: "search",
        sources: [{ type: "url", url: "https://npiprofile.com/provider/123" }]
      }
    });
    mockParseResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toEqual([
      expect.objectContaining({ value: "2164442200", sourceId: "src-1" })
    ]);
  });

  it("retains exact pages opened by Azure web search as API provenance", async () => {
    const response = successfulProfileResponse();
    response.output[0].content[0].annotations = [];
    response.output_parsed.profiles[0].sources[0].url = "https://npiregistry.cms.hhs.gov/api/?number=123&version=2.1";
    response.output.unshift({
      type: "web_search_call",
      action: {
        type: "open_page",
        url: "https://npiregistry.cms.hhs.gov/api/?number=123&version=2.1"
      }
    });
    mockParseResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toHaveLength(1);
  });

  it("allows only same-NPI NPPES API and provider-view provenance equivalence", async () => {
    const response = successfulProfileResponse();
    response.output[0].content[0].annotations = [];
    response.output_parsed.profiles[0].npi = "1234567890";
    response.output_parsed.profiles[0].sources[0] = {
      id: "src-1",
      title: "NPPES record for NPI 1234567890",
      domain: "npiregistry.cms.hhs.gov",
      url: "https://npiregistry.cms.hhs.gov/api/?number=1234567890&version=2.1"
    };
    response.output.unshift({
      type: "web_search_call",
      action: {
        type: "search",
        sources: [{ type: "url", url: "https://npiregistry.cms.hhs.gov/provider-view/1234567890" }]
      }
    });
    mockParseResponse.mockResolvedValue(response);
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    const profiles = await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].phoneNumbers).toHaveLength(1);
  });
});

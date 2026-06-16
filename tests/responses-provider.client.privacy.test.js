const mockCreateResponse = jest.fn();
const mockOpenAIConstructor = jest.fn().mockImplementation(() => ({
  responses: {
    create: mockCreateResponse
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
    AI_API_KEY: "test-ai-key",
    AI_MODEL: "gpt-5.5",
    AI_BASE_URL: "",
    AI_WEBSEARCH_TOOL_CHOICE: "required",
    AI_WEBSEARCH_MAX_TOOL_CALLS: "8",
    AI_WEBSEARCH_PARALLEL_TOOL_CALLS: "true",
    AI_REASONING_EFFORT: "medium",
    AI_OPENAI_WEBSEARCH_CONTEXT_SIZE: "medium",
    AI_WEBSEARCH_ALLOWED_DOMAINS: "",
    AI_WEBSEARCH_BLOCKED_DOMAINS: "",
    ...overrides
  };

  return require("../src/services/ai-provider/responses-provider.client");
};

const successfulProfileResponse = () => ({
  status: "completed",
  output_text: JSON.stringify({
    profiles: [
      {
        providerId: "provider-123",
        providerName: "Public Provider",
        specialties: [],
        locations: [],
        phoneNumbers: [{ value: "2164442200", sourceId: "src-1" }],
        ratings: [],
        publicInsuranceMentions: [],
        confidenceNotes: [],
        sources: [{ id: "src-1", title: "Public directory", domain: "npiprofile.com" }]
      }
    ]
  })
});

describe("unified Responses provider client privacy contract", () => {
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

  it("routes default OpenAI traffic through the shared config surface", async () => {
    const { ProviderProfileResponsesClient } = loadClient();
    const client = new ProviderProfileResponsesClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(mockOpenAIConstructor).toHaveBeenCalledWith({
      apiKey: "test-ai-key",
      baseURL: undefined
    });
    expect(mockCreateResponse).toHaveBeenCalledTimes(1);

    const request = mockCreateResponse.mock.calls[0][0];
    expect(request).toEqual(
      expect.objectContaining({
        model: "gpt-5.5",
        tool_choice: "required",
        max_tool_calls: 8,
        parallel_tool_calls: true,
        store: false,
        reasoning: { effort: "medium" }
      })
    );
    expect(request.tools).toEqual([
      expect.objectContaining({
        type: "web_search",
        external_web_access: false,
        search_context_size: "medium"
      })
    ]);
    expect(JSON.stringify(request)).not.toMatch(/web_search_preview|background":true|store":true/i);
    expect(request.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider request metadata",
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5.5",
        toolType: "web_search",
        toolChoice: "required",
        externalWebAccess: false,
        store: false,
        maxToolCalls: 8,
        parallelToolCalls: true,
        searchContextSize: "medium",
        reasoningEffort: "medium"
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/Public Provider|provider-123|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("routes Azure traffic by AI_BASE_URL without duplicated Azure behavior flags", async () => {
    const { ProviderProfileResponsesClient } = loadClient({
      AI_BASE_URL: "https://azure.example.openai.azure.com/",
      AI_MODEL: "gpt-5.4",
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
      apiKey: "test-ai-key",
      baseURL: "https://azure.example.openai.azure.com/openai/v1"
    });
    expect(mockCreateResponse).toHaveBeenCalledTimes(1);

    const request = mockCreateResponse.mock.calls[0][0];
    expect(request).toEqual(
      expect.objectContaining({
        model: "gpt-5.4",
        tool_choice: "required",
        max_tool_calls: 12,
        parallel_tool_calls: true,
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
        externalWebAccess: false,
        store: false,
        maxToolCalls: 12,
        parallelToolCalls: true,
        searchContextSize: undefined,
        reasoningEffort: "medium"
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/Public Provider|provider-123|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("retries once with provider identity only when the first profile payload is not parseable", async () => {
    mockCreateResponse
      .mockResolvedValueOnce({ status: "completed", output_text: "No JSON profile was returned." })
      .mockResolvedValueOnce({
        status: "completed",
        output_text: JSON.stringify({
          profiles: [
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
              sources: [{ id: "src-1", title: "NPI Profile", domain: "npiprofile.com" }]
            }
          ]
        })
      });
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

    expect(firstRequest.input).not.toMatch(/General Acute Care Hospital/);
    expect(firstRequest.input).toMatch(/Cleveland/);
    expect(retryRequest.input).toMatch(/1679525919/);
    expect(retryRequest.input).toMatch(/THE CLEVELAND CLINIC FOUNDATION/);
    expect(retryRequest.input).not.toMatch(/General Acute Care Hospital|Cleveland|44195/);
    expect(retryRequest.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/THE CLEVELAND CLINIC FOUNDATION|1679525919|General Acute Care Hospital|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("fails closed on non-completed provider responses without logging raw response content", async () => {
    mockCreateResponse.mockResolvedValueOnce({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output_text: JSON.stringify({ profiles: [] })
    });
    const { ProviderProfileResponsesClient } = loadClient({
      AI_BASE_URL: "https://azure.example.openai.azure.com/openai/v1",
      AI_MODEL: "gpt-5.4"
    });
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).rejects.toThrow("AI provider profile search failed.");

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/content_filter|incomplete_details|output_text|profiles|Public Provider|provider-123/i);
  });
});

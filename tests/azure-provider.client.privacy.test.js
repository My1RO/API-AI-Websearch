const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
let consoleLogSpy;

const loadClient = (overrides = {}) => {
  jest.resetModules();
  process.env = {
    ...process.env,
    NODE_ENV: "test",
    AI_PROVIDER: "azure",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid/",
    AZURE_OPENAI_API_KEY: "test-azure-key",
    AZURE_OPENAI_DEPLOYMENT: "gpt-5.5",
    AZURE_OPENAI_API_VERSION: "",
    AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "true",
    AZURE_OPENAI_WEB_SEARCH_ENABLED: "true",
    AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "true",
    AZURE_OPENAI_WEB_SEARCH_TOOL_TYPE: "web_search",
    AZURE_OPENAI_WEB_SEARCH_TOOL_CHOICE: "required",
    AZURE_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS: "8",
    AZURE_OPENAI_WEB_SEARCH_PARALLEL_TOOL_CALLS: "true",
    AZURE_OPENAI_REASONING_EFFORT: "medium",
    AZURE_OPENAI_WEB_SEARCH_INCLUDE_SOURCES: "true",
    AZURE_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: "",
    AZURE_OPENAI_WEB_SEARCH_BLOCKED_DOMAINS: "",
    ...overrides
  };

  return require("../src/services/ai-provider/azure-provider.client");
};

describe("Azure provider client web search contract", () => {
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
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
      })
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    global.fetch = ORIGINAL_FETCH;
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("uses Azure v1 Responses web_search without OpenAI-only live-access fields", async () => {
    const { AzureProviderProfileClient } = loadClient();
    const client = new AzureProviderProfileClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(url).toBe("https://azure.example.invalid/openai/v1/responses");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "api-key": "test-azure-key"
        })
      })
    );
    expect(body).toEqual(
      expect.objectContaining({
        model: "gpt-5.5",
        tool_choice: "required",
        max_tool_calls: 8,
        parallel_tool_calls: true,
        store: false,
        reasoning: { effort: "medium" },
        include: ["web_search_call.action.sources"]
      })
    );
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tools[0]).not.toHaveProperty("external_web_access");
    expect(body.tools[0]).not.toHaveProperty("search_context_size");
    expect(JSON.stringify(body)).not.toMatch(/web_search_preview|background":true/i);
    expect(body.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider request metadata",
      expect.objectContaining({
        provider: "azure",
        model: "gpt-5.5",
        lineOfCoverage: "Medical",
        providerCount: 1,
        providersWithProviderId: 1,
        providersWithLocationHints: 1,
        identityOnly: false,
        toolType: "web_search",
        toolChoice: "required",
        externalWebAccess: false,
        store: false,
        maxToolCalls: 8,
        parallelToolCalls: true,
        reasoningEffort: "medium",
        includeSources: true
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/Public Provider|provider-123|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("keeps legacy Azure api-version opt-in explicit", async () => {
    const { AzureProviderProfileClient } = loadClient({
      AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid/openai/v1",
      AZURE_OPENAI_API_VERSION: "2025-04-01-preview"
    });
    const client = new AzureProviderProfileClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://azure.example.invalid/openai/v1/responses?api-version=2025-04-01-preview"
    );
  });
});

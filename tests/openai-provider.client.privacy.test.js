const mockCreateResponse = jest.fn();
const ORIGINAL_ENV = process.env;
let consoleLogSpy;

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    responses: {
      create: mockCreateResponse
    }
  }))
}));

const loadClient = () => {
  jest.resetModules();
  process.env = {
    ...process.env,
    NODE_ENV: "test",
    AI_PROVIDER: "openai",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: "gpt-4.1",
    OPENAI_WEB_SEARCH_EXTERNAL_ACCESS: "false",
    OPENAI_STORE: "false"
  };

  return require("../src/services/ai-provider/openai-provider.client");
};

describe("OpenAI provider client privacy contract", () => {
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockCreateResponse.mockReset();
    mockCreateResponse.mockResolvedValue({
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
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("uses real Responses web_search with cache-only and no provider-side storage", async () => {
    const { OpenAiProviderProfileClient } = loadClient();
    const client = new OpenAiProviderProfileClient();

    await client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    });

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    const request = mockCreateResponse.mock.calls[0][0];

    expect(request).toEqual(
      expect.objectContaining({
        model: "gpt-4.1",
        tool_choice: "required",
        max_tool_calls: 1,
        parallel_tool_calls: false,
        store: false
      })
    );
    expect(request).not.toHaveProperty("text");
    expect(request.tools).toEqual([
      expect.objectContaining({
        type: "web_search",
        external_web_access: false,
        search_context_size: "low"
      })
    ]);
    expect(JSON.stringify({ tools: request.tools, background: request.background })).not.toMatch(/web_search_preview|background":true/i);
    expect(request.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);
    expect(request.input).not.toMatch(/example\.com|"string optional"|"string"/i);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider request metadata",
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4.1",
        lineOfCoverage: "Medical",
        providerCount: 1,
        providersWithProviderId: 1,
        providersWithLocationHints: 1,
        identityOnly: false,
        toolType: "web_search",
        externalWebAccess: false,
        store: false,
        maxToolCalls: 1,
        parallelToolCalls: false
      })
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/Public Provider|provider-123|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });

  it("retries once with provider identity only when the first profile payload is not parseable", async () => {
    mockCreateResponse
      .mockResolvedValueOnce({ output_text: "No JSON profile was returned." })
      .mockResolvedValueOnce({
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

    const { OpenAiProviderProfileClient } = loadClient();
    const client = new OpenAiProviderProfileClient();

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
    expect(retryRequest).toEqual(
      expect.objectContaining({
        tool_choice: "required",
        max_tool_calls: 1,
        parallel_tool_calls: false,
        store: false
      })
    );
    expect(retryRequest.tools).toEqual([
      expect.objectContaining({
        type: "web_search",
        external_web_access: false,
        search_context_size: "low"
      })
    ]);
    expect(retryRequest.input).not.toMatch(/quote|member|client|patient|dob|diagnosis|medication/i);

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ identityOnly: false }));
    expect(consoleLogSpy.mock.calls[1][1]).toEqual(expect.objectContaining({ identityOnly: true }));
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/THE CLEVELAND CLINIC FOUNDATION|1679525919|General Acute Care Hospital|prompt|raw|sourceUrl|citation|quote|member|client|patient/i);
  });
});

const ORIGINAL_ENV = process.env;

const loadRuntimeWithEnv = (overrides) => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    AI_API_KEY: "test-ai-key",
    AI_MODEL: "gpt-5.5",
    AI_BASE_URL: "",
    ...overrides
  };

  return require("../src/config/runtime");
};

describe("AI runtime fail-closed privacy configuration", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("routes empty or OpenAI base URLs to OpenAI", () => {
    const { providerFromBaseUrl } = loadRuntimeWithEnv();

    expect(providerFromBaseUrl("")).toBe("openai");
    expect(providerFromBaseUrl("https://api.openai.com/v1")).toBe("openai");
  });

  it("routes Azure OpenAI URLs to the Azure dialect", () => {
    const { providerFromBaseUrl } = loadRuntimeWithEnv();

    expect(providerFromBaseUrl("https://foundry-lucie-ai.openai.azure.com/")).toBe("azure");
    expect(providerFromBaseUrl("https://foundry-lucie-ai.openai.azure.com/openai/v1")).toBe("azure");
  });

  it("fails closed for unknown provider hosts", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_BASE_URL: "https://llm.example.invalid/v1"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "unknown",
        ready: false,
        reason: "unsupported_provider",
        baseUrl: "https://llm.example.invalid/v1"
      })
    );
  });

  it("does not allow mock profiles as a runtime provider", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      NODE_ENV: "test",
      AI_PROVIDER: "mock"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "mock",
        ready: false,
        reason: "unsupported_provider"
      })
    );
  });

  it("keeps runtime fail-closed until the shared compliance gate is confirmed", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "false"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "openai",
        ready: false,
        reason: "compliance_gate_unconfirmed"
      })
    );
  });

  it("keeps runtime fail-closed when provider credentials are incomplete", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_BASE_URL: "https://foundry-lucie-ai.openai.azure.com/openai/v1",
      AI_API_KEY: "",
      AI_MODEL: "gpt-5.4"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "azure",
        ready: false,
        reason: "provider_not_configured"
      })
    );
  });

  it("allows OpenAI with the shared config surface", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_BASE_URL: "",
      AI_API_KEY: "test-ai-key",
      AI_MODEL: "gpt-5.5"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "openai",
        enabled: true,
        ready: true
      })
    );
  });

  it("allows Azure with the same shared config surface", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_BASE_URL: "https://foundry-lucie-ai.openai.azure.com/openai/v1",
      AI_API_KEY: "test-ai-key",
      AI_MODEL: "gpt-5.4"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "azure",
        enabled: true,
        ready: true
      })
    );
  });

});

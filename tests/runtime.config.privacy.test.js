const ORIGINAL_ENV = process.env;

const loadRuntimeWithEnv = (overrides) => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_WEB_SEARCH_EXTERNAL_ACCESS: "false",
    OPENAI_STORE: "false",
    AZURE_OPENAI_ENDPOINT: "",
    AZURE_OPENAI_API_KEY: "",
    AZURE_OPENAI_DEPLOYMENT: "",
    AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "false",
    AZURE_OPENAI_WEB_SEARCH_ENABLED: "false",
    AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "false",
    ...overrides
  };

  return require("../src/config/runtime");
};

describe("AI runtime fail-closed privacy configuration", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("marks OpenAI runtime unsafe when external web access is enabled", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "openai",
      OPENAI_WEB_SEARCH_EXTERNAL_ACCESS: "true"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "openai",
        ready: false,
        reason: "unsafe_provider_config"
      })
    );
  });

  it("marks OpenAI runtime unsafe when provider-side storage is enabled", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "openai",
      OPENAI_STORE: "true"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "openai",
        ready: false,
        reason: "unsafe_provider_config"
      })
    );
  });

  it("allows OpenAI only when the privacy switches are explicitly closed", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "openai",
      OPENAI_WEB_SEARCH_EXTERNAL_ACCESS: "false",
      OPENAI_STORE: "false"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "openai",
        enabled: true,
        ready: true
      })
    );
  });

  it("does not allow mock profiles as a runtime provider", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      NODE_ENV: "development",
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

  it("keeps Azure fail-closed until content logging compliance is confirmed", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "azure",
      AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid",
      AZURE_OPENAI_API_KEY: "test-azure-key",
      AZURE_OPENAI_DEPLOYMENT: "provider-profiles",
      AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "false",
      AZURE_OPENAI_WEB_SEARCH_ENABLED: "true",
      AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "true"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "azure",
        ready: false,
        reason: "azure_compliance_gate_unconfirmed"
      })
    );
  });

  it("keeps Azure fail-closed until web search is explicitly enabled", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "azure",
      AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid",
      AZURE_OPENAI_API_KEY: "test-azure-key",
      AZURE_OPENAI_DEPLOYMENT: "provider-profiles",
      AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "true",
      AZURE_OPENAI_WEB_SEARCH_ENABLED: "false",
      AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "true"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "azure",
        ready: false,
        reason: "azure_web_search_disabled"
      })
    );
  });

  it("keeps Azure fail-closed until web search compliance is confirmed", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "azure",
      AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid",
      AZURE_OPENAI_API_KEY: "test-azure-key",
      AZURE_OPENAI_DEPLOYMENT: "provider-profiles",
      AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "true",
      AZURE_OPENAI_WEB_SEARCH_ENABLED: "true",
      AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "false"
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "azure",
        ready: false,
        reason: "azure_web_search_compliance_gate_unconfirmed"
      })
    );
  });

  it("keeps Azure fail-closed when deployment configuration is incomplete", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "azure",
      AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "true",
      AZURE_OPENAI_WEB_SEARCH_ENABLED: "true",
      AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "true",
      AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid",
      AZURE_OPENAI_API_KEY: "test-azure-key",
      AZURE_OPENAI_DEPLOYMENT: ""
    });

    expect(getAiRuntimeStatus()).toEqual(
      expect.objectContaining({
        provider: "azure",
        ready: false,
        reason: "provider_not_configured"
      })
    );
  });

  it("allows Azure only after web search enable and compliance flags are explicit", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_PROVIDER: "azure",
      AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED: "true",
      AZURE_OPENAI_WEB_SEARCH_ENABLED: "true",
      AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED: "true",
      AZURE_OPENAI_ENDPOINT: "https://azure.example.invalid",
      AZURE_OPENAI_API_KEY: "test-azure-key",
      AZURE_OPENAI_DEPLOYMENT: "provider-profiles"
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

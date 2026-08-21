const fs = require("fs");
const path = require("path");

const ORIGINAL_ENV = process.env;

const loadRuntimeWithEnv = (overrides = {}) => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    AZURE_OPENAI_API_KEY: "test-azure-key",
    AZURE_OPENAI_ENDPOINT: "https://foundry-lucie-ai.openai.azure.com",
    ...overrides
  };

  return require("../src/config/runtime");
};

const loadModelConfigWithEnv = (overrides = {}) => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    ...overrides
  };

  return require("../src/config/provider-profile-model");
};

describe("Azure-only AI runtime fail-closed configuration", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("normalizes supported Azure OpenAI resource endpoints", () => {
    const { azureOpenAiResponsesBaseUrl } = loadRuntimeWithEnv();

    expect(azureOpenAiResponsesBaseUrl("https://foundry-lucie-ai.openai.azure.com/"))
      .toBe("https://foundry-lucie-ai.openai.azure.com/openai/v1");
    expect(azureOpenAiResponsesBaseUrl("https://foundry-lucie-ai.openai.azure.com/openai/v1/"))
      .toBe("https://foundry-lucie-ai.openai.azure.com/openai/v1");
  });

  it.each([
    "",
    "https://api.openai.com/v1",
    "https://llm.example.invalid/openai/v1",
    "http://foundry-lucie-ai.openai.azure.com",
    "https://foundry-lucie-ai.openai.azure.com/other",
    "https://foundry-lucie-ai.openai.azure.com:444/openai/v1",
    "https://user:password@foundry-lucie-ai.openai.azure.com/openai/v1",
    "https://foundry-lucie-ai.openai.azure.com/openai/v1?redirect=https://api.openai.com"
  ])("rejects non-Azure or non-canonical endpoint %p", endpoint => {
    const { azureOpenAiResponsesBaseUrl } = loadRuntimeWithEnv();

    expect(azureOpenAiResponsesBaseUrl(endpoint)).toBeNull();
  });

  it("fails closed when the Azure endpoint is missing", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({ AZURE_OPENAI_ENDPOINT: "" });

    expect(getAiRuntimeStatus()).toEqual(expect.objectContaining({
      provider: "azure",
      enabled: false,
      ready: false,
      reason: "azure_endpoint_not_configured"
    }));
  });

  it("fails closed for a public OpenAI endpoint", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AZURE_OPENAI_ENDPOINT: "https://api.openai.com/v1"
    });

    expect(getAiRuntimeStatus()).toEqual(expect.objectContaining({
      provider: "azure",
      enabled: false,
      ready: false,
      reason: "invalid_azure_endpoint"
    }));
  });

  it("does not recognize legacy generic or public OpenAI environment aliases", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AZURE_OPENAI_ENDPOINT: "",
      AZURE_OPENAI_API_KEY: "",
      AZURE_OPENAI_DEPLOYMENT: "",
      AI_PROVIDER: "openai",
      AI_BASE_URL: "https://api.openai.com/v1",
      AI_API_KEY: "generic-key",
      AI_MODEL: "gpt-5.5",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_API_KEY: "public-openai-key",
      OPENAI_MODEL: "gpt-5.5"
    });

    expect(getAiRuntimeStatus()).toEqual(expect.objectContaining({
      provider: "azure",
      ready: false,
      reason: "azure_endpoint_not_configured"
    }));
  });

  it("keeps runtime fail-closed until the compliance gate is confirmed", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({
      AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "false"
    });

    expect(getAiRuntimeStatus()).toEqual(expect.objectContaining({
      provider: "azure",
      ready: false,
      reason: "compliance_gate_unconfirmed"
    }));
  });

  it("keeps runtime fail-closed when Azure credentials are incomplete", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv({ AZURE_OPENAI_API_KEY: "" });

    expect(getAiRuntimeStatus()).toEqual(expect.objectContaining({
      provider: "azure",
      ready: false,
      reason: "provider_not_configured"
    }));
  });

  it("allows a complete Azure-only configuration", () => {
    const { getAiRuntimeStatus } = loadRuntimeWithEnv();

    expect(getAiRuntimeStatus()).toEqual({
      provider: "azure",
      enabled: true,
      ready: true,
      baseUrl: "https://foundry-lucie-ai.openai.azure.com/openai/v1"
    });
  });

  it("keeps result-shaping model settings immutable when environment overrides are present", () => {
    const modelConfig = loadModelConfigWithEnv({
      AZURE_OPENAI_DEPLOYMENT: "gpt-5.6-sol",
      AI_WEBSEARCH_TOOL_CHOICE: "auto",
      AI_WEBSEARCH_MAX_TOOL_CALLS: "20",
      AI_WEBSEARCH_PARALLEL_TOOL_CALLS: "false",
      AI_REASONING_EFFORT: "high",
      AI_WEBSEARCH_ALLOWED_DOMAINS: "example.com",
      AI_WEBSEARCH_BLOCKED_DOMAINS: "npiprofile.com"
    });

    expect(modelConfig).toEqual(expect.objectContaining({
      AZURE_OPENAI_DEPLOYMENT: "gpt-5.6-terra",
      AI_WEBSEARCH_TOOL_CHOICE: "required",
      AI_WEBSEARCH_MAX_TOOL_CALLS: 8,
      AI_WEBSEARCH_PARALLEL_TOOL_CALLS: true,
      AI_REASONING_EFFORT: "low",
      AI_WEBSEARCH_ALLOWED_DOMAINS: [],
      AI_WEBSEARCH_BLOCKED_DOMAINS: []
    }));
  });

  it("documents only deployment credentials and gates, not result-shaping model settings", () => {
    const envTemplate = fs.readFileSync(path.join(__dirname, "../.env.dist"), "utf8");

    expect(envTemplate).toMatch(/^AZURE_OPENAI_ENDPOINT=$/m);
    expect(envTemplate).toMatch(/^AZURE_OPENAI_API_KEY=$/m);
    for (const variableName of [
      "AZURE_OPENAI_DEPLOYMENT",
      "AI_WEBSEARCH_TOOL_CHOICE",
      "AI_WEBSEARCH_MAX_TOOL_CALLS",
      "AI_WEBSEARCH_PARALLEL_TOOL_CALLS",
      "AI_REASONING_EFFORT",
      "AI_WEBSEARCH_ALLOWED_DOMAINS",
      "AI_WEBSEARCH_BLOCKED_DOMAINS"
    ]) {
      expect(envTemplate).not.toMatch(new RegExp(`^${variableName}=`, "m"));
    }
  });
});

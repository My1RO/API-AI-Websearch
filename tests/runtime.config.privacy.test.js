const fs = require("node:fs");
const path = require("node:path");

const ORIGINAL_ENV = process.env;

const configureTestEnv = (overrides = {}) => {
  const nextEnv = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    AZURE_OPENAI_API_KEY: "test-azure-key",
    AZURE_OPENAI_DEPLOYMENT: "gpt-5.4",
    AZURE_OPENAI_ENDPOINT: "https://foundry-lucie-ai.openai.azure.com",
    ...overrides
  };

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete nextEnv[key];
    }
  }

  process.env = nextEnv;
};

const loadRuntimeWithEnv = (overrides = {}) => {
  jest.resetModules();
  configureTestEnv(overrides);

  return require("../src/config/runtime");
};

const loadEnvWithEnv = (overrides = {}) => {
  jest.resetModules();
  configureTestEnv(overrides);

  return require("../src/config/env");
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

  it.each([undefined, ""])("defaults an absent deployment and reasoning value (%p) to Terra low", absentValue => {
    const { env } = loadEnvWithEnv({
      AZURE_OPENAI_DEPLOYMENT: absentValue,
      AI_REASONING_EFFORT: absentValue
    });

    expect(env.azureOpenAiDeployment).toBe("gpt-5.6-terra");
    expect(env.aiReasoningEffort).toBe("low");
  });

  it("preserves explicit deployment and reasoning overrides", () => {
    const { env } = loadEnvWithEnv({
      AZURE_OPENAI_DEPLOYMENT: "gpt-5.6-sol",
      AI_REASONING_EFFORT: "high"
    });

    expect(env.azureOpenAiDeployment).toBe("gpt-5.6-sol");
    expect(env.aiReasoningEffort).toBe("high");
  });

  it("defaults an invalid reasoning override deterministically to low", () => {
    const { env } = loadEnvWithEnv({ AI_REASONING_EFFORT: "unsupported" });

    expect(env.aiReasoningEffort).toBe("low");
  });

  it("documents non-secret local defaults without embedding Azure credentials", () => {
    const envTemplate = fs.readFileSync(path.join(__dirname, "../.env.dist"), "utf8");

    expect(envTemplate).toMatch(/^AZURE_OPENAI_ENDPOINT=$/m);
    expect(envTemplate).toMatch(/^AZURE_OPENAI_API_KEY=$/m);
    expect(envTemplate).toMatch(/^AZURE_OPENAI_DEPLOYMENT=gpt-5\.6-terra$/m);
    expect(envTemplate).toMatch(/^AI_REASONING_EFFORT=low$/m);
  });
});

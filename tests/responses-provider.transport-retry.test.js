const fixture = require("./fixtures/azure-transport-retry/max-three-http-sends.json");

const ORIGINAL_ENV = process.env;
const originalFetch = global.fetch;
let consoleLogSpy;

const loadProductionClient = () => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    AI_FEATURE_ENABLED: "true",
    AI_WEBSEARCH_COMPLIANCE_CONFIRMED: "true",
    AZURE_OPENAI_API_KEY: "test-azure-key",
    AZURE_OPENAI_DEPLOYMENT: "gpt-5.6-terra",
    AZURE_OPENAI_ENDPOINT: "https://azure.example.openai.azure.com",
    AI_WEBSEARCH_TOOL_CHOICE: "required",
    AI_WEBSEARCH_MAX_TOOL_CALLS: "8",
    AI_WEBSEARCH_PARALLEL_TOOL_CALLS: "true",
    AI_REASONING_EFFORT: "low"
  };
  return require("../src/services/ai-provider/responses-provider.client");
};

describe("Azure OpenAI SDK transport retry telemetry", () => {
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = ORIGINAL_ENV;
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.resetModules();
  });

  it("observes one SDK retry plus one semantic recovery without exceeding three HTTP sends", async () => {
    const sends = [];
    global.fetch = jest.fn(async (input, init) => {
      const configured = fixture.sequence[sends.length];
      if (!configured) {
        throw new Error("The production path exceeded the three-send retry ceiling.");
      }
      sends.push({ input, init, configured });
      return new Response(JSON.stringify(configured.body), {
        status: configured.status,
        headers: {
          "content-type": "application/json",
          "retry-after-ms": "0",
          [configured.requestIdHeader]: configured.requestId
        }
      });
    });

    const { ProviderProfileResponsesClient } = loadProductionClient();
    const transportTelemetry = require("../src/services/ai-provider/transport-attempt-telemetry");
    const client = new ProviderProfileResponsesClient();

    await expect(client.searchProviderProfiles({
      lineOfCoverage: "Medical",
      providers: [{ providerId: "provider-123", name: "Public Provider", state: "OH" }]
    })).resolves.toHaveLength(1);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(sends.map(send => send.configured.semanticAttemptKind)).toEqual([
      "initial",
      "initial",
      "identity_retry"
    ]);

    const traces = transportTelemetry.drainAiTransportAttemptTraces();
    expect(traces).toHaveLength(2);
    expect(traces.map(trace => trace.semanticAttemptKind)).toEqual(["initial", "identity_retry"]);
    expect(traces.map(trace => trace.httpAttempts.length)).toEqual([2, 1]);
    expect(traces[0].httpAttempts.map(attempt => attempt.httpAttemptOrdinal)).toEqual([1, 2]);
    expect(traces.flatMap(trace => trace.httpAttempts).map(attempt => attempt.status)).toEqual([503, 200, 200]);
    expect(traces.flatMap(trace => trace.httpAttempts).map(attempt => attempt.responseRequestId)).toEqual([
      "trace-initial-503",
      "trace-initial-200",
      "trace-recovery-200"
    ]);
    expect(new Set(traces.map(trace => trace.semanticAttemptId)).size).toBe(2);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider search telemetry",
      expect.objectContaining({
        attemptCount: 2,
        identityRetryCount: 1,
        initialSdkMaxRetries: 1,
        semanticRetrySdkMaxRetries: 0,
        maxHttpAttempts: 3,
        transportHttpAttemptCount: 3,
        transportRetryCount: 1,
        transportRetryUsageObservable: true
      })
    );

    const serializedTelemetry = JSON.stringify(consoleLogSpy.mock.calls);
    expect(serializedTelemetry).not.toMatch(
      /test-azure-key|authorization|api-key|Public Provider|provider-123|https:\/\/azure\.example|request body|prompt/i
    );
  });

  it("records a sanitized transport error without persisting its message, URL, or headers", async () => {
    const {
      createAiTransportSemanticAttemptTrace,
      createAiTransportTracingFetch,
      drainAiTransportAttemptTraces,
      runWithAiTransportSemanticAttempt
    } = require("../src/services/ai-provider/transport-attempt-telemetry");
    drainAiTransportAttemptTraces();

    const baseFetch = jest.fn(async () => {
      const error = new Error("secret provider data at https://private.example/path?api-key=secret");
      error.code = "ECONNRESET";
      throw error;
    });
    const tracedFetch = createAiTransportTracingFetch(baseFetch);
    const trace = createAiTransportSemanticAttemptTrace("initial");

    await expect(runWithAiTransportSemanticAttempt(
      trace,
      () => tracedFetch("https://private.example/path?api-key=secret", {
        headers: { authorization: "Bearer secret" }
      })
    )).rejects.toThrow("secret provider data");

    const traces = drainAiTransportAttemptTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].httpAttempts).toEqual([
      expect.objectContaining({
        semanticAttemptKind: "initial",
        httpAttemptOrdinal: 1,
        status: null,
        responseRequestId: null,
        transportError: { name: "Error", code: "ECONNRESET" }
      })
    ]);
    expect(JSON.stringify(traces)).not.toMatch(/secret provider data|private\.example|authorization|api-key/i);
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(
      /secret provider data|private\.example|authorization|api-key/i
    );
  });
});

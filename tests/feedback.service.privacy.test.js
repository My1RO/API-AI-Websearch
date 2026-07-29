const mockExecute = jest.fn();

jest.mock("../src/db/data-source", () => ({
  getDataSource: jest.fn().mockResolvedValue({
    query: mockExecute
  })
}));

const {
  sanitizeFeedbackFactValueOrThrow,
  saveFeedback,
  savePhoneCall
} = require("../src/services/feedback.service");
const { feedbackSchema } = require("../src/validators/provider-profile.validator");

const flattenExecuteParameters = () =>
  mockExecute.mock.calls.flatMap(([, params]) => (Array.isArray(params) ? params : []));

describe("feedback persistence privacy guardrails", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], undefined]);
  });

  it.each([
    "optionalNote",
    "memberId",
    "userId",
    "sessionId",
    "queryId",
    "jobId",
    "requestId",
    "quoteId",
    "prompt",
    "rawResponse",
    "sourceUrl"
  ])("strictly rejects the unsupported %s field", (field) => {
    expect(() => feedbackSchema.parse({
      brokerOrgId: "broker-1",
      submitterClass: "consumer",
      providerNpi: "1234567890",
      factType: "phone",
      normalizedFactValue: "+12164442200",
      validationStatus: "correct",
      [field]: "forbidden"
    })).toThrow();
  });

  it.each([
    ["profile", "Public Clinic", "wrong_provider"],
    ["phone", "+1 (216) 444-2200", "wrong_phone"],
    ["address", "100 Public Street, Cleveland OH 44113", "wrong_location"],
    ["website", "https://www.publicclinic.org/contact?utm_source=test#top", "wrong_website"],
    ["rating", "4.8 out of 5", "wrong_rating"]
  ])("accepts structured %s feedback and normalizes its fact value", (factType, normalizedFactValue, reasonCode) => {
    const parsed = feedbackSchema.parse({
      brokerOrgId: "broker-1",
      submitterClass: "consumer",
      providerNpi: "1234567890",
      factType,
      normalizedFactValue,
      validationStatus: "incorrect",
      reasonCode
    });

    expect(sanitizeFeedbackFactValueOrThrow(parsed.factType, parsed.normalizedFactValue)).toEqual(
      factType === "website"
        ? "https://www.publicclinic.org/contact"
        : expect.any(String)
    );
  });

  it("requires a type-compatible structured reason for incorrect feedback", () => {
    const base = {
      brokerOrgId: "broker-1",
      submitterClass: "producer",
      providerId: "provider-123",
      factType: "website",
      normalizedFactValue: "https://publicclinic.org",
      validationStatus: "incorrect"
    };

    expect(() => feedbackSchema.parse(base)).toThrow(/structured reason/i);
    expect(() => feedbackSchema.parse({ ...base, reasonCode: "wrong_phone" })).toThrow(/not valid for website/i);
    expect(feedbackSchema.parse({ ...base, reasonCode: "wrong_website" }).reasonCode).toBe("wrong_website");
    expect(() => feedbackSchema.parse({
      ...base,
      validationStatus: "correct",
      reasonCode: "outdated"
    })).toThrow(/accurate reason/i);
  });

  it("persists only aggregated normalized structured feedback counts", async () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await saveFeedback({
        brokerOrgId: "broker-1",
        submitterClass: "producer",
        providerNpi: "1234567890",
        providerId: "provider-123",
        factType: "phone",
        normalizedFactValue: "+12164442200",
        validationStatus: "correct"
      });

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(flattenExecuteParameters()).toEqual(
        expect.arrayContaining([
          "broker-1",
          "producer",
          "1234567890",
          "provider-123",
          "phone",
          "+12164442200",
          "correct",
          "accurate",
          1,
          0
        ])
      );
      expect(flattenExecuteParameters().some((value) => value && typeof value === "object")).toBe(false);
      expect(JSON.stringify(consoleLogSpy.mock.calls)).toBe("[]");
      expect(JSON.stringify(consoleWarnSpy.mock.calls)).toBe("[]");
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).toBe("[]");
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("uses non-null consensus identifiers so NPI-only feedback can upsert", async () => {
    await saveFeedback({
      brokerOrgId: "broker-1",
      submitterClass: "broker_admin",
      providerNpi: "1234567890",
      factType: "phone",
      normalizedFactValue: "+12164442200",
      validationStatus: "correct",
      reasonCode: "accurate"
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[0][1]).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "broker-1",
      "broker_admin",
      "1234567890",
      "",
      "phone",
      "+12164442200",
      "correct",
      "accurate",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    ]);
    expect(mockExecute.mock.calls[1][1]).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "broker-1",
      "1234567890",
      "",
      "phone",
      "+12164442200",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      1,
      0
    ]);
  });

  it("treats only correctness feedback as positive consensus", async () => {
    await saveFeedback({
      brokerOrgId: "broker-1",
      submitterClass: "consumer",
      providerNpi: "1234567890",
      factType: "profile",
      normalizedFactValue: "The Cleveland Clinic Foundation",
      validationStatus: "incorrect",
      reasonCode: "outdated"
    });

    expect(mockExecute.mock.calls[1][1].slice(-2)).toEqual([0, 1]);
  });

  it("stores only an aggregated normalized phone-click count, not raw display/source fields", async () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await savePhoneCall({
        brokerOrgId: "broker-1",
        providerNpi: "1234567890",
        providerId: "provider-123",
        normalizedPhone: "+12164442200",
        displayedPhone: "(216) 444-2200",
        sourceUrl: "https://example.invalid/provider",
        prompt: "FORBIDDEN_PROMPT",
        rawResponse: "FORBIDDEN_RAW_RESPONSE",
        clientId: "CLIENT-123"
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute.mock.calls[0][1]).toEqual([
        expect.stringMatching(/^[a-f0-9]{64}$/),
        "broker-1",
        "1234567890",
        "provider-123",
        "+12164442200",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
      ]);
      expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|CLIENT-123/);
      expect(JSON.stringify(consoleWarnSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|CLIENT-123/);
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|CLIENT-123/);
      expect(mockExecute.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE click_count = click_count \+ 1/);
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("persists only a UTC day bucket, never a per-click timestamp or raw event row", async () => {
    await saveFeedback({
      brokerOrgId: "broker-1",
      submitterClass: "consumer",
      providerNpi: "1234567890",
      factType: "address",
      normalizedFactValue: "100 Public Street, Cleveland OH 44113",
      validationStatus: "incorrect",
      reasonCode: "wrong_location"
    });

    const persistenceSql = mockExecute.mock.calls.map(([sql]) => sql).join("\n");
    expect(persistenceSql).toMatch(/feedback_count = feedback_count \+ 1/);
    expect(persistenceSql).toMatch(/feedback_day/);
    expect(persistenceSql).not.toMatch(/created_at|updated_at|last_validated_at|NOW\(\)|event/i);
  });
});

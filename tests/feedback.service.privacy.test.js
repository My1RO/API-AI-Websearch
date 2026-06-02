const mockExecute = jest.fn();

jest.mock("../src/db/data-source", () => ({
  getDataSource: jest.fn().mockResolvedValue({
    query: mockExecute
  })
}));

const {
  assertFeedbackNoteIsSafe,
  saveFeedback,
  savePhoneCall
} = require("../src/services/feedback.service");

const flattenExecuteParameters = () =>
  mockExecute.mock.calls.flatMap(([, params]) => (Array.isArray(params) ? params : []));

describe("feedback persistence privacy guardrails", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], undefined]);
  });

  it.each([
    "member M-123 said this is wrong",
    "client Jane Doe reported it",
    "patient John Doe",
    "DOB 01/02/1970",
    "diagnosis hypertension",
    "diagnosed with asthma",
    "medication metformin",
    "prescription refill",
    "123-45-6789",
    "jane@example.invalid"
  ])("rejects optional feedback notes that look like PHI or client identifiers: %s", (note) => {
    expect(() => assertFeedbackNoteIsSafe(note)).toThrow(/client or PHI data/i);
  });

  it("allows absent or operational feedback notes", () => {
    expect(() => assertFeedbackNoteIsSafe()).not.toThrow();
    expect(() => assertFeedbackNoteIsSafe("Phone number is disconnected")).not.toThrow();
  });

  it("does not write rejected feedback notes to MySQL", async () => {
    await expect(
      saveFeedback({
        brokerOrgId: "broker-1",
        providerNpi: "1234567890",
        factType: "phone",
        normalizedFactValue: "+12164442200",
        validationStatus: "incorrect",
        optionalNote: "client Jane Doe reported this"
      })
    ).rejects.toThrow(/client or PHI data/i);

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("persists only normalized fact feedback fields and ignores notes/raw AI/source/prompt extras", async () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await saveFeedback({
        brokerOrgId: "broker-1",
        providerNpi: "1234567890",
        providerId: "provider-123",
        factType: "phone",
        normalizedFactValue: "+12164442200",
        validationStatus: "correct",
        reasonCode: "accurate",
        optionalNote: "Phone number answered",
        prompt: "FORBIDDEN_PROMPT",
        rawResponse: "FORBIDDEN_RAW_RESPONSE",
        sourceUrl: "https://example.invalid/provider",
        citationPayload: { url: "https://example.invalid/citation" },
        quoteId: "QUOTE-123",
        memberId: "MEMBER-123"
      });

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(flattenExecuteParameters()).toEqual(
        expect.arrayContaining([
          "broker-1",
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
      expect(flattenExecuteParameters()).not.toEqual(
        expect.arrayContaining([
          "Phone number answered",
          "FORBIDDEN_PROMPT",
          "FORBIDDEN_RAW_RESPONSE",
          "https://example.invalid/provider",
          "QUOTE-123",
          "MEMBER-123"
        ])
      );
      expect(flattenExecuteParameters().some((value) => value && typeof value === "object")).toBe(false);
      expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|QUOTE-123|MEMBER-123/);
      expect(JSON.stringify(consoleWarnSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|QUOTE-123|MEMBER-123/);
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|QUOTE-123|MEMBER-123/);
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("uses non-null consensus identifiers so NPI-only feedback can upsert", async () => {
    await saveFeedback({
      brokerOrgId: "broker-1",
      providerNpi: "1234567890",
      factType: "phone",
      normalizedFactValue: "+12164442200",
      validationStatus: "correct",
      reasonCode: "accurate"
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[0][1]).toEqual([
      "broker-1",
      "1234567890",
      null,
      "phone",
      "+12164442200",
      "correct",
      "accurate"
    ]);
    expect(mockExecute.mock.calls[1][1]).toEqual([
      "broker-1",
      "1234567890",
      "",
      "phone",
      "+12164442200",
      1,
      0
    ]);
  });

  it("stores phone click events with the normalized phone value only, not raw display/source fields", async () => {
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
        "broker-1",
        "1234567890",
        "provider-123",
        "+12164442200"
      ]);
      expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|CLIENT-123/);
      expect(JSON.stringify(consoleWarnSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|CLIENT-123/);
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toMatch(/FORBIDDEN_|example\.invalid|CLIENT-123/);
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

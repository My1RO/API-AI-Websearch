const request = require("supertest");

const mockSaveFeedback = jest.fn().mockResolvedValue(undefined);

jest.mock("../src/config/runtime", () => ({
  assertAiRuntimeReady: jest.fn(() => "azure")
}));
jest.mock("../src/services/feedback.service", () => ({
  saveFeedback: mockSaveFeedback,
  savePhoneCall: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../src/services/provider-profile-job.service", () => ({
  createProviderProfileJob: jest.fn(),
  getProviderProfileJob: jest.fn()
}));

const { createApp } = require("../src/app");

describe("provider feedback route privacy", () => {
  beforeEach(() => {
    mockSaveFeedback.mockClear();
  });

  it("derives organization and submitter class from trusted context, not the body", async () => {
    const response = await request(createApp())
      .post("/v1/ai/provider-feedback")
      .set("Lifecycle-Subdomain", "broker-org")
      .set("Lifecycle-User-Class", "producer")
      .send({
        brokerOrgId: "body-org",
        submitterClass: "internal_administrator",
        providerNpi: "1234567890",
        factType: "phone",
        normalizedFactValue: "+12164442200",
        validationStatus: "correct"
      });

    expect(response.status).toBe(201);
    expect(mockSaveFeedback).toHaveBeenCalledWith(expect.objectContaining({
      brokerOrgId: "broker-org",
      submitterClass: "producer"
    }));
  });

  it("never uses an individual user id as broker organization id", async () => {
    const response = await request(createApp())
      .post("/v1/ai/provider-feedback")
      .set("User-Id", "individual-user-123")
      .send({
        providerNpi: "1234567890",
        factType: "profile",
        normalizedFactValue: "Public Clinic",
        validationStatus: "correct"
      });

    expect(response.status).toBe(201);
    expect(mockSaveFeedback).toHaveBeenCalledWith(expect.objectContaining({
      brokerOrgId: "local"
    }));
    expect(JSON.stringify(mockSaveFeedback.mock.calls)).not.toContain("individual-user-123");
  });

  it("rejects free text and tracking identifiers before persistence", async () => {
    const response = await request(createApp())
      .post("/v1/ai/provider-feedback")
      .set("Lifecycle-Subdomain", "broker-org")
      .send({
        providerNpi: "1234567890",
        factType: "profile",
        normalizedFactValue: "Public Clinic",
        validationStatus: "correct",
        optionalNote: "member-specific note",
        sessionId: "session-123"
      });

    expect(response.status).toBe(400);
    expect(mockSaveFeedback).not.toHaveBeenCalled();
  });
});

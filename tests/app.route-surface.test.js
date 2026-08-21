const request = require("supertest");

const mockCreateProviderProfileJob = jest.fn().mockResolvedValue({
  requestId: "route-surface-test",
  status: "queued"
});
const mockGetProviderProfileJob = jest.fn().mockResolvedValue({
  requestId: "00000000-0000-4000-8000-000000000001",
  status: "queued"
});
const mockAssertAiRuntimeReady = jest.fn();

jest.mock("../src/config/runtime", () => ({
  assertAiRuntimeReady: mockAssertAiRuntimeReady
}));

jest.mock("../src/services/provider-profile-job.service", () => ({
  createProviderProfileJob: mockCreateProviderProfileJob,
  getProviderProfileJob: mockGetProviderProfileJob
}));

const { createApp } = require("../src/app");

describe("API route surface", () => {
  beforeEach(() => {
    mockAssertAiRuntimeReady.mockClear();
  });

  it("exposes AI routes under /v1/ai only", async () => {
    const app = createApp();
    const payload = {
      providers: [
        {
          providerId: "provider-123",
          npi: "1234567890",
          name: "Dr. Ada Smith",
          specialty: "Cardiology",
          city: "Boston",
          state: "MA",
          zip: "02108"
        }
      ],
      lineOfCoverage: "Medical"
    };

    const supportedResponse = await request(app).post("/v1/ai/provider-profiles").send(payload);
    const removedCompatibilityResponse = await request(app).post("/api/v1/ai/provider-profiles").send(payload);

    expect(supportedResponse.status).not.toBe(404);
    expect(mockAssertAiRuntimeReady).toHaveBeenCalledTimes(1);
    expect(mockCreateProviderProfileJob).toHaveBeenCalledWith(payload, "local");
    expect(removedCompatibilityResponse.status).toBe(404);
    expect(removedCompatibilityResponse.body.code).toBe("ROUTE_NOT_FOUND");
  });

  it("binds provider-profile creation and polling to the lifecycle tenant context", async () => {
    const app = createApp();
    const requestId = "00000000-0000-4000-8000-000000000001";
    const payload = {
      providers: [{ providerId: "provider-123", name: "Dr. Ada Smith" }],
      lineOfCoverage: "Medical"
    };

    const createResponse = await request(app)
      .post("/v1/ai/provider-profiles")
      .set("Lifecycle-Subdomain", "broker-org")
      .send(payload);
    const pollResponse = await request(app)
      .get(`/v1/ai/provider-profiles/${requestId}`)
      .set("Lifecycle-Subdomain", "broker-org");

    expect(createResponse.status).toBe(202);
    expect(pollResponse.status).toBe(200);
    expect(mockAssertAiRuntimeReady).toHaveBeenCalledTimes(2);
    expect(mockCreateProviderProfileJob).toHaveBeenCalledWith(payload, "broker-org");
    expect(mockGetProviderProfileJob).toHaveBeenCalledWith(requestId, "broker-org");
  });
});

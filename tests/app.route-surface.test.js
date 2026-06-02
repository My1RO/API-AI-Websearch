const request = require("supertest");

const { createApp } = require("../src/app");

describe("API route surface", () => {
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
    expect(removedCompatibilityResponse.status).toBe(404);
    expect(removedCompatibilityResponse.body.code).toBe("ROUTE_NOT_FOUND");
  });
});

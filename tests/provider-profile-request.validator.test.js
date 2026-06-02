const {
  createProviderProfilesSchema
} = require("../src/validators/provider-profile.validator");

describe("provider profile request allowlist", () => {
  const completeProvider = {
    providerId: " provider-123 ",
    npi: "1234567890",
    name: " Dr. Ada Smith ",
    specialty: " Cardiology ",
    city: " Boston ",
    state: "MA",
    zip: "02108"
  };

  it("accepts only the public provider lookup fields with Medical coverage", () => {
    const parsed = createProviderProfilesSchema.parse({
      providers: [completeProvider],
      lineOfCoverage: "Medical"
    });

    expect(parsed).toEqual({
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
    });
  });

  it("strips non-allowlisted request keys before downstream handling", () => {
    const parsed = createProviderProfilesSchema.parse({
      requestComment: "do not persist or forward free text",
      providers: [
        {
          ...completeProvider,
          rawSearchPrompt: "hidden prompt",
          sourceUrl: "https://example.invalid/provider",
          arbitraryMetadata: { value: "hidden metadata" }
        }
      ],
      lineOfCoverage: "Medical"
    });

    expect(parsed).not.toHaveProperty("requestComment");
    expect(parsed.providers[0]).not.toHaveProperty("rawSearchPrompt");
    expect(parsed.providers[0]).not.toHaveProperty("sourceUrl");
    expect(parsed.providers[0]).not.toHaveProperty("arbitraryMetadata");
    expect(Object.keys(parsed.providers[0]).sort()).toEqual([
      "city",
      "name",
      "npi",
      "providerId",
      "specialty",
      "state",
      "zip"
    ]);
  });

  it.each(["Dental", "Vision", "Life", ""])("rejects non-Medical lineOfCoverage %s", (lineOfCoverage) => {
    expect(() =>
      createProviderProfilesSchema.parse({
        providers: [completeProvider],
        lineOfCoverage
      })
    ).toThrow();
  });

  it("rejects malformed provider identifiers", () => {
    expect(() =>
      createProviderProfilesSchema.parse({
        providers: [
          {
            name: "Dr. Ada Smith",
            npi: "123",
            state: "Massachusetts",
            zip: "02108-1234"
          }
        ],
        lineOfCoverage: "Medical"
      })
    ).toThrow();
  });
});

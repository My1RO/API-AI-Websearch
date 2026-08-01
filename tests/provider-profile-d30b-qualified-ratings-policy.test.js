const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileSchema,
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

describe("D31B supersedes D30B model-generated ratings", () => {
  it("removes ratings from the strict model contract and prompt", () => {
    expect(profileShape).not.toHaveProperty("ratings");
    expect(providerProfileSystemInstructions).not.toMatch(/\bratings?\b|\breviews?\b/i);
  });

  it("keeps the public parser backward-compatible with nullable historical scale", () => {
    const parsed = providerProfileSchema.parse({
      providerName: "Ada Smith",
      ratings: [{
        value: "4.8",
        scale: null,
        citation: {
          sourceUrl: "https://ratings.example.org/ada-smith",
          sourceTitle: "Ada Smith ratings",
          providerIdentitySpan: "Ada Smith",
          factSpan: "Rating 4.8",
          explicitFactDateSpan: null
        }
      }]
    });
    expect(parsed.ratings[0].scale).toBeNull();
  });
});

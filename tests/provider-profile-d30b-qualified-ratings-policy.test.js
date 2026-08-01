const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileSchema,
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const ratingShape = profileShape.ratings.element.shape;

describe("D30B qualified independent ratings", () => {
  it("requires complete same-page numeric rating evidence", () => {
    expect(ratingShape.scale.isNullable()).toBe(false);
    expect(ratingShape.citation.description).toMatch(/numeric rating value and its exact numeric maximum scale from this same page/i);
    expect(providerProfileSystemInstructions).toMatch(/Omit the rating when either number is unavailable or uncertain/i);
  });

  it("does not turn cross-site numeric differences into conflicts", () => {
    expect(providerProfileSystemInstructions).toMatch(/independent observations, not conflicting values merely because their numbers differ/i);
    expect(profileShape.ratings.description).toMatch(/qualify and cite each item independently/i);
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

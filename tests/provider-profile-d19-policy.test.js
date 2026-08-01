const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const ratingShape = profileShape.ratings.element.shape;

describe("D19 complete ratings and registry concurrency policy", () => {
  it("does not interpret a bare registry or directory alternate as concurrent operation", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /bare registry or directory listing.*does not by itself establish.*both values operate concurrently/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /active exact-provider first-party page.*do not emit a bare registry or directory alternate.*without separate affirmative concurrent-operation evidence/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /does not make registry or directory evidence invalid when no qualified conflict exists/i
    );
  });

  it("requires a directly supported value and non-null scale for every rating", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Emit a rating only when one opened exact-provider rating page directly provides both the exact numeric rating value and a non-null numeric maximum scale/i
    );
    expect(providerProfileSystemInstructions).toMatch(/Omit the rating when either value or scale is unavailable or uncertain/i);
    expect(ratingShape.scale.isNullable()).toBe(false);
    expect(ratingShape.scale.description).toMatch(/non-null numeric maximum rating scale.*Do not infer a scale/i);
    expect(profileShape.ratings.description).toMatch(/directly supported numeric value and non-null numeric maximum scale/i);
  });

  it("does not substitute a review count for rating evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /do not copy a review count or another unrelated metric into the rating value, scale, or supporting span/i
    );
    expect(ratingShape.value.description).toMatch(/never a review count or another metric/i);
    expect(ratingShape.citation.description).toMatch(/Do not copy a review count or unrelated metric/i);
  });
});

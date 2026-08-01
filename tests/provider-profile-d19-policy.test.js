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

  it("requires a directly supported value and never infers a rating scale", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Emit a rating only when one consulted readable exact-provider rating page directly provides the exact numeric rating value/i
    );
    expect(providerProfileSystemInstructions).toMatch(/otherwise set scale to null.*Never infer a scale/i);
    expect(ratingShape.scale.isNullable()).toBe(true);
    expect(ratingShape.scale.description).toMatch(/or null when that page does not state the scale.*Never infer a scale/i);
    expect(profileShape.ratings.description).toMatch(/directly supported numeric value.*otherwise set scale to null and never infer it/i);
  });

  it("does not substitute a review count for rating evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /never copy a review count or another unrelated metric into the rating value, scale, or supporting span/i
    );
    expect(ratingShape.value.description).toMatch(/never a review count or another metric/i);
    expect(ratingShape.citation.description).toMatch(/Do not copy a review count or unrelated metric/i);
  });
});

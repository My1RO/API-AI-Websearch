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

  it("requires a same-page numeric value and maximum scale", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Emit a rating only when one consulted readable exact-provider rating page directly provides both the exact numeric rating value and that rating's numeric maximum scale/i
    );
    expect(providerProfileSystemInstructions).toMatch(/Never infer a scale, combine a value from one page with a scale from another/i);
    expect(ratingShape.scale.isNullable()).toBe(false);
    expect(ratingShape.scale.description).toMatch(/same consulted readable exact-provider rating page.*Never null, inferred, copied from another page/i);
    expect(profileShape.ratings.description).toMatch(/numeric value and numeric maximum scale directly supported together by one consulted readable exact-provider rating page/i);
  });

  it("does not substitute a review count for rating evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /copy a review count or unrelated metric into the value, scale, or supporting span/i
    );
    expect(ratingShape.value.description).toMatch(/never a review count or another metric/i);
    expect(ratingShape.citation.description).toMatch(/Do not combine evidence across pages or copy a review count or unrelated metric/i);
  });

  it("treats ratings from different systems as independent observations", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /different sites, rating systems, populations, or metrics are independent observations, not conflicting values merely because their numbers differ/i
    );
    expect(profileShape.ratings.description).toMatch(/independent observations and not conflicts merely because their values differ/i);
  });
});

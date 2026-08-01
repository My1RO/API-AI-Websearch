const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const ratingShape = profileShape.ratings.element.shape;
const websiteShape = profileShape.websites.element.shape;

describe("D20 completion and citation repair", () => {
  it("uses remaining search budget to inspect plausible first-party and rating pages before omission", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Before omitting a website or rating, or choosing a lower-tier or different-value source instead, inspect a surfaced plausible exact-provider first-party or rating page/i
    );
    expect(providerProfileSystemInstructions).toMatch(/bare result URL, title, snippet, source listing.*does not/i);
    expect(providerProfileSystemInstructions).toMatch(/Readable page content returned with search counts/i);
    expect(providerProfileSystemInstructions).toMatch(/one consulted readable exact-provider rating page directly provides the exact numeric rating value/i);
  });

  it("requires the emitted website and citation to use the exact opened page URL", () => {
    expect(providerProfileSystemInstructions).toMatch(/website value must be the exact URL of the consulted readable provider.*page/i);
    expect(providerProfileSystemInstructions).toMatch(/Never construct or generalize an inspected subpage into an uninspected root/i);
    expect(websiteShape.value.description).toMatch(/exact URL of the consulted readable provider.*page/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/exact URL of this consulted readable provider.*page/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/must exactly equal the emitted website value/i);
  });

  it("uses the exact cited page URL as direct website evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /website value must be the exact URL.*citation\.sourceUrl must be that same exact URL/i
    );
    expect(websiteShape.citation.description).toMatch(
      /sourceUrl itself is the website URL evidence/i
    );
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/span need not repeat the URL/i);
  });

  it("restores nullable rating scale without inference or review-count substitution", () => {
    expect(ratingShape.scale.isNullable()).toBe(true);
    expect(ratingShape.scale.description).toMatch(/or null when that page does not state the scale/i);
    expect(ratingShape.scale.description).toMatch(/Never infer a scale/i);
    expect(ratingShape.scale.description).toMatch(/never use a review count or another metric/i);
    expect(ratingShape.citation.description).toMatch(/when scale is non-null.*exact numeric maximum scale/i);
  });
});

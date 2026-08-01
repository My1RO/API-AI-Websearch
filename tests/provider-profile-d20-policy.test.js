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
  it("uses remaining search budget for mandatory first-party work before one optional rating query", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Before omitting a website or choosing a lower-tier or different-value source instead, inspect a surfaced plausible exact-provider first-party page/i
    );
    expect(providerProfileSystemInstructions).toMatch(/only after mandatory identity, first-party, contact.*run at most one dedicated exact-provider rating query/i);
    expect(providerProfileSystemInstructions).toMatch(/bare result URL, title, snippet, source listing.*does not/i);
    expect(providerProfileSystemInstructions).toMatch(/Readable page content returned with search counts/i);
    expect(providerProfileSystemInstructions).toMatch(/one consulted readable exact-provider rating page directly provides both the exact numeric rating value and that rating's numeric maximum scale/i);
  });

  it("requires the emitted website and citation to use the exact opened page URL", () => {
    expect(providerProfileSystemInstructions).toMatch(/website value must be the exact URL of the consulted readable provider.*page/i);
    expect(providerProfileSystemInstructions).toMatch(/Never construct or generalize an inspected subpage into an uninspected root/i);
    expect(websiteShape.value.description).toMatch(/exact URL of a consulted readable provider-specific or organization-specific provider.*page/i);
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

  it("requires a same-page rating scale without inference or review-count substitution", () => {
    expect(ratingShape.scale.isNullable()).toBe(false);
    expect(ratingShape.scale.description).toMatch(/same consulted readable exact-provider rating page/i);
    expect(ratingShape.scale.description).toMatch(/Never null, inferred, copied from another page/i);
    expect(ratingShape.scale.description).toMatch(/review count, or another metric/i);
    expect(ratingShape.citation.description).toMatch(/both this exact numeric rating value and its exact numeric maximum scale from this same page/i);
  });
});

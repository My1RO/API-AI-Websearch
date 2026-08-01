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
      /Before omitting a website or rating, or choosing a lower-tier or different-value source instead, use any remaining search budget to open and read a surfaced plausible exact-provider first-party or rating page/i
    );
    expect(providerProfileSystemInstructions).toMatch(/bare URL, title, or snippet is only a discovery lead/i);
    expect(providerProfileSystemInstructions).toMatch(/readable page content returned with search remains eligible evidence without a separate open-page action/i);
    expect(providerProfileSystemInstructions).toMatch(/one consulted readable exact-provider rating page directly provides the exact numeric rating value/i);
  });

  it("requires the emitted website and citation to use the exact opened page URL", () => {
    expect(providerProfileSystemInstructions).toMatch(/Emit the exact URL of the inspected provider.*page/i);
    expect(providerProfileSystemInstructions).toMatch(/do not generalize it to an uninspected health-system root/i);
    expect(websiteShape.value.description).toMatch(/exact URL of the inspected current provider.*readable content was returned in this call/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/readable body or rendered content was returned and inspected in this call/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/whether that readable content was supplied with search or by opening the page/i);
  });

  it("requires a literal website URL span from page-native metadata or rendered text", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /factSpan must literally copy the full emitted URL.*visible rendered text, canonical URL, Open Graph URL, or JSON-LD/i
    );
    expect(websiteShape.citation.description).toMatch(
      /factSpan must literally copy the full emitted URL.*visible rendered text, canonical URL, Open Graph URL, or JSON-LD/i
    );
    expect(websiteShape.citation.description).toMatch(/never construct, normalize, shorten, or paraphrase the URL/i);
  });

  it("restores nullable rating scale without inference or review-count substitution", () => {
    expect(ratingShape.scale.isNullable()).toBe(true);
    expect(ratingShape.scale.description).toMatch(/or null when that page does not state the scale/i);
    expect(ratingShape.scale.description).toMatch(/Never infer a scale/i);
    expect(ratingShape.scale.description).toMatch(/never use a review count or another metric/i);
    expect(ratingShape.citation.description).toMatch(/when scale is non-null.*exact numeric maximum scale/i);
  });
});

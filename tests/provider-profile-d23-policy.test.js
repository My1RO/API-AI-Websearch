const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const websiteShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape.websites.element.shape;

describe("D23 mandatory first-party inspection and direct website citation", () => {
  it("requires inspection of a surfaced plausible first-party page before answering", () => {
    expect(providerProfileSystemInstructions).toMatch(/Mandatory procedure before selecting facts/i);
    expect(providerProfileSystemInstructions).toMatch(
      /Do not stop after inspecting only a registry while a plausible first-party lead remains uninspected/i
    );
    expect(providerProfileSystemInstructions).toMatch(/Opening a first-party page is evidence collection, not permission to emit/i);
  });

  it("preserves different-NPI bundle reconciliation before website emission", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /reconcile every first-party suite, phone, address, and domain bundle against the requested NPI/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /do reject it when the website itself co-binds the conflicting different-NPI bundle/i
    );
    expect(websiteShape.value.description).toMatch(/unresolved different-NPI or different-operation bundle/i);
  });

  it("makes the exact cited URL the website fact without requiring it in page text", () => {
    expect(websiteShape.value.description).toMatch(/must equal this item's citation\.sourceUrl/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/direct URL evidence/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/span need not repeat the URL/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/provider-specific or organization-specific page/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/need not repeat the URL or state who technically operates the site/i);
  });
});

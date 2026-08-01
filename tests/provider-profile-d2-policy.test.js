const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

describe("D2 explicit citation-evidence contract", () => {
  it("binds every fact and both spans to one exact consulted page", () => {
    expect(providerProfileSystemInstructions).toMatch(/For each selected fact, inspect the readable exact-provider pages already consulted/i);
    expect(providerProfileSystemInstructions).toMatch(/not a search-results page, bare snippet, tool-action URL without readable page content, or a different corroborating page/i);
    expect(providerProfileSystemInstructions).toMatch(/short contiguous passage, or faithful rendered-text equivalent/i);
    expect(providerProfileSystemInstructions).toMatch(/Never repair a weak citation by borrowing identity or fact evidence from another page/i);
  });

  it("uses a fact-bound nullable date and rejects freshness proxies in the contract", () => {
    expect(providerProfileSystemInstructions).toMatch(/explicitFactDateSpan must be null unless/i);
    expect(providerProfileSystemInstructions).toMatch(/retrieval dates, copyright years, and generic page-update dates do not qualify/i);
    const dateDescription = providerProfileStructuredOutputSchema.shape.profiles
      .element.shape.specialties.element.shape.citation.shape.explicitFactDateSpan.description;
    expect(dateDescription).toMatch(/exact provider, field, and value/i);
    expect(dateDescription).toMatch(/generic page-update dates do not qualify/i);
  });

  it("adds an in-call readable-page check without a separate audit payload or call", () => {
    expect(providerProfileSystemInstructions).toMatch(/verify separately for every emitted item that readable content from its own sourceUrl was inspected in this call/i);
    expect(providerProfileSystemInstructions).not.toMatch(/silent pre-emission audit|audit every candidate/i);
  });
});

const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const citationShape = profileShape.specialties.element.shape.citation.shape;

describe("D11 bundle reconciliation and readable citation selection", () => {
  it("reconciles same-name different-NPI evidence before any field is emitted", () => {
    expect(providerProfileSystemInstructions).toMatch(/Before emitting any field, reconcile all consulted evidence for same-name, different-NPI entities/i);
    expect(providerProfileSystemInstructions).toMatch(/candidate and bundle level/i);
    expect(providerProfileSystemInstructions).toMatch(/exclusively co-bound address, phone, website, rating, page, or contact bundle/i);
  });

  it("treats websites as bundled candidates and requires independent sharing evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(/website as a candidate inside its page, address, phone, and organization bundle/i);
    expect(providerProfileSystemInstructions).toMatch(/unless independent consulted evidence affirmatively establishes.*same exact candidate.*genuinely shared/i);
    expect(providerProfileSystemInstructions).toMatch(/First-party branding and the same name or location alone cannot rescue it/i);
    expect(profileShape.websites.element.shape.value.description).toMatch(/reconciled as a candidate within its page, address, phone, and organization bundle/i);
  });

  it("selects citations only after eligibility from readable fact-supporting pages", () => {
    expect(providerProfileSystemInstructions).toMatch(/After deciding fact eligibility and selection, cite a consulted page whose body or rendered content you actually read/i);
    expect(providerProfileSystemInstructions).toMatch(/Never choose search-result, snippet-only, metadata-only, title-only, or unread evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/Citation choice cannot make an ineligible candidate eligible/i);
    expect(citationShape.sourceUrl.description).toMatch(/body or rendered content was read/i);
  });

  it("applies Q1 then Q2 then Q3 among eligible readable citations", () => {
    expect(providerProfileSystemInstructions).toMatch(/Among eligible readable pages supporting that same fact, choose an exact first-party provider or organization page first, then an exact-provider government registry including NPPES, then an established exact-provider professional directory/i);
  });

  it("retains D9 conflict and fact-date behavior plus D10 span completeness", () => {
    expect(providerProfileSystemInstructions).toMatch(/lack affirmative concurrent-operation evidence, emit at most one/i);
    expect(providerProfileSystemInstructions).toMatch(/registry record's enumeration, creation, or last-update date does not date every fact/i);
    expect(citationShape.factSpan.description).toMatch(/complete emitted value or faithful formatting equivalent/i);
  });
});

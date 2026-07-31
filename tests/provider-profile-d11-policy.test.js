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
    expect(providerProfileSystemInstructions).toMatch(/bundle that exclusively co-binds it.*another NPI or another provider operation/i);
    expect(providerProfileSystemInstructions).toMatch(/omit that candidate before recency or source priority/i);
    expect(providerProfileSystemInstructions).toMatch(/Apply this field-locally and preserve unrelated facts/i);
  });

  it("treats websites as bundled candidates and requires independent sharing evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(/website as a candidate inside its page, address, phone, and organization bundle/i);
    expect(providerProfileSystemInstructions).toMatch(/separate affirmative evidence attaches the exact same value to the requested provider/i);
    expect(providerProfileSystemInstructions).toMatch(/exact requested NPI, or by exact requested name plus compatible organization or location on a provider-specific page/i);
    expect(providerProfileSystemInstructions).toMatch(/establishes nonexclusive or shared use/i);
    expect(providerProfileSystemInstructions).toMatch(/Same branding, general affiliation, a health-system homepage, or absence of exclusivity is insufficient/i);
    expect(profileShape.websites.element.shape.value.description).toMatch(/reconciled as a candidate within its page, address, phone, and organization bundle/i);
    expect(profileShape.websites.element.shape.citation.description).toMatch(/exact requested name plus compatible organization or location/i);
  });

  it("selects citations only after eligibility from readable fact-supporting pages", () => {
    expect(providerProfileSystemInstructions).toMatch(/After selecting an eligible value, choose its citation independently/i);
    expect(providerProfileSystemInstructions).toMatch(/highest-priority eligible page whose body or rendered content you actually inspected/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not cite metadata-only, error, snippet-only, title-only, unavailable, or unread evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not replace a more provider-specific fact with a different general value merely because.*source tier is higher/i);
    expect(providerProfileSystemInstructions).toMatch(/Citation choice cannot make an ineligible candidate eligible/i);
    expect(citationShape.sourceUrl.description).toMatch(/body or rendered content was read/i);
  });

  it("applies Q1 then Q2 then Q3 among eligible readable citations", () => {
    expect(providerProfileSystemInstructions).toMatch(/final source-hierarchy tie-breaker.*otherwise-equivalent eligible values, prefer an exact first-party provider or organization page, then an exact-provider government registry including NPPES, then an established exact-provider professional directory/i);
    expect(providerProfileSystemInstructions).toMatch(/Prefer the highest-priority eligible page whose body or rendered content you actually inspected/i);
  });

  it("retains D9 conflict and fact-date behavior plus D10 span completeness", () => {
    expect(providerProfileSystemInstructions).toMatch(/lack affirmative concurrent-operation evidence, emit at most one/i);
    expect(providerProfileSystemInstructions).toMatch(/registry record's enumeration, creation, or last-update date does not date every fact/i);
    expect(citationShape.factSpan.description).toMatch(/complete emitted value or faithful formatting equivalent/i);
    expect(citationShape.explicitFactDateSpan.description).toMatch(/co-binds the complete exact value and an explicit effective or current date/i);
    expect(citationShape.explicitFactDateSpan.description).toMatch(/Undated supported evidence remains eligible/i);
  });
});

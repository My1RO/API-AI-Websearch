const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

describe("D13 first-party inspection and implicated-website policy", () => {
  it("treats search source metadata as discovery rather than page-body evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /bare result URL, title, snippet, source listing, or exact-NPI search metadata does not/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /plausible first-party provider.*inspect that exact provider, location, or contact page before answering/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /multiple plausible current and legacy domains.*inspect the likely current first-party domain before choosing or omitting a website/i
    );
  });

  it("requires exact-NPI shared-use proof for any expressly implicated candidate", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /expressly co-binds a candidate or its operational bundle to another NPI or another provider operation/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Omit an implicated candidate unless separate affirmative evidence explicitly attaches the exact same value to the requested NPI and establishes nonexclusive or shared use/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /exact-NPI evidence about a different value is insufficient/i
    );
  });

  it("preserves field-local and ordinary shared-asset handling", () => {
    expect(providerProfileSystemInstructions).toMatch(/For an ordinary candidate not expressly co-bound.*do not demand proof that the asset is exclusive/i);
    expect(providerProfileSystemInstructions).toMatch(/Apply this field-locally and preserve unrelated facts/i);
    expect(providerProfileSystemInstructions).toMatch(/Undated supported evidence remains eligible/i);
  });

  it("treats request location as a stale search seed rather than a current-truth gate", () => {
    expect(providerProfileSystemInstructions).toMatch(/Requested city, state, and ZIP may be stale/i);
    expect(providerProfileSystemInstructions).toMatch(/search seeds and disambiguation hints, not current-truth gates/i);
    expect(providerProfileSystemInstructions).toMatch(/location mismatch alone cannot reject an identity-qualified current or additional first-party professional contact/i);
  });

  it("uses operational-currentness without inventing a fact date", () => {
    expect(providerProfileSystemInstructions).toMatch(/Only after a candidate has passed exact-provider identity and other-NPI or other-operation reconciliation/i);
    expect(providerProfileSystemInstructions).toMatch(/inspected active provider-specific first-party page.*operational-currentness evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/Presumptively select that eligible value over an undated registry or directory alternate/i);
    expect(providerProfileSystemInstructions).toMatch(/cannot make an ineligible or implicated different-NPI or different-operation candidate eligible and cannot rescue one/i);
    expect(providerProfileSystemInstructions).toMatch(/keep explicitFactDateSpan null/i);
  });

  it("uses sourceUrl as direct URL evidence while requiring page-local operation evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(/sourceUrl is the direct URL evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/page-local text that establishes the exact provider or compatible organization operates that page or site/i);
    expect(profileShape.websites.element.shape.citation.description).toMatch(/sourceUrl itself is the website URL evidence/i);
    expect(profileShape.websites.element.shape.citation.description).toMatch(/address-only or phone-only passage cannot support a website/i);
  });
});

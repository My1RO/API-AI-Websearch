const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const citationShape = profileShape.specialties.element.shape.citation.shape;

describe("D10 current-default and span-fidelity repair", () => {
  it("inherits the D9 conflict/default and date rules", () => {
    expect(providerProfileSystemInstructions).toMatch(/lack affirmative concurrent-operation evidence, emit at most one/i);
    expect(providerProfileSystemInstructions).toMatch(/Select among values using exact-provider attachment, professional purpose and specificity, compatible location, conflict evidence, and then fact-specific recency/i);
    expect(providerProfileSystemInstructions).toMatch(/source hierarchy only as the last tie-breaker when eligible values remain otherwise equivalent/i);
    expect(providerProfileSystemInstructions).toMatch(/registry record's enumeration, creation, or last-update date does not date every fact/i);
    expect(providerProfileSystemInstructions).toMatch(/Undated supported evidence remains eligible/i);
    for (const field of ["locations", "phoneNumbers"]) {
      expect(profileShape[field].description).toMatch(/otherwise emit at most the one best eligible/i);
    }
  });

  it("requires short page-local spans without synthesis", () => {
    expect(providerProfileSystemInstructions).toMatch(/Copy the shortest sufficient spans verbatim/i);
    expect(providerProfileSystemInstructions).toMatch(/Never use ellipses, combine noncontiguous passages, paraphrase/i);
    expect(citationShape.providerIdentitySpan.description).toMatch(/short contiguous passage.*shortest sufficient passage verbatim/i);
    expect(citationShape.factSpan.description).toMatch(/Never use ellipses, combine noncontiguous passages, paraphrase/i);
  });

  it("binds identity and complete fact values within their own spans", () => {
    expect(providerProfileSystemInstructions).toMatch(/providerIdentitySpan must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not require providerIdentitySpan to contain NPI merely because the page displays NPI in another region/i);
    expect(providerProfileSystemInstructions).toMatch(/factSpan must contain the complete emitted value or faithful punctuation, whitespace, postal, or rendered-text equivalent/i);
    expect(citationShape.providerIdentitySpan.description).toMatch(/exact-NPI evidence in a separate region.*do not require this local span to contain NPI/i);
    expect(citationShape.factSpan.description).toMatch(/complete emitted value or faithful formatting equivalent/i);
  });

  it("retains D8 entity safety and current-domain behavior", () => {
    expect(providerProfileSystemInstructions).toMatch(/assigns a candidate, or a bundle that exclusively co-binds it, to another NPI or another provider operation/i);
    expect(providerProfileSystemInstructions).toMatch(/shared-asset exception uses separate affirmative evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/prefer the qualified current first-party URL and omit the unresolved legacy alternate/i);
  });
});

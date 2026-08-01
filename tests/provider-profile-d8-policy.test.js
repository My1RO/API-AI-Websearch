const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const citationShape = profileShape.specialties.element.shape.citation.shape;

describe("D8 concise single-pass synthesis", () => {
  it("states one ordered workflow without a second audit pass", () => {
    expect(providerProfileSystemInstructions).toMatch(/Process each candidate in this order/i);
    expect(providerProfileSystemInstructions).toMatch(/attach it to the exact requested entity.*verify.*professional purpose.*resolve.*recency.*source priority/i);
    expect(providerProfileSystemInstructions).not.toMatch(/silently audit|audit every|second call|second response|open_page/i);
  });

  it("handles candidate-specific NPI conflicts and shared assets", () => {
    expect(providerProfileSystemInstructions).toMatch(/assigns a candidate, or a bundle that exclusively co-binds it, to another NPI or another provider operation/i);
    expect(providerProfileSystemInstructions).toMatch(/shared-asset exception uses separate affirmative evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/suite or location mismatch by itself is not express another-NPI or another-operation evidence/i);
  });

  it("keeps undated evidence eligible and orders only qualified facts", () => {
    expect(providerProfileSystemInstructions).toMatch(/Undated supported evidence remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/otherwise-equivalent eligible values/i);
    expect(providerProfileSystemInstructions).toMatch(/NPPES is valid but can be stale/i);
    expect(providerProfileSystemInstructions).toMatch(/official branding is not correctness or independent corroboration/i);
  });

  it("uses one page per direct fact citation and explicit-date semantics", () => {
    expect(providerProfileSystemInstructions).toMatch(/Every emitted fact needs one direct citation/i);
    expect(providerProfileSystemInstructions).toMatch(/factSpan.*from the same page/i);
    expect(providerProfileSystemInstructions).toMatch(/explicitFactDateSpan must be null unless/i);
    expect(citationShape.providerIdentitySpan.description).toMatch(/from this cited page/i);
    expect(citationShape.factSpan.description).toMatch(/from this same cited page/i);
  });

  it("keeps current-domain imputation narrow and field order explicit", () => {
    expect(providerProfileSystemInstructions).toMatch(/identity-qualified first-party page may establish operation of its own domain without a publication date/i);
    expect(providerProfileSystemInstructions).toMatch(/without evidence that both operate concurrently.*prefer the qualified current first-party domain/i);
    for (const field of ["locations", "phoneNumbers", "websites"]) {
      expect(profileShape[field].description).toMatch(/Index zero must be the best eligible default/i);
    }
  });
});

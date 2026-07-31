const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const citationShape = profileShape.specialties.element.shape.citation.shape;

describe("D6 balanced entity, conflict, hierarchy, and citation synthesis", () => {
  it("qualifies exact identity before source priority without using specialty as a gate", () => {
    const identity = providerProfileSystemInstructions.indexOf("Before source priority, resolve candidate-specific identity conflicts");
    const hierarchy = providerProfileSystemInstructions.indexOf("Among eligible comparably supported facts");
    expect(identity).toBeGreaterThan(-1);
    expect(hierarchy).toBeGreaterThan(identity);
    expect(providerProfileSystemInstructions).toMatch(/specialty is a weak, possibly stale cross-check/i);
    expect(providerProfileSystemInstructions).toMatch(/specialty difference must not reject an exact NPI-and-name match/i);
  });

  it("rejects candidate-specific different-NPI attachment but preserves truly shared assets", () => {
    expect(providerProfileSystemInstructions).toMatch(/affirmatively assigns a candidate fact.*different NPI/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not reject a genuinely shared health-system, group, facility, scheduling line, homepage, or address/i);
    expect(providerProfileSystemInstructions).toMatch(/rejection requires affirmative candidate-specific exclusive or incompatible attachment/i);
  });

  it("keeps undated evidence and resolves website conflicts without inventing a date", () => {
    expect(providerProfileSystemInstructions).toMatch(/keep undated evidence eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/first-party page.*currently operated even when.*no publication date/i);
    expect(providerProfileSystemInstructions).toMatch(/evidence of operation, not a claimed fact date/i);
    expect(providerProfileSystemInstructions).toMatch(/both domains are concurrently operated.*prefer the identity-qualified first-party domain/i);
  });

  it("orders default values only after qualification and requires compatible additional facts", () => {
    expect(providerProfileSystemInstructions).toMatch(/Return multiple values only when evidence affirmatively establishes them as compatible concurrent professional facts/i);
    for (const field of ["locations", "phoneNumbers", "websites"]) {
      expect(profileShape[field].description).toMatch(/Index zero must be the best eligible default/i);
      expect(profileShape[field].description).toMatch(/concurrent/i);
    }
  });

  it("uses direct page-local citations and one model response without audit output", () => {
    expect(citationShape.providerIdentitySpan.description).toMatch(/from this cited page/i);
    expect(citationShape.factSpan.description).toMatch(/from this same cited page/i);
    expect(providerProfileSystemInstructions).toMatch(/Before the one final response/i);
    expect(providerProfileSystemInstructions).toMatch(/never borrow spans across pages/i);
    expect(providerProfileSystemInstructions).toMatch(/Emit no audit labels, rejected candidates, reasoning, or second payload/i);
    expect(providerProfileSystemInstructions).not.toMatch(/open_page|second call/i);
  });

  it("keeps the public shape parsimonious and excludes plan fields", () => {
    expect(Object.keys(profileShape)).toEqual([
      "providerId", "npi", "providerName", "specialties", "locations",
      "phoneNumbers", "ratings", "websites"
    ]);
    expect(Object.keys(citationShape)).toEqual([
      "sourceUrl", "sourceTitle", "providerIdentitySpan", "factSpan", "explicitFactDateSpan"
    ]);
    expect(JSON.stringify(providerProfileStructuredOutputSchema)).not.toMatch(/insurance|network|plan/i);
  });
});

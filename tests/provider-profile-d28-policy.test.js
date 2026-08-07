const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const sharedCitationShape = profileShape.phoneNumbers.element.shape.citation.shape;
const websiteArray = profileShape.websites;

describe("D28 alternate-NPI relevance and citation-only pass", () => {
  it("does not bind a merely similar alternate-NPI lead to a candidate", () => {
    const relevanceGate = providerProfileSystemInstructions.indexOf(
      "First determine whether an alternate-NPI lead is relevant to this candidate"
    );
    const alternateNpiAction = providerProfileSystemInstructions.indexOf(
      "When search exposes the same organization name under another NPI"
    );

    expect(relevanceGate).toBeGreaterThanOrEqual(0);
    expect(alternateNpiAction).toBeGreaterThan(relevanceGate);
    expect(providerProfileSystemInstructions).toMatch(
      /First determine whether an alternate-NPI lead is relevant.*same complete legal, DBA, or alias name/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Shared name fragments, a merely similar but nonmatching name, geographic proximity, or appearance in results from a site- or domain-restricted query is not co-binding/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /An irrelevant alternate-NPI lead cannot implicate or suppress an otherwise eligible website/i
    );
  });

  it("preserves the conservative same-complete-name operational-bundle conflict", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /relevance gate does not weaken a same-complete-name conflict.*address, suite, or phone assigned to the alternate NPI/i
    );
    expect(websiteArray.description).toMatch(
      /same-complete-name alternate NPI whose assigned operational value is displayed by the candidate page remains relevant/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /ordinary exact-name attachment rule never rescues a domain implicated/i
    );
  });

  it("performs source hierarchy as a citation-only pass over the selected value", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /After values are fixed, perform one mandatory citation-only pass/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /If any exact-provider first-party page supports that same value, cite the best such Q1 page/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Otherwise cite inspected same-value exact-provider government evidence.*professional-directory evidence/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /This pass changes only the citation, never the selected value/i
    );
  });

  it("puts the same-value source hierarchy in the shared citation schema", () => {
    expect(sharedCitationShape.sourceUrl.description).toMatch(
      /compare this exact selected value with every inspected readable exact-provider first-party page/i
    );
    expect(sharedCitationShape.sourceUrl.description).toMatch(
      /this must be that exact first-party URL.*same-value government evidence before eligible directory evidence/i
    );
    expect(sharedCitationShape.sourceUrl.description).toMatch(
      /citation choice never changes the selected value/i
    );
  });

  it("makes website completion conditional on the explicit relevance gate", () => {
    expect(websiteArray.description).toMatch(
      /Before leaving this array empty because of an alternate-NPI lead, apply the relevance gate/i
    );
    expect(websiteArray.description).toMatch(
      /merely similar but nonmatching name, unrelated base address, or appearance in a site\/domain query cannot suppress/i
    );
    expect(websiteArray.safeParse([]).success).toBe(true);
  });

  it("does not change the strict public structured-output surface", () => {
    expect(Object.keys(profileShape.websites.element.shape)).toEqual(["value", "citation"]);
    expect(Object.keys(sharedCitationShape)).toEqual([
      "sourceUrl",
      "providerIdentitySpan",
      "factSpan",
      "explicitFactDateSpan"
    ]);
  });
});

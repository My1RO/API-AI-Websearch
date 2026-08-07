const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");
const {
  sanitizeProviderProfiles
} = require("../src/services/provider-profile-sanitizer.service");

const fixture = require("./fixtures/provider-profile-citation-metadata-privacy/p053-control-r2-r3.json");

describe("citation metadata privacy contract", () => {
  const citationSchema = providerProfileStructuredOutputSchema
    .shape.profiles.element.shape.specialties.element.shape.citation;

  it("covers the exact P053 CONTROL_R2/R3 residential-title regression", () => {
    expect(fixture.provenance).toMatch(/Development-set.*P053 CONTROL_R2 and CONTROL_R3.*no holdout/i);
    expect(fixture.cases).toHaveLength(2);

    for (const regression of fixture.cases) {
      expect(regression.observedSourceTitle).toBe(
        "Tessa Evett Smith · 607 Oakley St, Unit 1, Houston, TX 77006-5976 · Emergency Medicine Physician"
      );
      expect(JSON.stringify(regression.expectedStructuredCitation)).not.toContain("607 Oakley");
      expect(citationSchema.parse(regression.expectedStructuredCitation)).toEqual(
        regression.expectedStructuredCitation
      );
    }
  });

  it("does not let the model emit page title/name metadata", () => {
    expect(citationSchema.shape).not.toHaveProperty("sourceTitle");
    expect(() => citationSchema.parse({
      ...fixture.cases[0].expectedStructuredCitation,
      sourceTitle: fixture.cases[0].observedSourceTitle
    })).toThrow();
  });

  it("derives the outward title from sourceUrl instead of relaying model metadata", () => {
    for (const regression of fixture.cases) {
      const [profile] = sanitizeProviderProfiles([{
        providerId: "1386828655",
        npi: "1386828655",
        providerName: "DR. TESSA EVETT SMITH M.D",
        specialties: [{
          value: regression.factValue,
          citation: {
            ...regression.expectedStructuredCitation,
            sourceTitle: regression.observedSourceTitle
          }
        }],
        locations: [],
        phoneNumbers: [],
        ratings: [],
        websites: []
      }]);

      expect(profile.specialties[0].citation.sourceTitle).toBe(regression.expectedPublicSourceTitle);
      expect(JSON.stringify(profile)).not.toContain("607 Oakley");
    }
  });

  it("does not add a semantic classifier, host fetch, or second-call field", () => {
    expect(Object.keys(citationSchema.shape)).toEqual([
      "sourceUrl",
      "providerIdentitySpan",
      "factSpan",
      "explicitFactDateSpan"
    ]);
    expect(Object.keys(providerProfileStructuredOutputSchema.shape)).toEqual(["profiles"]);
    expect(providerProfileSystemInstructions).toMatch(
      /Prohibited contact data must not appear anywhere in the returned profile, including citation fields/i
    );
    expect(providerProfileSystemInstructions).not.toMatch(/sourceTitle|nullable source|source-title/i);
  });
});

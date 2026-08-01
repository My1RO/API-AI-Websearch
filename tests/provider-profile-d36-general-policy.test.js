const fs = require("fs");
const path = require("path");
const {
  buildProviderProfilePrompt,
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const fixture = require("./fixtures/provider-profile-d36/trace-derived-general-rules.json");
const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const specialtyCitation = profileShape.specialties.element.shape.citation;
const phoneCitation = profileShape.phoneNumbers.element.shape.citation;
const locationCitation = profileShape.locations.element.shape.citation;
const websiteShape = profileShape.websites.element.shape;

describe("D36 generalized production prompt and structured-output contract", () => {
  it("uses only abstracted sealed development evidence", () => {
    expect(fixture.provenance).toMatch(
      /Development-only abstractions.*sealed D33\/D34\/D35 R8.*fixed gpt-5\.6-sol\/high.*No holdout data, network access, or new model calls/i
    );
    expect(fixture.scenarios.map(({ scenarioId }) => scenarioId)).toEqual([
      "exact-source-quotation-vs-normalized-output",
      "field-local-evidence-before-hierarchy",
      "first-party-biography-website",
      "bounded-search-stop"
    ]);
    expect(JSON.stringify(fixture)).not.toMatch(/\bP\d{3}\b|\b\d{10}\b/);
  });

  it("separates an exact source quotation from the normalized fact value", () => {
    const scenario = fixture.scenarios[0];
    expect(scenario.requiredBehavior).toMatch(/factSpan as an exact contiguous source quotation.*separately emitted value.*normalize/i);
    expect(providerProfileSystemInstructions).toMatch(
      /factSpan is an exact source quotation independent of the normalized output value.*Never invent a field label, expand or abbreviate a source token.*rewrite the quotation to match the normalized output/is
    );
    expect(specialtyCitation.shape.factSpan.description).toMatch(
      /exact source quotation.*independent of the normalized output value.*must not invent labels.*never expand or abbreviate a source token.*substitute a postal abbreviation/is
    );
    expect(specialtyCitation.description).toMatch(/factSpan is independent of the normalized specialty value/i);
    expect(phoneCitation.description).toMatch(/exact source quotation.*Preserve the source's displayed phone formatting/i);
    expect(locationCitation.description).toMatch(
      /exact source quotation.*Preserve source tokens such as Street or West Virginia.*output normalizes them to St or WV/i
    );
    expect(websiteShape.citation.shape.factSpan.description).toMatch(
      /page-local passage.*as an exact quotation.*normalize whitespace and Unicode typography only when the rendered words, tokens, and token order do not change/is
    );
  });

  it("applies source hierarchy only among sources qualified for the same field", () => {
    const scenario = fixture.scenarios[1];
    expect(scenario.requiredBehavior).toMatch(/Qualify each source for the exact field first.*Q1 lacks that fact.*Q2 or Q3/i);
    expect(providerProfileSystemInstructions).toMatch(
      /qualify evidence separately for every field before applying source priority.*Q1 page that identifies the provider but does not expose the field.*must not suppress.*Q2 or Q3/is
    );
    expect(specialtyCitation.shape.sourceUrl.description).toMatch(
      /first-party page counts as Q1 for this item only when.*supports this exact fact, not merely provider identity.*government evidence before eligible directory evidence.*If no Q1 page exposes this fact, do not withhold/is
    );
    expect(specialtyCitation.description).toMatch(/Q1 identity page that does not expose this specialty.*must not suppress.*Q2 or Q3/i);
    expect(phoneCitation.description).toMatch(/Q1 identity page that does not expose this phone.*must not suppress.*Q2 or Q3/i);
    expect(locationCitation.description).toMatch(/Q1 identity page that does not expose this address.*must not suppress.*Q2 or Q3/i);
  });

  it("accepts a strongly identified first-party biography without requiring NPI or contact parity", () => {
    const scenario = fixture.scenarios[2];
    expect(scenario.requiredBehavior).toMatch(/full-name.*compatible-credential-or-specialty.*compatible-practice-or-location/i);
    expect(providerProfileSystemInstructions).toMatch(
      /provider-specific first-party biography or team page.*unambiguous full name, a compatible credential or specialty, and a compatible practice or location.*does not need to repeat the NPI, phone, address/is
    );
    expect(websiteShape.value.description).toMatch(
      /unambiguous full name, a compatible credential or specialty, and a compatible practice or location.*need not repeat the NPI, phone, address/is
    );
    expect(profileShape.websites.description).toMatch(
      /unambiguous full name, a compatible credential or specialty, and a compatible practice or location.*need not show.*contact parity/is
    );
  });

  it("stops redundant search after all treatment-relevant evidence is sufficient", () => {
    const scenario = fixture.scenarios[3];
    expect(scenario.requiredBehavior).toMatch(/Stop once identity.*fact-local support.*first-party inspection.*conflict resolution/i);
    expect(providerProfileSystemInstructions).toMatch(
      /web-search call limit is a ceiling, not a target.*Stop broadening or repeating searches once exact-provider identity is established.*every selected fact has its own readable fact-local support/is
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Do not chase unrelated providers, unrelated NPIs, generic directories, or duplicate queries.*Continue searching only for a specific missing field, unread cited page, unresolved relevant conflict, or surfaced better fact-local source/is
    );
  });

  it("does not add a second model call, host fetch, plan data, or D36 host behavior", () => {
    const prompt = buildProviderProfilePrompt({
      lineOfCoverage: "Medical",
      providers: [{
        providerId: "provider-1",
        npi: "1234567893",
        name: "Public Provider",
        specialty: "Family Medicine",
        city: "Example City",
        state: "MA",
        zip: "02108"
      }]
    });
    expect(prompt).not.toMatch(/insurance|payer|health.?plan|network|coverage|enrollment/i);
    expect(JSON.stringify(providerProfileStructuredOutputSchema._def)).not.toMatch(
      /publicInsurance|insuranceMentions|payer|network|coverage|enrollment/i
    );
    for (const relativePath of [
      "src/services/ai-provider/response-parser.ts",
      "src/services/provider-profile-sanitizer.service.ts",
      "src/services/ai-provider/responses-provider.client.ts",
      "src/services/ai-provider/search-request-config.ts",
      "src/config/env.ts",
      "src/config/runtime.ts"
    ]) {
      const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
      expect(source).not.toMatch(/D36|d36/i);
    }
  });
});

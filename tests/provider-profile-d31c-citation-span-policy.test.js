const fs = require("fs");
const path = require("path");
const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const specialtyCitation = profileShape.specialties.element.shape.citation;
const websiteCitation = profileShape.websites.element.shape.citation;
const traceFixture = require("./fixtures/provider-profile-d33/trace-derived-span-cases.json");

describe("D33 balanced citation-span discipline", () => {
  it("defines rendered-text equivalence as formatting normalization, not synthesis", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /faithful rendered-text equivalent narrowly.*normalize markup, whitespace, punctuation, capitalization, and standard value formatting.*preserving the source token order/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /never permits invented labels, omitted intervening text, reordered tokens, or concatenation of separate page regions/i
    );
  });

  it("puts the same narrow rule in both general citation span fields", () => {
    for (const field of ["providerIdentitySpan", "factSpan"]) {
      const description = specialtyCitation.shape[field].description;
      expect(description).toMatch(/short contiguous passage, item-local to this fact.*readable body or rendered content.*shortest sufficient passage verbatim/i);
      expect(description).toMatch(/preserving source token order/i);
      expect(description).toMatch(/must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions/i);
    }
  });

  it("also constrains website-specific span overrides", () => {
    for (const field of ["providerIdentitySpan", "factSpan"]) {
      const description = websiteCitation.shape[field].description;
      expect(description).toMatch(/shortest sufficient contiguous (?:passage, item-local to this website, copied|page-local passage copied) from this page/i);
      expect(description).toMatch(/never invent labels, omit intervening text, reorder tokens, or concatenate separate page regions/i);
    }
  });

  it("separates whole-page identity qualification from item-local span evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /First qualify the cited page.*using all readable page content.*Then copy two separate item-local excerpts/i
    );
    expect(specialtyCitation.shape.providerIdentitySpan.description).toMatch(
      /Page-level identity qualification may use all readable content.*exact-NPI evidence in a separate region/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Do not require providerIdentitySpan to contain NPI merely because the page displays NPI in another region/i
    );
    expect(specialtyCitation.shape.factSpan.description).toMatch(/separate from providerIdentitySpan.*need not be adjacent/i);
  });

  it("does not turn span adjacency into an otherwise-eligible-fact omission rule", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /do not omit an otherwise eligible fact merely because page-level NPI evidence and the fact appear in separate regions/i
    );
    expect(providerProfileSystemInstructions).not.toMatch(/If one compliant contiguous span cannot be copied/i);
    expect(specialtyCitation.shape.providerIdentitySpan.description).not.toMatch(/use another.*or omit the item/i);
    expect(specialtyCitation.shape.factSpan.description).not.toMatch(/use another.*or omit the item/i);
  });

  it("requires exact local identity and warns against shortened common-name attachment", () => {
    expect(traceFixture.provenance).toMatch(/Development-only.*No holdout data and no new model calls/i);
    expect(traceFixture.cases.map(({ caseId }) => caseId)).toEqual(["P024", "P001"]);
    for (const citation of [specialtyCitation, websiteCitation]) {
      expect(citation.shape.providerIdentitySpan.description).toMatch(
        /either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location/i
      );
      expect(citation.shape.providerIdentitySpan.description).toMatch(
        /shortened given-name-plus-surname passage is not exact.*common name.*same span contains the exact requested NPI/i
      );
    }
  });

  it("preserves D31B specialty semantics and no-ratings model contract", () => {
    expect(profileShape.specialties.element.shape.value.description).toMatch(/PA-C to Physician Assistant/i);
    expect(profileShape.specialties.element.shape.citation.description).toMatch(/Do not apply a literal-only specialty wording gate/i);
    expect(profileShape).not.toHaveProperty("ratings");
  });

  it("adds no host fetch, semantic gate, sanitizer, client, or runtime behavior", () => {
    const productionSources = [
      "src/services/ai-provider/response-parser.ts",
      "src/services/provider-profile-sanitizer.service.ts",
      "src/services/ai-provider/responses-provider.client.ts",
      "src/services/ai-provider/search-request-config.ts",
      "src/config/env.ts",
      "src/config/runtime.ts"
    ];
    for (const relativePath of productionSources) {
      const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
      expect(source).not.toMatch(/balancedSpanD33|commonNameCitationGate|pageLevelIdentityGate/);
    }
  });
});

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

describe("D31C citation-span discipline relative to D31B", () => {
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
      expect(description).toMatch(/short contiguous passage.*readable body or rendered content.*shortest sufficient passage verbatim/i);
      expect(description).toMatch(/preserving source token order/i);
      expect(description).toMatch(/must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions/i);
    }
  });

  it("also constrains website-specific span overrides", () => {
    for (const field of ["providerIdentitySpan", "factSpan"]) {
      const description = websiteCitation.shape[field].description;
      expect(description).toMatch(/shortest sufficient contiguous page-local passage copied from this page/i);
      expect(description).toMatch(/never invent labels, omit intervening text, reorder tokens, or concatenate separate page regions/i);
    }
  });

  it("uses an already-inspected readable same-value source or omits when a compliant span is unavailable", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /If one compliant contiguous span cannot be copied.*use another already-inspected readable same-value page.*omit the item/i
    );
    expect(specialtyCitation.shape.providerIdentitySpan.description).toMatch(
      /use another already-inspected readable same-value page or omit the item/i
    );
    expect(specialtyCitation.shape.factSpan.description).toMatch(
      /use another already-inspected readable same-value page or omit the item/i
    );
  });

  it("preserves D31B specialty semantics and no-ratings model contract", () => {
    expect(profileShape.specialties.element.shape.value.description).toMatch(/PA-C to Physician Assistant/i);
    expect(profileShape.specialties.element.shape.citation.description).toMatch(/Do not apply a literal-only specialty wording gate/i);
    expect(profileShape).not.toHaveProperty("ratings");
  });

  it("adds no host fetch, parser, sanitizer, client, or runtime behavior", () => {
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
      expect(source).not.toMatch(/citationSpanDisciplineD31C/);
    }
  });
});

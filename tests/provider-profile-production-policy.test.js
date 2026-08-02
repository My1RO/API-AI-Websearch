const { zodTextFormat } = require("openai/helpers/zod");

const {
  buildProviderProfilePrompt,
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const providerInput = {
  lineOfCoverage: "Medical",
  providers: [{
    providerId: "provider-123",
    npi: "1234567890",
    name: "Ada Smith",
    specialty: "Family Medicine",
    city: "Boston",
    state: "MA",
    zip: "02110"
  }]
};

const citation = {
  sourceUrl: "https://provider.example.org/ada-smith",
  sourceTitle: "Ada Smith, MD",
  providerIdentitySpan: "Ada Smith, MD — NPI 1234567890",
  factSpan: "Family Medicine",
  explicitFactDateSpan: null
};

describe("current provider-profile production policy", () => {
  it("keeps exact identity primary and request context advisory", () => {
    expect(providerProfileSystemInstructions).toMatch(/NPI plus name are primary identity/i);
    expect(providerProfileSystemInstructions).toMatch(/location may be stale search context/i);
    expect(providerProfileSystemInstructions).toMatch(/specialty is a weak cross-check/i);
    expect(providerProfileSystemInstructions).toMatch(/Results, snippets, titles, URLs, and error\/challenge pages are leads, not readable evidence/i);
  });

  it("qualifies each fact before conflict, recency, and source priority", () => {
    const qualification = providerProfileSystemInstructions.indexOf("Qualify each fact independently");
    const recency = providerProfileSystemInstructions.indexOf("fact-bound recency");
    const priority = providerProfileSystemInstructions.indexOf("then source priority");

    expect(qualification).toBeGreaterThanOrEqual(0);
    expect(recency).toBeGreaterThan(qualification);
    expect(priority).toBeGreaterThan(recency);
    expect(providerProfileSystemInstructions).toMatch(/Tier, branding, or recency cannot rescue an ineligible fact/i);
    expect(providerProfileSystemInstructions).toMatch(/first-party, then government including NPPES, then established professional directory/i);
    expect(providerProfileSystemInstructions).toMatch(/NPPES may be stale; official is not necessarily correct/i);
  });

  it("keeps safety and cross-NPI decisions semantic and field-local", () => {
    expect(providerProfileSystemInstructions).toMatch(/same-name alternate-NPI evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/Conflicts are field-local: address\/phone conflict does not implicate a domain/i);
    expect(providerProfileSystemInstructions).toMatch(/professional voice numbers, never fax, mobile\/cell, personal\/home, or uncertain-purpose/i);
    expect(providerProfileSystemInstructions).toMatch(/never residential, people-search, place-name-only, or uncertain-purpose/i);
  });

  it("keeps undated evidence eligible and does not invent fact dates", () => {
    expect(providerProfileSystemInstructions).toMatch(/Record-wide registry dates do not date each fact; undated support remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/explicitFactDateSpan quotes an effective\/current date co-bound to this fact, else null/i);
  });

  it("requires one direct page-local citation per fact", () => {
    expect(providerProfileSystemInstructions).toMatch(/Give every fact one citation to a consulted readable page supporting identity and its complete value/i);
    expect(providerProfileSystemInstructions).toMatch(/providerIdentitySpan and factSpan are shortest sufficient contiguous quotations/i);
    expect(providerProfileSystemInstructions).toMatch(/no ellipses, joined regions, paraphrase, invented labels, or token rewriting/i);
    expect(providerProfileSystemInstructions).toMatch(/website is the exact consulted readable provider\/organization first-party page URL and equals citation\.sourceUrl/i);
  });

  it("keeps plan and network data outside the model contract while retaining Medical API compatibility", () => {
    const prompt = buildProviderProfilePrompt(providerInput);
    const format = zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles");

    expect(prompt).toContain("Medical providers");
    expect(prompt).toContain('"npi":"1234567890"');
    expect(prompt).toContain('"specialty":"Family Medicine"');
    expect(prompt).not.toMatch(/lineOfCoverage|insurance|payer|health.?plan|network|coverage|enrollment/i);
    expect(JSON.stringify(format.schema)).not.toMatch(/insurance|payer|health.?plan|network|coverage|enrollment/i);
    expect(providerProfileSystemInstructions).toMatch(/Never search for or return insurance, payer, plan\/network\/coverage\/enrollment/i);
  });

  it("uses strict structured output with direct citations and no ratings", () => {
    const parsed = providerProfileStructuredOutputSchema.parse({
      profiles: [{
        providerId: "provider-123",
        npi: "1234567890",
        providerName: "Ada Smith",
        specialties: [{ value: "Family Medicine", citation }],
        locations: [],
        phoneNumbers: [],
        websites: []
      }]
    });
    const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

    expect(parsed.profiles[0].specialties[0].citation).toEqual(citation);
    expect(profileShape).not.toHaveProperty("ratings");
    expect(profileShape).not.toHaveProperty("sources");
    expect(profileShape).not.toHaveProperty("confidenceNotes");
    expect(() => providerProfileStructuredOutputSchema.parse({
      profiles: [{ ...parsed.profiles[0], ratings: [] }]
    })).toThrow();
  });

  it("pins the complete minimized static model contract", () => {
    const format = zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles");
    const userPrompt = buildProviderProfilePrompt({
      lineOfCoverage: "Medical",
      providers: [{
        providerId: "<providerId>",
        npi: "1234567890",
        name: "<name>",
        specialty: "<specialty>",
        city: "<city>",
        state: "NY",
        zip: "12345"
      }]
    });
    const schema = JSON.stringify(format.schema);
    const totalBytes = [providerProfileSystemInstructions, schema, userPrompt]
      .reduce((sum, value) => sum + Buffer.byteLength(value), 0);

    expect(schema).not.toContain('"description"');
    expect(totalBytes).toBe(11196);
  });
});

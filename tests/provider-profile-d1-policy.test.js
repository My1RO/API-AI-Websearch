const providerInput = {
  lineOfCoverage: "Medical",
  providers: [{
    providerId: "1104373091",
    npi: "1104373091",
    name: "YORDALYS RODRIGUEZ PEREZ",
    specialty: "Behavior Analyst",
    city: "MIAMI",
    state: "FL",
    zip: "33129"
  }]
};

const loadPolicy = () => {
  jest.resetModules();
  return {
    ...require("../src/services/prompt-builder.service"),
    ...require("../src/validators/provider-profile.validator")
  };
};

describe("D1 concise direct-citation policy", () => {
  afterEach(() => jest.resetModules());

  it("uses exact identity, location scope, and specialty only as a weak cross-check", () => {
    const { providerProfileSystemInstructions, buildProviderProfilePrompt } = loadPolicy();
    const prompt = buildProviderProfilePrompt(providerInput);

    expect(providerProfileSystemInstructions).toMatch(/NPI plus name are primary identity/i);
    expect(providerProfileSystemInstructions).toMatch(/location scopes contacts but cannot override identity/i);
    expect(providerProfileSystemInstructions).toMatch(/specialty is a weak, possibly stale cross-check and never an identity gate/i);
    expect(prompt).toContain('"city":"MIAMI","state":"FL","zip":"33129"');
  });

  it("uses exact readable-page provenance without a second-call audit", () => {
    const { providerProfileSystemInstructions } = loadPolicy();

    expect(providerProfileSystemInstructions).toMatch(/sourceUrl must be the exact URL associated with that readable fact-supporting page content/i);
    expect(providerProfileSystemInstructions).toMatch(/For each selected fact, inspect the readable exact-provider pages already consulted/i);
    expect(providerProfileSystemInstructions).toMatch(/Never cite an unread, metadata-only, access-challenge, rate-limit, or error page/i);
    expect(providerProfileSystemInstructions).not.toMatch(/silently audit every fact|pre-emission audit/i);
  });

  it("qualifies evidence before conflicts and conditional hierarchy", () => {
    const { providerProfileSystemInstructions } = loadPolicy();
    const qualification = providerProfileSystemInstructions.indexOf("attach it to the exact requested entity");
    const conflicts = providerProfileSystemInstructions.indexOf("resolve candidate-specific identity and same-field conflicts");
    const hierarchy = providerProfileSystemInstructions.indexOf("then apply source priority and order the output");

    expect(qualification).toBeGreaterThanOrEqual(0);
    expect(conflicts).toBeGreaterThan(qualification);
    expect(hierarchy).toBeGreaterThan(conflicts);
    expect(providerProfileSystemInstructions).toMatch(/Source class, apparent recency, or official branding cannot rescue an ineligible fact/i);
    expect(providerProfileSystemInstructions).toMatch(/NPPES is valid but can be stale/i);
    expect(providerProfileSystemInstructions).toMatch(/official branding is not correctness or independent corroboration/i);
  });

  it("keeps undated evidence eligible and makes conflict omission field-local", () => {
    const { providerProfileSystemInstructions } = loadPolicy();

    expect(providerProfileSystemInstructions).toMatch(/Undated supported evidence remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/explicitFactDateSpan must be null/i);
    expect(providerProfileSystemInstructions).toMatch(/Omit a former, legacy, or unresolved conflicting candidate while preserving unrelated facts/i);
  });

  it("keeps plan data outside the prompt and strict output contract", () => {
    const {
      providerProfileSystemInstructions,
      buildProviderProfilePrompt,
      providerProfileStructuredOutputSchema
    } = loadPolicy();
    const prompt = buildProviderProfilePrompt(providerInput);
    const contract = JSON.stringify(providerProfileStructuredOutputSchema._def);

    expect(providerProfileSystemInstructions).toMatch(/Do not search for, send back, infer, or discuss insurance, payer, health-plan, network, coverage, enrollment, or plan participation/i);
    expect(prompt).not.toMatch(/insurance|payer|health.?plan|network|coverage|enrollment/i);
    expect(contract).not.toMatch(/publicInsurance|insuranceMentions|payer|network|coverage|enrollment/i);
    expect(`${providerProfileSystemInstructions}\n${prompt}`).not.toMatch(/return json|respond with json|```json/i);
  });

  it("defines one complete citation object for every final fact and no legacy source table", () => {
    const { providerProfileStructuredOutputSchema } = loadPolicy();
    const parsed = providerProfileStructuredOutputSchema.parse({
      profiles: [{
        providerId: "1104373091",
        npi: "1104373091",
        providerName: "Yordalys Rodriguez Perez",
        specialties: [{
          value: "Behavior Analyst",
          citation: {
            sourceUrl: "https://registry.example.org/provider/1104373091",
            providerIdentitySpan: "Yordalys Rodriguez Perez NPI 1104373091",
            factSpan: "Specialty: Behavior Analyst",
            explicitFactDateSpan: null
          }
        }],
        locations: [],
        phoneNumbers: [],
        websites: []
      }]
    });

    expect(parsed.profiles[0].specialties[0].citation).toEqual(expect.objectContaining({
      sourceUrl: expect.any(String),
      providerIdentitySpan: expect.any(String),
      factSpan: expect.any(String),
      explicitFactDateSpan: null
    }));
    expect(parsed.profiles[0]).not.toHaveProperty("sources");
    expect(parsed.profiles[0]).not.toHaveProperty("confidenceNotes");
  });
});

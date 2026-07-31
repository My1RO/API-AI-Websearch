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
    expect(providerProfileSystemInstructions).toMatch(/Location scopes and orders contact facts but never overrides exact identity/i);
    expect(providerProfileSystemInstructions).toMatch(/specialty difference must not reject an exact NPI-and-name match/i);
    expect(prompt).toContain('"city":"MIAMI","state":"FL","zip":"33129"');
  });

  it("uses broad consulted-page provenance and contains no open-page requirement", () => {
    const { providerProfileSystemInstructions } = loadPolicy();

    expect(providerProfileSystemInstructions).toMatch(/sourceUrl is the exact consulted public page supporting that fact/i);
    expect(providerProfileSystemInstructions).toMatch(/Every emitted fact must carry its own citation object/i);
    expect(providerProfileSystemInstructions).not.toMatch(/open_page|opened page|must be opened/i);
    expect(providerProfileSystemInstructions).not.toMatch(/silently audit every fact|pre-emission audit/i);
  });

  it("qualifies evidence before conflicts and conditional hierarchy", () => {
    const { providerProfileSystemInstructions } = loadPolicy();
    const qualification = providerProfileSystemInstructions.indexOf("First qualify");
    const conflicts = providerProfileSystemInstructions.indexOf("Second resolve");
    const hierarchy = providerProfileSystemInstructions.indexOf("Third apply");

    expect(qualification).toBeGreaterThanOrEqual(0);
    expect(conflicts).toBeGreaterThan(qualification);
    expect(hierarchy).toBeGreaterThan(conflicts);
    expect(providerProfileSystemInstructions).toMatch(/Source class, recency, or official branding cannot rescue an ineligible fact/i);
    expect(providerProfileSystemInstructions).toMatch(/NPPES is valid but can be stale/i);
    expect(providerProfileSystemInstructions).toMatch(/Official does not mean correct or independent/i);
  });

  it("keeps undated evidence eligible and makes conflict omission field-local", () => {
    const { providerProfileSystemInstructions } = loadPolicy();

    expect(providerProfileSystemInstructions).toMatch(/Undated exact-provider professional evidence remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/explicitFactDateSpan must be null/i);
    expect(providerProfileSystemInstructions).toMatch(/omit only the disputed field or value, not the otherwise supported profile/i);
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
            sourceTitle: "Provider record",
            providerIdentitySpan: "Yordalys Rodriguez Perez NPI 1104373091",
            factSpan: "Specialty: Behavior Analyst",
            explicitFactDateSpan: null
          }
        }],
        locations: [],
        phoneNumbers: [],
        ratings: [],
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

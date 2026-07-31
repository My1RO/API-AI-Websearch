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

const loadPromptBuilder = () => {
  jest.resetModules();
  return require("../src/services/prompt-builder.service");
};

describe("V10 location and opened-evidence prompt policy", () => {
  afterEach(() => jest.resetModules());

  it("keeps location out of identity while enforcing contact product scope", () => {
    const { providerProfileSystemInstructions, buildProviderProfilePrompt } = loadPromptBuilder();
    const prompt = buildProviderProfilePrompt(providerInput);

    expect(providerProfileSystemInstructions).toMatch(/Location never decides exact NPI-and-name identity/i);
    expect(providerProfileSystemInstructions).toMatch(/requested city, state, and ZIP define the product scope for contact facts/i);
    expect(providerProfileSystemInstructions).toMatch(/Never substitute a contact in a conflicting state or clearly incompatible city or region/i);
    expect(providerProfileSystemInstructions).toMatch(/returning empty locations and phoneNumbers instead of an out-of-scope contact/i);
    expect(prompt).toContain('"city":"MIAMI","state":"FL","zip":"33129"');
  });

  it("requires a silent final audit against actual open_page actions", () => {
    const { providerProfileSystemInstructions } = loadPromptBuilder();

    expect(providerProfileSystemInstructions).toMatch(/silently audit provenance/i);
    expect(providerProfileSystemInstructions).toMatch(/sources array must be a subset of the exact URLs you opened with open_page/i);
    expect(providerProfileSystemInstructions).toMatch(/URL merely listed by a search action is not opened/i);
    expect(providerProfileSystemInstructions).toMatch(/Delete every fact whose source was not opened or whose exact value is not directly contained or established by that same opened page body/i);
    expect(providerProfileSystemInstructions).toMatch(/delete orphaned sources/i);
  });

  it("uses conflict-specific dates without rejecting undated evidence", () => {
    const { providerProfileSystemInstructions } = loadPromptBuilder();

    expect(providerProfileSystemInstructions).toMatch(/contact evidence conflicts across locations or values/i);
    expect(providerProfileSystemInstructions).toMatch(/prefer a newer explicit date only when it governs that same disputed contact fact/i);
    expect(providerProfileSystemInstructions).toMatch(/undated exact-provider professional page remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/must not be rejected only because it has no date/i);
  });

  it("permits one real first-party upgrade and rejects directory branding", () => {
    const { providerProfileSystemInstructions } = loadPromptBuilder();

    expect(providerProfileSystemInstructions).toMatch(/initial search has no exact first-party/i);
    expect(providerProfileSystemInstructions).toMatch(/at most one targeted first-party upgrade search/i);
    expect(providerProfileSystemInstructions).toMatch(/Retain exact-supported lower-tier facts unless the opened first-party page directly supersedes the same field/i);
    expect(providerProfileSystemInstructions).toMatch(/page publisher must be the provider, practice, clinic, facility, hospital, or health system itself/i);
    expect(providerProfileSystemInstructions).toMatch(/find-a-provider directory, verified-profile badge, official-looking branding/i);
    expect(providerProfileSystemInstructions).toMatch(/directory profile URL is never a website fact/i);
  });
});

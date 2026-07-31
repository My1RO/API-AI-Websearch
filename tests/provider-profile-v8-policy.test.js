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

describe("V8 evidence-open prompt policy", () => {
  afterEach(() => jest.resetModules());

  it("starts precise, keeps location subordinate to identity, and broadens only after need", () => {
    const { providerProfileSystemInstructions } = loadPromptBuilder();

    expect(providerProfileSystemInstructions).toMatch(/first search for the exact NPI together with the quoted full provider name and the requested city and state/i);
    expect(providerProfileSystemInstructions).toMatch(/adding ZIP when useful/i);
    expect(providerProfileSystemInstructions).toMatch(/Use location only to disambiguate and prioritize relevant contacts, never as an identity requirement/i);
    expect(providerProfileSystemInstructions).toMatch(/If that precise search does not establish useful facts, broaden to exact NPI plus quoted full name without location/i);
    expect(providerProfileSystemInstructions).toMatch(/specialty difference must not defeat or narrow an exact NPI-and-name match/i);
  });

  it("requires opened-page support and rejects search-result-only evidence", () => {
    const { providerProfileSystemInstructions } = loadPromptBuilder();

    expect(providerProfileSystemInstructions).toMatch(/Open every exact webpage you intend to use as a claim source/i);
    expect(providerProfileSystemInstructions).toMatch(/opened page body directly contains or establishes the exact fact/i);
    expect(providerProfileSystemInstructions).toMatch(/search-results page, result title, or snippet is discovery evidence only/i);
    expect(providerProfileSystemInstructions).toMatch(/never cite it or emit a fact supported only by it/i);
    expect(providerProfileSystemInstructions).toMatch(/Each fact's sourceId must reference its exact opened supporting page/i);
  });

  it("uses the requested location first and stops tier chasing after sufficient evidence", () => {
    const { providerProfileSystemInstructions } = loadPromptBuilder();

    expect(providerProfileSystemInstructions).toMatch(/maximum of eight web-search tool calls/i);
    expect(providerProfileSystemInstructions).toMatch(/Never select a different-location contact over an exact-supported professional contact at the requested location/i);
    expect(providerProfileSystemInstructions).toMatch(/established professional directory remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(/stop; do not spend remaining calls chasing a higher-tier source/i);
    expect(providerProfileSystemInstructions).toMatch(/official' status are never proof|official' status is never proof/i);
  });

  it("preserves V6 field policy and uses null instead of punctuation placeholders", () => {
    const { providerProfileSystemInstructions, buildProviderProfilePrompt } = loadPromptBuilder();
    const fullPrompt = buildProviderProfilePrompt(providerInput);
    const identityPrompt = buildProviderProfilePrompt(providerInput, { identityOnly: true });
    const fullProviders = JSON.parse(fullPrompt.split("Providers: ")[1]);
    const identityProviders = JSON.parse(identityPrompt.split("Providers: ")[1]);

    expect(providerProfileSystemInstructions).toMatch(/scale is only the numeric maximum/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not search for or return insurance, payer, health-plan, network, or coverage information/i);
    expect(providerProfileSystemInstructions).not.toMatch(/insurance count|insurance-acceptance statement/i);
    expect(providerProfileSystemInstructions).toMatch(/nullable field with no supported value, return null/i);
    expect(providerProfileSystemInstructions).toMatch(/never use punctuation such as '\.', ',', or '-' as a placeholder/i);
    expect(fullProviders).toEqual([providerInput.providers[0]]);
    expect(identityProviders).toEqual([{
      providerId: "1104373091",
      npi: "1104373091",
      name: "YORDALYS RODRIGUEZ PEREZ"
    }]);
    expect(`${providerProfileSystemInstructions}\n${fullPrompt}`).not.toMatch(/return json|respond with json|```json/i);
  });
});

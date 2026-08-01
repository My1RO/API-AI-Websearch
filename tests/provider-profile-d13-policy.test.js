const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");

describe("D13 first-party inspection and implicated-website policy", () => {
  it("treats search source metadata as discovery rather than page-body evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /URL in search-result lists or source metadata is a discovery lead, not proof that you inspected the page body/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /inspect that exact page's body before choosing among competing websites, locations, or phone bundles/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /multiple plausible current and legacy domains.*inspect the likely current first-party domain before choosing or omitting a website/i
    );
  });

  it("requires exact-NPI shared-use proof only for an implicated website bundle", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /inspected website's address, phone, and operation bundle is affirmatively assigned.*another NPI/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /omit it unless separate affirmative evidence explicitly attaches that exact domain to the requested NPI and establishes nonexclusive or shared use/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Same name, branding, base-address overlap, general affiliation, or absence of exclusivity is insufficient for this implicated website/i
    );
  });

  it("preserves field-local and ordinary shared-asset handling", () => {
    expect(providerProfileSystemInstructions).toMatch(/For other candidates, the shared-asset exception applies/i);
    expect(providerProfileSystemInstructions).toMatch(/Apply this field-locally and preserve unrelated facts/i);
    expect(providerProfileSystemInstructions).toMatch(/Undated supported evidence remains eligible/i);
  });
});

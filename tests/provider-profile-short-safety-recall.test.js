const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("short provider contract safety and recall", () => {
  const profile = providerProfileStructuredOutputSchema.shape.profiles.element;

  it("checks a contact-bearing exact-NPI page before returning specialty only", () => {
    expect(providerProfileSystemInstructions).toMatch(/search quoted name plus exact NPI.*open the best surfaced first-party provider\/contact page/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not stop at a registry/i);
    expect(providerProfileSystemInstructions).toMatch(/After opening, emit every eligible supported field/i);
    expect(providerProfileSystemInstructions).toMatch(/Return a profile when any eligible fact remains, including specialty only/i);
  });

  it("resolves alternate-NPI, same-name geography, and phone-purpose conflicts", () => {
    expect(providerProfileSystemInstructions).toMatch(/same-name alternate NPI surfaces, open its exact-NPI source before emitting a first-party contact or domain/i);
    expect(providerProfileSystemInstructions).toMatch(/An implicated value or domain needs requested-provider attachment/i);
    expect(providerProfileSystemInstructions).toMatch(/bare tel link is insufficient/i);
    expect(providerProfileSystemInstructions).toMatch(/opened exact-provider first-party professional contact controls a conflicting registry\/directory value/i);
  });

  it("gives phones and locations concise field-specific structured-output contracts", () => {
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/Professional voice number/);
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/first-party contact controls a conflicting registry\/directory value/i);
    expect(profile.shape.locations.element.description).toMatch(/never residential/i);
    expect(profile.shape.locations.element.description).toMatch(/citation\.factSpan contains every non-null address component/i);
    expect(profile.shape.locations.element.shape.addressLine2.description).toMatch(/never punctuation-only/i);
    expect(profile.shape.locations.element.shape.state.unwrap()._def.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "regex" })
    ]));
    expect(profile.shape.phoneNumbers.element.shape.citation.shape.factSpan.description).toMatch(/every phone digit plus voice purpose/i);
  });
});

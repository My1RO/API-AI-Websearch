const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("short provider contract safety and recall", () => {
  const profile = providerProfileStructuredOutputSchema.shape.profiles.element;

  it("checks a contact-bearing exact-NPI page before returning specialty only", () => {
    expect(providerProfileSystemInstructions).toMatch(/Complete this search workflow before answering/i);
    expect(providerProfileSystemInstructions).toMatch(/open the best surfaced first-party provider\/contact page.*best exact-NPI page whose lead shows a phone or address/i);
    expect(providerProfileSystemInstructions).toMatch(/Do not stop after a registry search/i);
    expect(providerProfileSystemInstructions).toMatch(/emit every eligible supported fact rather than a subset/i);
  });

  it("resolves alternate-NPI, same-name geography, and phone-purpose conflicts", () => {
    expect(providerProfileSystemInstructions).toMatch(/After evidence qualification, reconcile contact\/domain candidates/i);
    expect(providerProfileSystemInstructions).toMatch(/same-name non-NPI page is ineligible.*incompatible provider or location/i);
    expect(providerProfileSystemInstructions).toMatch(/bare tel link is insufficient/i);
    expect(providerProfileSystemInstructions).toMatch(/For an unresolved same-field conflict, prefer qualified current exact-provider first-party evidence/i);
  });

  it("gives phones and locations concise field-specific structured-output contracts", () => {
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/Professional voice number/);
    expect(profile.shape.locations.element.description).toMatch(/never residential/i);
    expect(profile.shape.locations.element.shape.state.unwrap()._def.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "length", value: 2 }),
      expect.objectContaining({ kind: "regex" })
    ]));
    expect(profile.shape.phoneNumbers.element.shape.citation.shape.factSpan.description).toMatch(/phone-purpose label/i);
  });
});

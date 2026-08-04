const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("short provider contract safety and recall", () => {
  const profile = providerProfileStructuredOutputSchema.shape.profiles.element;

  it("checks a contact-bearing exact-NPI page before returning specialty only", () => {
    expect(providerProfileSystemInstructions).toMatch(/Before returning specialty only, inspect the best readable exact-NPI page likely to contain professional contacts/i);
  });

  it("resolves alternate-NPI, same-name geography, and phone-purpose conflicts", () => {
    expect(providerProfileSystemInstructions).toMatch(/reconcile every consulted readable lead.*another NPI or operation/i);
    expect(providerProfileSystemInstructions).toMatch(/same-name non-NPI page.*affirmative relocation or continuity evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/generic tel link does not resolve a fax conflict/i);
  });

  it("gives phones and locations concise field-specific structured-output contracts", () => {
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/Professional voice number/);
    expect(profile.shape.locations.element.description).toMatch(/never residential/i);
    expect(profile.shape.locations.element.shape.addressLine1.description).toMatch(/professional office/i);
  });
});

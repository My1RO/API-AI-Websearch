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
    expect(providerProfileSystemInstructions).toMatch(/opened exact-provider first-party page shows a professional contact, emit it and no conflicting government\/registry\/directory value/i);
  });

  it("gives phones and locations concise field-specific structured-output contracts", () => {
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/Professional voice number/);
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/explicitly labels its phone\/main\/scheduling purpose/i);
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/first-party page shows one, emit it and no conflicting government\/registry\/directory number/i);
    expect(profile.shape.locations.element.description).toMatch(/never residential/i);
    expect(profile.shape.locations.element.description).toMatch(/citation\.factSpan contains every non-null address component/i);
    expect(profile.shape.locations.element.shape.addressLine2.description).toMatch(/never punctuation-only/i);
    expect(profile.shape.locations.element.shape.state.unwrap()._def.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "regex" })
    ]));
    expect(profile.shape.phoneNumbers.element.shape.citation.shape.factSpan.description).toMatch(/every phone digit plus voice purpose/i);
  });

  it("does not attach an individual to a generic organization or location page", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /For an individual, do not cite a general organization\/location page for any fact unless that page names the provider; another page cannot supply the missing identity/i
    );
  });

  it("establishes provider identity on each fact's own cited page", () => {
    const citation = profile.shape.specialties.element.shape.citation.shape;
    expect(citation.providerIdentitySpan.description).toMatch(/literally occurs on sourceUrl/i);
    expect(citation.providerIdentitySpan.description).toMatch(/never borrow identity from another page/i);
    expect(citation.providerIdentitySpan.description).toMatch(/omit the fact/i);
  });

  it("does not preserve a phone solely because a residential registry bundle labels it Phone", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /If its only support co-lists it with an address this call found residential, omit the phone unless another readable page identifies that number as an office, scheduling, clinic, facility, or hospital voice contact/i
    );
  });
});

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
    expect(providerProfileSystemInstructions).toMatch(/Preserve multiple independently supported eligible professional contacts/i);
  });

  it("discovers and preserves eligible competing contacts unless fact-bound evidence resolves them", () => {
    expect(providerProfileSystemInstructions).toMatch(/search every plausible current phone\/address candidate surfaced by those required searches before selecting/i);
    expect(providerProfileSystemInstructions).toMatch(/Resolve phones and addresses independently/i);
    expect(providerProfileSystemInstructions).toMatch(/Preserve multiple independently supported eligible professional contacts/i);
    expect(providerProfileSystemInstructions).toMatch(/identifies one as former, closed, wrong, or another as current\/primary\/active for that exact fact/i);
    expect(providerProfileSystemInstructions).toMatch(/Lower-tier disagreement and request location alone do not prove an eligible contact obsolete/i);
    expect(providerProfileSystemInstructions).toMatch(/A status or date controls only the exact fact it explicitly governs/i);
  });

  it("gives phones and locations concise field-specific structured-output contracts", () => {
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/Professional voice number/);
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/explicitly labels its phone\/main\/scheduling purpose/i);
    expect(profile.shape.phoneNumbers.element.shape.value.description).toMatch(/Preserve independently supported eligible numbers/i);
    expect(profile.shape.locations.element.description).toMatch(/never residential/i);
    expect(profile.shape.locations.element.description).toMatch(/citation\.factSpan contains every emitted non-null address component/i);
    expect(profile.shape.locations.element.shape.addressLine2.description).toMatch(/never punctuation-only/i);
    expect(profile.shape.locations.element.shape.state.unwrap()._def.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "regex" })
    ]));
    expect(profile.shape.phoneNumbers.element.shape.citation.shape.factSpan.description).toMatch(/every phone digit plus voice purpose/i);
  });

  it("does not attach an individual to a generic organization or location page", () => {
    expect(profile.shape.locations.element.description).toMatch(/This cited page itself identifies the exact provider/i);
    expect(profile.shape.locations.element.description).toMatch(/citation\.factSpan contains every emitted non-null address component/i);
  });

  it("limits websites to exact first-party provider or organization pages", () => {
    expect(providerProfileSystemInstructions).toMatch(/first-party provider or organization page that names or identifies the requested provider/i);
    expect(profile.shape.websites.description).toMatch(/name or identify the exact requested provider/i);
    expect(profile.shape.websites.description).toMatch(/Never a directory, marketplace, social, search, or listing page/i);
    expect(providerProfileSystemInstructions).not.toMatch(/open every cited page/i);
  });

  it("rejects incompatible no-NPI individual pages without suppressing exact-NPI facts", () => {
    expect(providerProfileSystemInstructions).toMatch(/Location mismatch never rejects exact-NPI evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/no-NPI individual page from a materially different professional city\/state as a different person/i);
    expect(providerProfileSystemInstructions).toMatch(/do not let its rejected values suppress exact-NPI facts/i);
    expect(profile.shape.websites.description).toMatch(/no-NPI individual page from a materially different professional city\/state/i);
    expect(profile.shape.locations.element.description).toMatch(/this cited page itself identifies the exact provider/i);
  });

  it("treats dwelling vocabulary as residential unless professional use is established", () => {
    expect(providerProfileSystemInstructions).toMatch(/condominium\/condo, townhouse, apartment, other dwelling/i);
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

const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const websiteShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape.websites.element.shape;

describe("D25 same-name different-NPI website conflict resolution", () => {
  it("prioritizes a surfaced first-party page over redundant registry inspection", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /FIRST obtain readable content for the best surfaced plausible exact-provider first-party page/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /(?:Do not|Never) inspect a redundant registry or directory while required first-party or relevant alternate-NPI evidence remains uninspected/i
    );
  });

  it("requires readable inspection of a surfaced same-name different NPI before website emission", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /same organization name under another NPI, inspect readable evidence for that NPI before emitting any website/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /if that other-NPI evidence cannot be inspected, omit only the website and preserve independently qualified facts/i
    );
    expect(websiteShape.value.description).toMatch(
      /eligible only after readable evidence for that NPI is inspected/i
    );
  });

  it("treats an alternate-NPI subpart bundle on the candidate site as domain implication", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /candidate site displays a suite, complete address, phone, or other operational value.*same-name different-NPI organizational subpart/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /site and domain are implicated rather than merely affected by an unrelated field conflict/i
    );
    expect(websiteShape.citation.description).toMatch(/no unresolved operational-bundle conflict remains/i);
  });

  it("does not let name plus compatible address rescue an implicated domain", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /ordinary exact-name attachment rule never rescues a domain implicated/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /never rescues a domain implicated by a different NPI, organizational subpart, or provider operation/i
    );
  });

});

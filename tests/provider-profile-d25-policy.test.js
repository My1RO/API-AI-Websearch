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
      /do not inspect a second registry or directory while a surfaced plausible first-party page remains uninspected/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /inspect that first-party page next, unless its readable body was already returned with search/i
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
      /legal, DBA, or alias plus compatible complete-address rule may attach an otherwise unimplicated domain only/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /never rescues a domain implicated by a different NPI, organizational subpart, or provider operation/i
    );
  });

  it("uses remaining search budget for one exact-provider rating query", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /if no numeric rating lead has surfaced and tool budget remains, run one exact-provider name plus NPI rating or reviews query/i
    );
    expect(providerProfileSystemInstructions).toMatch(/before leaving ratings empty/i);
  });
});

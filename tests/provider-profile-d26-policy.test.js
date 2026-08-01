const fixture = require("./fixtures/provider-profile-d26/trace-derived-policy-cases.json");
const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const websiteShape = profileShape.websites.element.shape;

describe("D26 trace-corrected production prompt contract", () => {
  it("records compact real-trace-derived scenarios without holdout data", () => {
    expect(fixture.cases.map(({ caseId }) => caseId)).toEqual(["P009", "P035", "P039", "P020"]);
    expect(fixture.provenance).toMatch(/fresh D25 pilot traces/i);
    expect(fixture.provenance).toMatch(/no model calls or holdout data/i);
  });

  it("removes fallback rating search while retaining surfaced ratings", () => {
    expect(providerProfileSystemInstructions).toMatch(/Ratings remain eligible only when a numeric lead surfaces/i);
    expect(providerProfileSystemInstructions).toMatch(/(?:do not|never) run a dedicated rating or reviews query/i);
    expect(providerProfileSystemInstructions).toMatch(
      /After exact-NPI identity, do not answer until this action order is complete: FIRST obtain readable content.*first-party page.*SECOND inspect.*alternate-NPI evidence.*THIRD.*rating page/i
    );
    expect(providerProfileSystemInstructions).not.toMatch(
      /run one exact-provider name plus NPI rating or reviews query/i
    );
  });

  it("makes surfaced exact-provider first-party inspection outrank redundant directories", () => {
    const caseFixture = fixture.cases.find(({ caseId }) => caseId === "P035");
    expect(caseFixture.registryLabel).toBe("Secondary Practice Location");
    expect(providerProfileSystemInstructions).toMatch(
      /(?:Do not|Never) inspect a redundant registry or directory while required first-party or relevant alternate-NPI evidence remains uninspected/i
    );
    expect(providerProfileSystemInstructions).toMatch(/FIRST obtain readable content for the best surfaced plausible exact-provider first-party page/i);
  });

  it("does not infer concurrent conflicting bundles from a secondary-location registry label", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Secondary Practice Location.*by itself it never proves current concurrent operation/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /never emit multiple conflicting registry-only location or phone bundles on that basis/i
    );
    expect(profileShape.locations.description).toMatch(/Secondary Practice Location.*does not by itself prove current concurrent operation/i);
    expect(profileShape.phoneNumbers.description).toMatch(/Secondary Practice Location.*does not by itself prove current concurrent operation/i);
  });

  it("inspects surfaced same-name alternate-NPI evidence or omits the website", () => {
    const caseFixture = fixture.cases.find(({ caseId }) => caseId === "P039");
    expect(caseFixture.alternateNpi).toMatch(/^\d{10}$/);
    expect(providerProfileSystemInstructions).toMatch(
      /same organization name under another NPI, inspect readable evidence for that NPI before emitting any website/i
    );
    expect(providerProfileSystemInstructions).toMatch(/if that other-NPI evidence cannot be inspected, omit only the website/i);
    expect(websiteShape.value.description).toMatch(/if that evidence cannot be inspected, omit the website/i);
  });

  it("emits the exact inspected first-party URL when exact name and compatible complete address attach it", () => {
    const caseFixture = fixture.cases.find(({ caseId }) => caseId === "P009");
    expect(caseFixture.firstPartyUrl).toMatch(/^https:\/\//);
    expect(providerProfileSystemInstructions).toMatch(
      /otherwise-unimplicated domain.*exact-NPI evidence that confirms.*legal, DBA, or alias name.*co-binds that exact confirmed name.*emit that exact consulted page URL as the website/i
    );
    expect(providerProfileSystemInstructions).toMatch(/complete professional address corroborates this attachment but is not mandatory/i);
    expect(websiteShape.value.description).toMatch(/requires emitting that exact consulted page URL as the website/i);
    expect(websiteShape.value.description).toMatch(/complete professional address corroborates this attachment but is not mandatory/i);
  });

  it("keeps the V8 direct website citation contract field-local", () => {
    expect(websiteShape.value.description).toMatch(/must equal this item's citation\.sourceUrl/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/direct URL evidence/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/sourceUrl itself is the URL evidence/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/span need not repeat the URL/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/page specific to the requested provider or compatible organization/i);
  });

  it("performs one field-local pre-return audit", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Before returning, perform exactly one field-local output-completion pass/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /competing address or phone values lack affirmative evidence of concurrent operation, keep at most the one best eligible value/i
    );
  });
});

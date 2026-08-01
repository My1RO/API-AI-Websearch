const fixture = require("./fixtures/provider-profile-d30b/trace-derived-policy-cases.json");
const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const shape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

describe("D30B development-trace policy sentinels", () => {
  it("binds only the five named development cases", () => {
    expect(fixture.cases.map(({ caseId }) => caseId)).toEqual([
      "P024", "P042", "P045", "P049", "P050"
    ]);
    expect(fixture.provenance).toMatch(/Development-only.*No holdout data and no new model calls/i);
  });

  it("allows faithful specialty equivalents without a literal-only gate", () => {
    expect(shape.specialties.element.shape.value.description).toMatch(/PA-C to Physician Assistant/i);
    expect(shape.specialties.element.shape.citation.description).toMatch(/Do not apply a literal-only specialty wording gate/i);
  });

  it("requires one own page to support every serialized address component", () => {
    expect(shape.locations.element.shape.citation.description).toMatch(/every non-null material serialized component.*complete ZIP or ZIP\+4/i);
    expect(providerProfileSystemInstructions).toMatch(/never borrow a component from another page/i);
  });

  it("accepts readable search-returned evidence without requiring open_page", () => {
    expect(providerProfileSystemInstructions).toMatch(/Readable page content returned with search counts, without a separate open-page action, counts as inspected evidence/i);
  });

  it("attaches shared facility phones and prefers qualified first-party facts", () => {
    expect(providerProfileSystemInstructions).toMatch(/name plus a compatible location affirmatively attaches its displayed professional phone.*Shared use alone is not a conflict/i);
    expect(providerProfileSystemInstructions).toMatch(/first-party direct contact or website beats a conflicting undated lower-tier listing/i);
  });

  it("runs at most one late rating query and keeps complete systems independent", () => {
    expect(providerProfileSystemInstructions).toMatch(/only after mandatory identity, first-party, contact.*run at most one dedicated exact-provider rating query/i);
    expect(shape.ratings.description).toMatch(/independent observations and not conflicts merely because their values differ/i);
  });
});

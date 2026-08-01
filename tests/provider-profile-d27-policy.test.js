const fixture = require("./fixtures/provider-profile-d26/trace-derived-policy-cases.json");
const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const websiteArray = profileShape.websites;
const websiteShape = websiteArray.element.shape;

describe("D27 field-local completion and same-value citation contract", () => {
  it("completes mandatory evidence collection in first-party, conflict, then surfaced-rating order", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /do not answer until this action order is complete: FIRST obtain readable content.*first-party.*SECOND inspect.*alternate-NPI.*THIRD.*rating/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /if that other-NPI evidence cannot be inspected, omit only the website and preserve independently qualified facts/i
    );
    expect(providerProfileSystemInstructions).toMatch(/Do not run a dedicated rating or reviews query/i);
  });

  it("requires the best same-value citation without changing the selected value", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /MUST cite the highest-priority eligible inspected page that supports the same selected value/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /must never replace the selected value with a different value merely to obtain a higher source tier/i
    );
  });

  it("makes an eligible consulted first-party website nonempty while preserving semantic empty output", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /websites must contain the exact consulted URL of the best eligible page and must not be empty/i
    );
    expect(providerProfileSystemInstructions).toMatch(/empty array only when no such page remains eligible/i);
    expect(providerProfileSystemInstructions).toMatch(
      /All existing domain-implication and rescue rules apply before this completion requirement/i
    );
    expect(websiteArray.description).toMatch(/must contain the exact consulted URL of the best eligible page/i);
    expect(websiteArray.description).toMatch(/empty array only when no such page remains eligible/i);
    expect(websiteArray.safeParse([]).success).toBe(true);
  });

  it("keeps the public website item surface and direct-citation contract unchanged", () => {
    expect(Object.keys(websiteShape)).toEqual(["value", "citation"]);
    expect(websiteShape.value.description).toMatch(/must equal this item's citation\.sourceUrl/i);
    expect(websiteShape.citation.shape.sourceUrl.description).toMatch(/direct URL evidence/i);
  });

  it("preserves the trace-derived positive, conflict-gated, and provider-page cases", () => {
    const p009 = fixture.cases.find(({ caseId }) => caseId === "P009");
    const p035 = fixture.cases.find(({ caseId }) => caseId === "P035");
    const p039 = fixture.cases.find(({ caseId }) => caseId === "P039");

    expect(p009.firstPartyUrl).toMatch(/^https:\/\//);
    expect(p035.surfacedFirstPartyUrl).toMatch(/^https:\/\//);
    expect(p039.alternateNpi).toMatch(/^\d{10}$/);
    expect(providerProfileSystemInstructions).toMatch(/A conflict in one field must never suppress unrelated eligible facts/i);
    expect(providerProfileSystemInstructions).toMatch(/ordinary exact-name attachment rule never rescues a domain implicated/i);
  });
});

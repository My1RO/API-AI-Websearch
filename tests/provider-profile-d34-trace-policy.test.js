const fs = require("fs");
const path = require("path");
const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const fixture = require("./fixtures/provider-profile-d34/trace-derived-regressions.json");
const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const specialtyCitation = profileShape.specialties.element.shape.citation;

describe("D34 trace-derived field-local completion", () => {
  it("is bound only to the four canonical development regressions", () => {
    expect(fixture.provenance).toMatch(
      /Development-only.*fixed gpt-5\.6-sol\/high.*No holdout data, network access, or new model calls/i
    );
    expect(fixture.cases.map(({ caseId }) => caseId)).toEqual(["P007", "P014", "P024", "P050"]);
  });

  it("requires a provider-specific Q1 professional contact over a conflicting undated Q3 value", () => {
    const p024 = fixture.cases.find(({ caseId }) => caseId === "P024");
    expect(p024.requiredBehavior).toMatch(/Emit the eligible Q1 phone.*affirmative ineligibility or incompatible-operation/i);
    expect(providerProfileSystemInstructions).toMatch(
      /D34 field-local completion.*provider-specific Q1 page.*only competing evidence is an undated Q3.*emit the Q1 value as element zero rather than the Q3 value or an empty array/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /requested city, state, or ZIP is only a possibly stale search hint.*cannot defeat Q1.*Missing fact dates do not make either value stale/i
    );
    expect(profileShape.phoneNumbers.description).toMatch(
      /must not be empty merely because.*eligible Q1 professional phone remains.*must not select a Q3 phone instead of that eligible provider-specific Q1 phone/i
    );
  });

  it("makes same-value Q1 citation replacement mandatory", () => {
    const p007 = fixture.cases.find(({ caseId }) => caseId === "P007");
    const p014 = fixture.cases.find(({ caseId }) => caseId === "P014");
    expect(p007.requiredBehavior).toMatch(/replace the lower-tier citation.*same-value Q1.*without changing/i);
    expect(p014.requiredBehavior).toMatch(/Use readable same-value Q1 citations.*never an unread/i);
    expect(providerProfileSystemInstructions).toMatch(
      /D34 citation-only completion.*replace any Q2 or Q3 citation with that Q1 page.*substitution is mandatory, not a preference.*does not change the value/i
    );
    expect(specialtyCitation.shape.sourceUrl.description).toMatch(
      /If one such first-party page contains the same complete value.*this must be that exact first-party URL/i
    );
  });

  it("emits an eligible provider-specific first-party biography or team page across compatible affiliations", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /D34 website completion.*provider-specific first-party biography or team page.*Multiple compatible current professional affiliations.*do not justify an empty websites array/i
    );
    expect(profileShape.websites.description).toMatch(
      /provider-specific first-party biography or team page remains independently eligible.*multiple compatible current professional affiliations/i
    );
    expect(profileShape.websites.element.shape.citation.description).toMatch(
      /unless affirmative readable evidence makes it former, a different provider's page, or part of an incompatible operation/i
    );
  });

  it("quotes the source credential rather than fabricating the expansion in factSpan", () => {
    const p024 = fixture.cases.find(({ caseId }) => caseId === "P024");
    expect(p024.requiredBehavior).toMatch(/Physician Assistant expansion.*exact source credential PA-C as factSpan/i);
    expect(providerProfileSystemInstructions).toMatch(
      /D34 credential-span rule.*page says PA-C.*emitted value is Physician Assistant.*copy the shortest exact credential text PA-C into factSpan/i
    );
    expect(specialtyCitation.shape.factSpan.description).toMatch(
      /common unambiguous credential expansion.*copy the shortest exact source credential text, such as PA-C.*rather than the expanded emitted specialty/i
    );
    expect(specialtyCitation.description).toMatch(
      /factSpan must quote PA-C rather than the expansion unless Physician Assistant appears verbatim/i
    );
  });

  it("preserves D33 website heading grounding for P050", () => {
    const p050 = fixture.cases.find(({ caseId }) => caseId === "P050");
    expect(p050.requiredBehavior).toMatch(/sourceUrl as direct website evidence.*shortest exact provider or organization heading.*never synthesized/i);
    expect(profileShape.websites.element.shape.citation.shape.factSpan.description).toMatch(
      /shortest exact provider or organization heading or name passage.*Never synthesize marketing or description text/i
    );
  });

  it("does not add host-fetch, tel-link conflict, or broad specialty-completion behavior", () => {
    expect(providerProfileSystemInstructions).not.toMatch(/tel:|tel-link conflict|complete every plausible specialty/i);
    for (const relativePath of [
      "src/services/ai-provider/response-parser.ts",
      "src/services/provider-profile-sanitizer.service.ts",
      "src/services/ai-provider/responses-provider.client.ts",
      "src/services/ai-provider/search-request-config.ts",
      "src/config/env.ts",
      "src/config/runtime.ts"
    ]) {
      const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
      expect(source).not.toMatch(/D34|d34/i);
    }
  });
});

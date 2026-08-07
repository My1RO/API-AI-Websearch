const fs = require("fs");
const path = require("path");
const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileSchema,
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");
const {
  parseProviderProfilesFromResponse
} = require("../src/services/ai-provider/response-parser");

const citation = {
  sourceUrl: "https://hospital.org/providers/ada-smith",
  providerIdentitySpan: "Ada Smith, NPI 1234567890",
  factSpan: "Ada Smith specializes in Family Medicine.",
  explicitFactDateSpan: null
};

const structuredProfile = {
  providerId: null,
  npi: "1234567890",
  providerName: "Ada Smith",
  specialties: [{ value: "Family Medicine", citation }],
  locations: [],
  phoneNumbers: [],
  websites: []
};

describe("D31B Q1 contact completion without model-generated ratings", () => {
  const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
  const phoneDescription = profileShape.phoneNumbers.element.shape.value.description;

  it("removes ratings and rating work from the strict model contract", () => {
    expect(profileShape).not.toHaveProperty("ratings");
    expect(providerProfileSystemInstructions).not.toMatch(/\bratings?\b|\breviews?\b/i);
    expect(() => providerProfileStructuredOutputSchema.parse({
      profiles: [{ ...structuredProfile, ratings: [] }]
    })).toThrow();
  });

  it("keeps the public API backward-compatible with historical ratings", () => {
    expect(providerProfileSchema.parse({
      providerName: "Ada Smith",
      ratings: [{ value: "4.8", scale: "5", citation }]
    }).ratings).toHaveLength(1);
    expect(providerProfileSchema.parse({ providerName: "Ada Smith" }).ratings).toEqual([]);
  });

  it("returns a public-compatible empty ratings array for a model profile", () => {
    const profiles = parseProviderProfilesFromResponse({
      output_parsed: { profiles: [structuredProfile] },
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          annotations: [{ type: "url_citation", url: citation.sourceUrl }]
        }]
      }]
    });
    expect(profiles[0].ratings).toEqual([]);
  });

  it("attaches an Entity Type 2 Q1 phone by exact name and complete location", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /exact-NPI evidence establishes.*exact legal, DBA, or alias name and complete professional location.*first-party page co-binds that same exact name and location.*professional voice phone/i
    );
    expect(phoneDescription).toMatch(
      /exact legal, DBA, or alias name and complete professional location.*co-binds that same exact name and location.*professional voice phone/i
    );
  });

  it("does not let an undated lower-tier phone suppress an eligible Q1 phone", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /different undated registry or directory phone alone does not establish another operation and must not suppress the Q1 phone/i
    );
    expect(profileShape.phoneNumbers.description).toMatch(
      /must not be empty merely because an undated lower-tier source differs when an eligible Q1 professional phone remains/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Emit any such identity-qualified eligible Q1 direct phone, address, or website as element zero.*conflicting undated Q2\/Q3 value or leaving the field empty/i
    );
  });

  it("preserves suite/subpart and affirmative other-operation safeguards", () => {
    expect(providerProfileSystemInstructions).toMatch(/suite candidates as unresolved organizational-identity conflicts/i);
    expect(phoneDescription).toMatch(/does not rescue a page, domain, or phone readably assigned to another NPI, organizational subpart, or incompatible operation/i);
  });

  it("keeps Q1 citation priority after evidence qualification", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /replace a lower-tier citation when readable same-value Q1 support was inspected/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /first-party page supports that same value.*Otherwise cite inspected same-value exact-provider government evidence.*professional-directory evidence/i
    );
  });

  it("introduces no production host fetch or semantic adjudication", () => {
    const parserSource = fs.readFileSync(
      path.join(__dirname, "../src/services/ai-provider/response-parser.ts"),
      "utf8"
    );
    expect(parserSource).not.toMatch(/\bfetch\s*\(/);
    expect(parserSource).not.toMatch(/semantic.*(?:judge|adjudicat)/i);
  });
});

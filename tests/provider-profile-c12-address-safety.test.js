const fixture = require("./fixtures/provider-profile-c12-address-safety.json");
const { zodTextFormat } = require("openai/helpers/zod");
const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("compact address-premises safety policy", () => {
  const serializedSchema = JSON.stringify(
    zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles").schema
  );
  const policyPhrase = "registry/directory practice-location label alone";

  it("closes the measured P004 registry-only individual-address failure", () => {
    expect(fixture.measuredFailure).toMatchObject({
      caseId: "P004",
      entityType: "individual",
      candidateAddress: "5740 SW 81st St, Miami, FL 33143-8208",
      expectedPolicy: "omit_without_independent_professional_premises_evidence"
    });
    expect(providerProfileSystemInstructions).toContain(policyPhrase);
    expect(providerProfileSystemInstructions).toMatch(
      /require consulted evidence of an office, clinic, facility, or other professional premises, else omit the address/i
    );
  });

  it("keeps the semantic rule model-owned and stated once", () => {
    expect(providerProfileSystemInstructions.split(policyPhrase)).toHaveLength(2);
    expect(serializedSchema).not.toContain(policyPhrase);
    expect(serializedSchema).not.toMatch(/practice-location label alone/i);
  });

  it("retains legitimate professional-premises and organization controls", () => {
    expect(fixture.retentionControls.map((item) => item.id)).toEqual([
      "individual_first_party_office",
      "individual_registry_plus_clinic",
      "organization_not_subject_to_individual_rule"
    ]);
    expect(providerProfileSystemInstructions).toMatch(/For an individual,/);
    expect(providerProfileSystemInstructions).toMatch(/office, clinic, facility, or other professional premises/i);
    expect(providerProfileSystemInstructions).not.toMatch(/never (?:use|emit) (?:a )?(?:registry|directory)/i);
  });
});

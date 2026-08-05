const fixture = require("./fixtures/provider-profile-c13-address-verification.json");
const { zodTextFormat } = require("openai/helpers/zod");
const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("conditional individual-address verification policy", () => {
  const serializedSchema = JSON.stringify(
    zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles").schema
  );
  const policyPhrase = "registry/directory practice-location label alone";

  it("checks the exact address once for the measured P004 registry-only failure", () => {
    expect(fixture.verificationCase).toMatchObject({
      caseId: "P004",
      entityType: "individual",
      candidateAddress: "5740 SW 81st St, Miami, FL 33143-8208",
      suiteOrFloorIndicator: false,
      namedProfessionalPremisesIndicator: false,
      expectedPolicy: "search_exact_address_once_then_omit_if_professional_use_unestablished"
    });
    expect(providerProfileSystemInstructions).toContain(policyPhrase);
    expect(providerProfileSystemInstructions).toMatch(
      /address has neither a suite\/floor nor a named professional-premises indicator\. Then search the exact address once/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /omit only if professional use remains unestablished/i
    );
  });

  it("retains the measured P002 suite control without the extra address check", () => {
    expect(fixture.retentionControls[0]).toMatchObject({
      caseId: "P002",
      candidateAddress: "2730 SW 3RD AVE, STE 800, MIAMI, FL 33129-2339",
      suiteOrFloorIndicator: true,
      namedProfessionalPremisesIndicator: false,
      expectedPolicy: "eligible_after_ordinary_checks_without_extra_address_search"
    });
  });

  it("retains the measured P036 professional-premises control", () => {
    expect(fixture.retentionControls[1]).toMatchObject({
      caseId: "P036",
      candidateAddress: "4500 Euclid Ave, Cleveland, OH 44103-3736",
      suiteOrFloorIndicator: false,
      namedProfessionalPremisesIndicator: true,
      expectedPolicy: "eligible_after_ordinary_checks_without_extra_address_search"
    });
    expect(fixture.retentionControls[1].consultedEvidence).toMatch(/Practice/);
  });

  it("keeps the semantic rule model-owned, conditional, and stated once", () => {
    expect(providerProfileSystemInstructions.split(policyPhrase)).toHaveLength(2);
    expect(serializedSchema).not.toContain(policyPhrase);
    expect(serializedSchema).not.toMatch(/practice-location label alone/i);
    expect(providerProfileSystemInstructions).not.toMatch(
      /registry\/directory practice-location label alone does not prove/i
    );
    expect(providerProfileSystemInstructions).not.toMatch(/never (?:use|emit) (?:a )?(?:registry|directory)/i);
  });
});

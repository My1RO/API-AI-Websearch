const fixture = require("./fixtures/provider-profile-c14-premises-evidence.json");
const { zodTextFormat } = require("openai/helpers/zod");
const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("conditional individual-premises evidence policy", () => {
  const serializedSchema = JSON.stringify(
    zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles").schema
  );
  const policyPhrase = "Registration of a business/entity there";

  it("rejects the measured P004 entity-linkage false corroboration", () => {
    expect(fixture.verificationCase).toMatchObject({
      caseId: "P004",
      candidateAddress: "5740 SW 81st St, Miami, FL 33143-8208",
      suiteOrFloorIndicator: false,
      namedProfessionalPremisesIndicator: false,
      expectedPolicy: "omit_without_venue_or_property_professional_premises_evidence"
    });
    expect(fixture.verificationCase.rejectedCorroboration).toMatchObject({
      sourceUrl: "https://opengovus.com/npi/1457060253",
      otherNpi: "1457060253",
      entityName: "Best-Self Behavior Therapy",
      authorizedOfficialLink: "Macarena Jones (Manager)",
      repeatedAddressLabel: "Practice Address 5740 Sw 81st St Miami FL 33143-8208",
      premisesEvidence: null
    });
    expect(providerProfileSystemInstructions).toMatch(
      /if a registry\/directory practice location has neither a suite\/floor nor named professional premises, search the exact address once/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /registration of a business\/entity there, an authorized-official link, or another practice-address label does not establish office\/clinic\/facility\/commercial premises/i
    );
    expect(providerProfileSystemInstructions).toMatch(/omit without such venue evidence or with residential evidence/i);
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

  it("retains the measured P036 named physical-premises control", () => {
    expect(fixture.retentionControls[1]).toMatchObject({
      caseId: "P036",
      candidateAddress: "4500 Euclid Ave, Cleveland, OH 44103-3736",
      suiteOrFloorIndicator: false,
      namedProfessionalPremisesIndicator: true,
      expectedPolicy: "eligible_after_ordinary_checks_without_extra_address_search"
    });
    expect(fixture.retentionControls[1].consultedEvidence).toMatch(/Practice/);
  });

  it("keeps the semantic refinement model-owned and stated once", () => {
    expect(providerProfileSystemInstructions.split(policyPhrase)).toHaveLength(2);
    expect(serializedSchema).not.toContain(policyPhrase);
    expect(serializedSchema).not.toMatch(/registration of a business\/entity there/i);
    expect(providerProfileSystemInstructions).not.toMatch(/never (?:use|emit) (?:a )?(?:registry|directory)/i);
  });
});

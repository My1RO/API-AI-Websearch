const fixture = require("./fixtures/provider-profile-c14-premises-evidence.json");
const { zodTextFormat } = require("openai/helpers/zod");
const { providerProfileSystemInstructions } = require("../src/services/prompt-builder.service");
const { providerProfileStructuredOutputSchema } = require("../src/validators/provider-profile.validator");

describe("conditional individual-premises evidence policy", () => {
  const serializedSchema = JSON.stringify(
    zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles").schema
  );
  const policyPhrase = "quoted exact full address alone";

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
      /for an individual, before emitting any registry\/directory-only address without a named professional venue, run a separate web search for the quoted exact full address alone, without provider name or NPI/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /a registry practice-location or directory Locations label is attribution, not premises evidence/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /if an opened result classifies the premises as a house, home, single-family, or residential, or no opened result establishes an office, clinic, facility, hospital, or commercial premises, omit the address/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /mixed-use is eligible only when readable evidence identifies a distinct public professional venue there/i
    );
  });

  it("requires the measured P002 suite control to receive the same address check", () => {
    expect(fixture.retentionControls[0]).toMatchObject({
      caseId: "P002",
      candidateAddress: "2730 SW 3RD AVE, STE 800, MIAMI, FL 33129-2339",
      suiteOrFloorIndicator: true,
      namedProfessionalPremisesIndicator: false,
      expectedPolicy: "requires_separate_address_search_despite_suite_without_named_venue"
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
    expect(serializedSchema).not.toMatch(/quoted exact full address alone/i);
    expect(providerProfileSystemInstructions).not.toMatch(/never (?:use|emit) (?:a )?(?:registry|directory)/i);
  });

  it("requires every emitted citation page to be opened before return", () => {
    expect(providerProfileSystemInstructions).toMatch(/before returning, open every cited page/i);
  });
});

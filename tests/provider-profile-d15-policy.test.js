const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

describe("D15 Entity Type 2 same-base organizational safeguard", () => {
  it("rejects a P039-style same-base conflicting organizational subpart bundle", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /requested provider may be an organization.*determine whether that evidence identifies the requested NPI as Entity Type 2/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /exact-NPI search metadata does not/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /If no readable exact-NPI page can be inspected.*do not use a same-base first-party bundle that conflicts/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /exact-NPI evidence identifies the requested NPI as an Entity Type 2 organization/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /same base street but conflict on an added, missing, or different suite or organizational subpart, or conflict on phone/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /treat the conflicting address, suite, and phone field candidates as unresolved organizational-identity conflicts/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /First-party name, branding, apparent currentness, and base-street overlap cannot override those field conflicts/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Emit a conflicting suite, subpart, address, or phone only when separate affirmative evidence either attaches that exact same value to the requested NPI or.*establishes shared or concurrent use/i
    );
  });

  it("preserves a P020-style distinct-address additional organization office", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /does not reject a distinct-address additional professional office for an organization merely because exact-NPI evidence omits it/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /provider-specific first-party page establishes a compatible distinct-address additional office.*exact requested organization.*complete professional address/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Qualify that office's phone independently.*own cited page.*exact phone.*compatible office/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Never require the address and phone to appear on one page or require either field as a precondition for emitting the other/i
    );
    expect(profileShape.locations.element.shape.addressLine1.description).toMatch(
      /distinct-address additional office remains eligible under ordinary identity and conflict rules/i
    );
    expect(profileShape.locations.description).toMatch(
      /provider-specific first-party page.*exact organization.*complete distinct-base-address professional office.*no conflicting-NPI or conflicting-operation evidence/i
    );
    expect(profileShape.locations.description).toMatch(
      /Qualify and cite any phone for that office independently; neither field is required to emit the other/i
    );
  });

  it("does not turn a P016-style named place into an address", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /place, facility, campus, or school name without a complete civic or postal address is not an address record/i
    );
    expect(profileShape.locations.element.shape.addressLine1.description).toMatch(
      /place, facility, campus, or school name without a complete civic or postal address is not an address record/i
    );
    expect(profileShape.locations.description).toMatch(
      /place, facility, campus, or school name without a complete civic or postal address is not an address record/i
    );
  });

  it("preserves a P035-style current provider page for an Entity Type 1 individual", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /same-base organizational safeguard does not apply to an Entity Type 1 individual/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /exact-NPI, identity-qualified, active first-party provider page.*emit that eligible value and rank it first/i
    );
  });

  it("repeats the narrow Entity Type 2 safeguard in the affected field schemas", () => {
    expect(profileShape.phoneNumbers.element.shape.value.description).toMatch(
      /Entity Type 2 organization.*same-name first-party bundle at the same base street.*conflicts on phone or organizational subpart/i
    );
    expect(profileShape.locations.element.shape.addressLine2.description).toMatch(
      /Entity Type 2 organization.*same-name first-party bundle at the same base street.*conflicts with exact-NPI evidence/i
    );
    expect(profileShape.websites.element.shape.value.description).toMatch(
      /Evaluate the domain field-locally: an address, suite, or phone conflict alone does not implicate it/i
    );
  });
});

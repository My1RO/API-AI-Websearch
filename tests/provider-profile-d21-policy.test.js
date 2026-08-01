const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const websiteShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape.websites.element.shape;

describe("D21 narrow exact-identity domain rescue", () => {
  it("attaches a current first-party domain through exact-NPI legal, DBA, or alias evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /otherwise-unimplicated domain only, readable exact-NPI evidence that confirms the requested organization's legal, DBA, or alias name/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /readable content from the inspected first-party page that co-binds that exact confirmed name to the requested organization is sufficient attachment/i
    );
    expect(providerProfileSystemInstructions).toMatch(/complete professional address corroborates this attachment but is not mandatory/i);
    expect(providerProfileSystemInstructions).toMatch(/The first-party page need not repeat the NPI/i);
    expect(websiteShape.value.description).toMatch(
      /exact-NPI evidence confirming the organization's legal, DBA, or alias name.*co-binds that exact confirmed name to the requested organization.*exact consulted page URL as the website/i
    );
  });

  it("fails closed on affirmative domain-to-other-entity evidence", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Absent such domain-specific attachment or rescue evidence, omit the domain when affirmative readable evidence binds that domain to a different NPI, organizational subpart, or provider operation/i
    );
    expect(websiteShape.value.description).toMatch(
      /Omit the domain when affirmative readable evidence binds it to a conflicting organizational subpart, different NPI, or different provider operation/i
    );
  });

  it("keeps the rescue domain-only and all other conflicts field-local", () => {
    expect(providerProfileSystemInstructions).toMatch(/this rule never rescues or validates an address or phone from the page/i);
    expect(providerProfileSystemInstructions).toMatch(/Same name, branding, base-address overlap, general affiliation, or absence of exclusivity alone is insufficient/i);
    expect(websiteShape.value.description).toMatch(/This domain rule never validates an address or phone/i);
  });
});

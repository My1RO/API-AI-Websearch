const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

describe("D17 field-local conflicts and current first-party precedence", () => {
  it("ranks an exact-NPI current individual-provider contact ahead of a bare registry alternate", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /exact-NPI, identity-qualified, active first-party provider page.*current professional office or voice phone.*emit that eligible value and rank it first/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /bare conflicting registry or directory listing does not by itself disqualify that current provider-page contact/i
    );
    expect(profileShape.phoneNumbers.element.shape.value.description).toMatch(
      /Entity Type 1 individual.*active first-party provider page.*takes precedence over a bare conflicting registry or directory listing/i
    );
  });

  it("does not spread an address or phone conflict into the website field", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /suite, address, or phone conflict does not by itself implicate a website/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Treat a domain as implicated only when readable evidence binds that exact domain to the conflicting organizational subpart, different NPI, or different provider operation/i
    );
    expect(providerProfileSystemInstructions).toMatch(/Evaluate the domain separately/i);
    expect(profileShape.websites.element.shape.value.description).toMatch(
      /Evaluate the domain field-locally: an address, suite, or phone conflict alone does not implicate it/i
    );
  });

  it("allows explicit rebrand or ownership continuity to attach a current domain", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /explicit rebranding, acquisition, ownership-continuity, or redirect evidence.*may rescue it/i
    );
    expect(profileShape.websites.element.shape.value.description).toMatch(
      /Explicit first-party rebranding, acquisition, ownership-continuity, or redirect evidence may establish that attachment/i
    );
  });

  it("keeps the Type-2 same-base safeguard field-local", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /treat the conflicting address, suite, and phone field candidates as unresolved organizational-identity conflicts/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Emit a conflicting suite, subpart, address, or phone only when separate affirmative evidence/i
    );
  });

});

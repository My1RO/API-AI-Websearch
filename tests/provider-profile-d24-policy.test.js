const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const websiteShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape.websites.element.shape;

describe("D24 broadened discovery and unified domain attachment", () => {
  it("broadens discovery before concluding that no first-party lead exists", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /broaden to the exact NPI alone, the legal, DBA, or alias name plus city or street, and a likely first-party page/i
    );
  });

  it("uses one explicit domain-specific rescue rule after conflict qualification", () => {
    expect(providerProfileSystemInstructions).toMatch(/For any implicated website, apply only the ordered domain-specific attachment and rescue rules below/i);
    expect(providerProfileSystemInstructions).toMatch(
      /For an implicated domain, only explicit rebranding, acquisition, ownership-continuity, or redirect evidence.*shared or concurrent use.*may rescue it/i
    );
    expect(providerProfileSystemInstructions).toMatch(/legal, DBA, or alias plus compatible complete-address rule may attach an otherwise unimplicated domain only/i);
    expect(providerProfileSystemInstructions).toMatch(/Absent such domain-specific attachment or rescue evidence, omit the domain/i);
  });

  it("does not demand a separate proposition about who technically operates a provider-specific page", () => {
    expect(providerProfileSystemInstructions).toMatch(/page need not state who technically operates the site/i);
    expect(websiteShape.citation.shape.providerIdentitySpan.description).toMatch(/provider-specific or organization-specific page/i);
    expect(websiteShape.citation.shape.factSpan.description).toMatch(/need not repeat the URL or state who technically operates the site/i);
  });
});

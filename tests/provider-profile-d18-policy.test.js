const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const sourceUrlDescription = profileShape.specialties.element.shape.citation.shape.sourceUrl.description;

describe("D18 opened-page and item-local citation contract", () => {
  it("prefers a readable same-value source that was opened and inspected in this call", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /same-value inspected first-party provider page.*same-value inspected government exact-provider page.*readable established exact-provider professional directory/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /search result or tool action without readable opened page content is not inspected evidence/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /NPIProfile.*rate-limit, access-challenge, error, or non-provider body.*unread discovery lead only/i
    );
    expect(sourceUrlDescription).toMatch(/opened and inspected in this call/i);
    expect(sourceUrlDescription).toMatch(/rate-limited, access-challenge, error, or unread page/i);
  });

  it("requires an independent citation check for every emitted item", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /verify separately for every emitted item.*own sourceUrl was opened.*providerIdentitySpan identifies.*factSpan supports that item's exact value and field type/i
    );
    expect(profileShape.specialties.element.shape.citation.description).toMatch(/specialty value.*Never use a different fact item's source or span/i);
    expect(profileShape.phoneNumbers.element.shape.citation.description).toMatch(/all digits.*professional voice contact.*Never use another phone's, address's, or website's evidence/i);
    expect(profileShape.locations.element.shape.citation.description).toMatch(/every non-null material component.*professional location.*Never use another location's, phone's, or website's evidence/i);
    expect(profileShape.ratings.element.shape.citation.description).toMatch(/exact rating value.*Never use another provider's rating or another fact item's evidence/i);
  });

  it("emits the inspected provider URL rather than an unproved root generalization", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /Emit the exact inspected provider, practice, clinic, facility, or hospital page URL.*do not generalize it to an uninspected health-system root/i
    );
    expect(providerProfileSystemInstructions).toMatch(/canonical URL, Open Graph URL, or JSON-LD/i);
    expect(profileShape.websites.element.shape.value.description).toMatch(
      /exact inspected current provider.*page URL.*never generalize.*uninspected health-system root/i
    );
    expect(profileShape.websites.element.shape.citation.description).toMatch(
      /exact emitted domain or site, including the full emitted URL.*canonical URL, Open Graph URL, or JSON-LD; title-only/i
    );
  });
});

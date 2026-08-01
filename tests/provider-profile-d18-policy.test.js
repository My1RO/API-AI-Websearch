const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;
const sourceUrlDescription = profileShape.specialties.element.shape.citation.shape.sourceUrl.description;

describe("D18 readable-page and item-local citation contract", () => {
  it("prefers a readable same-value source inspected in this call", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /first-party page supports that same value.*Otherwise cite inspected same-value exact-provider government evidence.*professional-directory evidence/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /Readable page content returned with search counts.*bare result URL, title, snippet, source listing.*does not/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /NPIProfile.*rate-limit, access-challenge, error, or non-provider body.*unread discovery lead only/i
    );
    expect(sourceUrlDescription).toMatch(/returned and inspected in this call/i);
    expect(sourceUrlDescription).toMatch(/whether that readable content was supplied with search or by opening the page/i);
    expect(sourceUrlDescription).toMatch(/rate-limited, access-challenge, error, or unread page/i);
  });

  it("requires an independent citation check for every emitted item", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /verify separately for every emitted item.*readable content from its own sourceUrl was inspected.*providerIdentitySpan identifies.*factSpan supports that item's exact value and field type/i
    );
    expect(profileShape.specialties.element.shape.citation.description).toMatch(/specialty value.*Never use a different fact item's source or span/i);
    expect(profileShape.phoneNumbers.element.shape.citation.description).toMatch(/all digits.*professional voice contact.*Never use another phone's, address's, or website's evidence/i);
    expect(profileShape.locations.element.shape.citation.description).toMatch(/every non-null material component.*professional location.*Never use another location's, phone's, or website's evidence/i);
    expect(profileShape.ratings.element.shape.citation.description).toMatch(/exact rating value.*Never use another provider's rating or another fact item's evidence/i);
  });

  it("emits the exact consulted page URL rather than an unproved root generalization", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /website value must be the exact URL of the consulted readable provider.*Never construct or generalize an inspected subpage into an uninspected root/i
    );
    expect(providerProfileSystemInstructions).toMatch(/sourceUrl is the direct URL evidence/i);
    expect(profileShape.websites.element.shape.value.description).toMatch(
      /exact URL of a consulted readable provider-specific or organization-specific provider.*page.*must equal this item's citation\.sourceUrl/i
    );
    expect(profileShape.websites.element.shape.citation.description).toMatch(
      /sourceUrl itself is the website URL evidence.*factSpan need not repeat the URL.*Title-only evidence is insufficient/i
    );
  });
});

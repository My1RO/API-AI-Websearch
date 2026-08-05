const { zodTextFormat } = require("openai/helpers/zod");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

describe("literal address citation contract", () => {
  const schema = zodTextFormat(
    providerProfileStructuredOutputSchema,
    "provider_profiles"
  ).schema;
  const location = schema.properties.profiles.items.properties.locations.items;

  it("requires every emitted address component to appear literally in its own fact span", () => {
    expect(location.description).toMatch(
      /construct fields only from citation\.factSpan/i
    );
    expect(location.description).toMatch(
      /every non-null component, including unit\/floor and full ZIP/i
    );
    expect(location.description).toMatch(
      /use null rather than infer an absent component/i
    );
  });

  it("makes the measured unit/floor failure explicit at the field boundary", () => {
    expect(location.properties.addressLine2.description).toMatch(
      /only when literally present in citation\.factSpan; otherwise null/i
    );
  });
});

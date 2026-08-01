const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");
const {
  providerProfileStructuredOutputSchema
} = require("../src/validators/provider-profile.validator");

const profileShape = providerProfileStructuredOutputSchema.shape.profiles.element.shape;

describe("D19 registry concurrency policy", () => {
  it("does not interpret a bare registry or directory alternate as concurrent operation", () => {
    expect(providerProfileSystemInstructions).toMatch(
      /bare registry or directory listing.*does not by itself establish.*both values operate concurrently/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /active exact-provider first-party page.*do not emit a bare registry or directory alternate.*without separate affirmative concurrent-operation evidence/i
    );
    expect(providerProfileSystemInstructions).toMatch(
      /does not make registry or directory evidence invalid when no qualified conflict exists/i
    );
  });

  it("does not expose ratings in the model contract", () => {
    expect(profileShape).not.toHaveProperty("ratings");
    expect(providerProfileSystemInstructions).not.toMatch(/\bratings?\b|\breviews?\b/i);
  });
});

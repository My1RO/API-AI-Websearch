const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");

const D11_SCHEMA_FILE_SHA256 = "a3777ea35a3fb76b022fa4464996544a65ffb81d513a3c3dca937b0a573bfffa";

describe("D11F field-local conflict and two-stage selection policy", () => {
  it("limits suite/location-only exclusion to location-scoped contacts", () => {
    expect(providerProfileSystemInstructions).toMatch(/incompatible suite or location by itself excludes only a location-scoped contact candidate/i);
    expect(providerProfileSystemInstructions).toMatch(/street address, office or facility phone, or office-specific scheduling line/i);
    expect(providerProfileSystemInstructions).toMatch(/does not by itself exclude a website, specialty, or rating/i);
  });

  it("still excludes non-location facts assigned to another NPI operation", () => {
    expect(providerProfileSystemInstructions).toMatch(/website in another NPI's exclusive address, phone, and operation bundle is therefore ineligible/i);
    expect(providerProfileSystemInstructions).toMatch(/website, specialty, or rating; those require evidence assigning the candidate or its exclusively co-bound bundle to another NPI or provider operation/i);
  });

  it("uses hierarchy only after semantic value selection", () => {
    expect(providerProfileSystemInstructions).toMatch(/Select among values using exact-provider attachment, professional purpose and specificity, compatible location, conflict evidence, and then fact-specific recency/i);
    expect(providerProfileSystemInstructions).toMatch(/source hierarchy only as the last tie-breaker when eligible values remain otherwise equivalent/i);
  });

  it("selects a same-value citation independently without revisiting the value", () => {
    expect(providerProfileSystemInstructions).toMatch(/After selecting an eligible value, choose its citation independently from consulted pages supporting that same exact value/i);
    expect(providerProfileSystemInstructions).toMatch(/citation selection must not revisit or replace the selected value/i);
  });

  it("does not alter the refined D11 Structured Output schema", () => {
    const bytes = fs.readFileSync(path.join(__dirname, "../src/validators/provider-profile.validator.ts"));
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(D11_SCHEMA_FILE_SHA256);
  });
});

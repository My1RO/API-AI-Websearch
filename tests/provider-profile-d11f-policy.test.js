const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");

const D23_SCHEMA_FILE_SHA256 = "593cd9073415360c5226f531e9d7b35cf3c35a492ba3bf61b6d1786c9e49537a";

describe("D11F field-local conflict and two-stage selection policy", () => {
  it("does not use stale suite/location hints as exclusion gates", () => {
    expect(providerProfileSystemInstructions).toMatch(/suite or location mismatch by itself is not express another-NPI or another-operation evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/cannot implicate a website, specialty, rating, or identity-qualified first-party contact/i);
  });

  it("still excludes any fact expressly co-bound to another NPI operation", () => {
    expect(providerProfileSystemInstructions).toMatch(/expressly co-binds a candidate or its operational bundle to another NPI or another provider operation/i);
    expect(providerProfileSystemInstructions).toMatch(/Omit an implicated candidate unless.*exact same value to the requested NPI/i);
  });

  it("uses hierarchy only after semantic value selection", () => {
    expect(providerProfileSystemInstructions).toMatch(/Select among values using exact-provider attachment, professional purpose and specificity, compatible location, conflict evidence, and then fact-specific recency/i);
    expect(providerProfileSystemInstructions).toMatch(/source hierarchy only as the last tie-breaker when eligible values remain otherwise equivalent/i);
  });

  it("selects a same-value citation independently without revisiting the value", () => {
    expect(providerProfileSystemInstructions).toMatch(/After selecting an eligible value, choose its citation independently from consulted pages supporting that same exact value/i);
    expect(providerProfileSystemInstructions).toMatch(/citation selection must not revisit or replace the selected value/i);
  });

  it("pins the D23 field-specific structured-output policy", () => {
    const bytes = fs.readFileSync(path.join(__dirname, "../src/validators/provider-profile.validator.ts"));
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(D23_SCHEMA_FILE_SHA256);
  });
});

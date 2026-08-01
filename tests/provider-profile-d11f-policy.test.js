const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  providerProfileSystemInstructions
} = require("../src/services/prompt-builder.service");

const D33_SCHEMA_FILE_SHA256 = "b4acb7a9d92310a8934d5072ff9d275a7e87b0caddd9d9d10c9942e1ac48c2cd";

describe("D11F field-local conflict and two-stage selection policy", () => {
  it("does not use stale suite/location hints as exclusion gates", () => {
    expect(providerProfileSystemInstructions).toMatch(/suite or location mismatch by itself is not express another-NPI or another-operation evidence/i);
    expect(providerProfileSystemInstructions).toMatch(/cannot implicate a website, specialty, or identity-qualified first-party contact/i);
  });

  it("still excludes any fact expressly co-bound to another NPI operation", () => {
    expect(providerProfileSystemInstructions).toMatch(/expressly co-binds a candidate or its operational bundle to another NPI or another provider operation/i);
    expect(providerProfileSystemInstructions).toMatch(/Omit an implicated non-domain candidate unless.*exact same value to the requested NPI/i);
    expect(providerProfileSystemInstructions).toMatch(/For an implicated domain, use only the domain-specific attachment and rescue rules that follow/i);
  });

  it("uses hierarchy only after semantic value selection", () => {
    expect(providerProfileSystemInstructions).toMatch(/Select among values using exact-provider attachment, professional purpose and specificity, compatible location, conflict evidence, and then fact-specific recency/i);
    expect(providerProfileSystemInstructions).toMatch(/source hierarchy only as the last tie-breaker when eligible values remain otherwise equivalent/i);
  });

  it("selects a same-value citation independently without revisiting the value", () => {
    expect(providerProfileSystemInstructions).toMatch(/For each selected fact, inspect.*same complete value or a faithful formatting equivalent/i);
    expect(providerProfileSystemInstructions).toMatch(/This pass changes only the citation, never the selected value/i);
  });

  it("pins the D33 field-specific structured-output policy", () => {
    const bytes = fs.readFileSync(path.join(__dirname, "../src/validators/provider-profile.validator.ts"));
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(D33_SCHEMA_FILE_SHA256);
  });
});

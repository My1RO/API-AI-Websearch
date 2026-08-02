const {
  extractResponseProvenanceMismatchUrls,
  parseProviderProfilesFromResponse
} = require("../src/services/ai-provider/response-parser");
const {
  canonicalPublicProvenanceUrl,
  sanitizeProviderProfiles,
  sanitizeProviderProfilesForRequest
} = require("../src/services/provider-profile-sanitizer.service");

const sourceUrl = "https://provider.example.org/clinicians/ada-smith";
const citation = (factSpan, url = sourceUrl) => ({
  sourceUrl: url,
  sourceTitle: "Ada Smith, MD",
  providerIdentitySpan: "Ada Smith, MD — NPI 1234567890",
  factSpan,
  explicitFactDateSpan: null
});

const profile = (overrides = {}) => ({
  providerId: "provider-123",
  npi: "1234567890",
  providerName: "Ada Smith",
  specialties: [],
  locations: [],
  phoneNumbers: [{ value: "Office: 617-444-0123", citation: citation("Office: 617-444-0123") }],
  websites: [],
  ...overrides
});

const response = (provenanceItem, profileValue = profile()) => ({
  status: "completed",
  output_parsed: { profiles: [profileValue] },
  output: [
    provenanceItem,
    {
      type: "message",
      content: [{ type: "output_text", text: "", annotations: [] }]
    }
  ].filter(Boolean)
});

describe("current provider-profile parser and sanitizer contract", () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it.each([
    ["action.sources", {
      type: "web_search_call",
      action: { type: "search", sources: [{ type: "url", url: sourceUrl }] }
    }],
    ["url_citation", {
      type: "message",
      content: [{
        type: "output_text",
        text: "",
        annotations: [{ type: "url_citation", url: sourceUrl }]
      }]
    }],
    ["open_page", {
      type: "web_search_call",
      action: { type: "open_page", url: sourceUrl }
    }]
  ])("accepts %s as an independent native provenance channel", (_name, provenanceItem) => {
    const parsed = parseProviderProfilesFromResponse(response(provenanceItem));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].phoneNumbers[0].citation).toEqual(citation("Office: 617-444-0123"));
  });

  it("logs but retains a direct citation absent from every native provenance channel", () => {
    const raw = response({
      type: "web_search_call",
      action: { type: "search", sources: [{ type: "url", url: "https://other.example.org/provider" }] }
    });

    expect(extractResponseProvenanceMismatchUrls(raw.output_parsed.profiles, raw)).toEqual([sourceUrl]);
    expect(parseProviderProfilesFromResponse(raw)).toEqual([
      expect.objectContaining({
        npi: "1234567890",
        phoneNumbers: [expect.objectContaining({
          value: "Office: 617-444-0123",
          citation: expect.objectContaining({ sourceUrl })
        })]
      })
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "AI provider citation provenance mismatch",
      expect.objectContaining({
        reason: "absent_from_all_native_provenance_channels",
        mismatchCount: 1
      })
    );
  });

  it("preserves the direct address and phone from the logged D31B/P022 mismatch trace", () => {
    const healthgradesUrl = "https://healthgrades.com/providers/marina-rodriguez-y9s62sz";
    const identitySpan = "About Me NPI: 1326489170 biography Marina Rodriguez, NP is a nurse practitioner in Upper Arlington, OH.";
    const raw = response({
      type: "web_search_call",
      action: {
        type: "search",
        sources: [{
          type: "url",
          url: "https://health.usnews.com/nurse-practitioners/marina-rodriguez-2172346"
        }]
      }
    }, {
      providerId: "1326489170",
      npi: "1326489170",
      providerName: "MARINA R RODRIGUEZ NP",
      specialties: [],
      locations: [{
        addressLine1: "3924 Mountview Rd",
        addressLine2: null,
        city: "Upper Arlington",
        state: "OH",
        zip: "43220",
        citation: {
          sourceUrl: healthgradesUrl,
          sourceTitle: "Marina Rodriguez, NP - Nurse Practitioner in Upper Arlington, OH",
          providerIdentitySpan: identitySpan,
          factSpan: "Practice 1 Office 3924 Mountview Rd Upper Arlington, OH 43220",
          explicitFactDateSpan: null
        }
      }],
      phoneNumbers: [{
        value: "(614) 338-9158",
        citation: {
          sourceUrl: healthgradesUrl,
          sourceTitle: "Marina Rodriguez, NP - Nurse Practitioner in Upper Arlington, OH",
          providerIdentitySpan: identitySpan,
          factSpan: "Practice 1 Office 3924 Mountview Rd Upper Arlington, OH 43220 (614) 338-9158",
          explicitFactDateSpan: null
        }
      }],
      websites: []
    });

    expect(extractResponseProvenanceMismatchUrls(raw.output_parsed.profiles, raw))
      .toEqual([healthgradesUrl]);
    const [parsed] = parseProviderProfilesFromResponse(raw);
    expect(parsed.locations).toEqual([expect.objectContaining({
      addressLine1: "3924 Mountview Rd",
      city: "Upper Arlington",
      zip: "43220"
    })]);
    expect(parsed.phoneNumbers).toEqual([
      expect.objectContaining({ value: "(614) 338-9158" })
    ]);
  });

  it("uses bounded canonical equivalence without cross-NPI NPPES substitution", () => {
    expect(canonicalPublicProvenanceUrl("https://provider.example.org/path/?utm_source=x#facts"))
      .toBe(canonicalPublicProvenanceUrl("https://provider.example.org/path"));
    expect(canonicalPublicProvenanceUrl("https://npiregistry.cms.hhs.gov/api/?number=1234567890&version=2.1"))
      .toBe(canonicalPublicProvenanceUrl("https://npiregistry.cms.hhs.gov/provider-view/1234567890"));
    expect(canonicalPublicProvenanceUrl("https://npiregistry.cms.hhs.gov/provider-view/1234567890"))
      .not.toBe(canonicalPublicProvenanceUrl("https://npiregistry.cms.hhs.gov/provider-view/1098765432"));
  });

  it("retains professional specialty vocabulary and legitimate Apt office addresses", () => {
    const [sanitized] = sanitizeProviderProfiles([profile({
      specialties: [
        { value: "Diagnostic Radiology", citation: citation("Specialty: Diagnostic Radiology") },
        { value: "Apartment Medicine", citation: citation("Specialty: Apartment Medicine") }
      ],
      locations: [{
        addressLine1: "10 Main Street",
        addressLine2: "Apt 210 Professional Office",
        city: "Boston",
        state: "MA",
        zip: "02110",
        citation: citation("Professional Office, 10 Main Street, Apt 210, Boston MA 02110")
      }],
      phoneNumbers: []
    })]);

    expect(sanitized.specialties.map(({ value }) => value)).toEqual([
      "Diagnostic Radiology",
      "Apartment Medicine"
    ]);
    expect(sanitized.locations[0].addressLine2).toBe("Apt 210 Professional Office");
  });

  it("applies only literal contact vetoes and retains an unlabeled number", () => {
    const [sanitized] = sanitizeProviderProfiles([profile({
      phoneNumbers: [
        "Fax: 617-444-0101",
        "Facsimile: 617-444-0102",
        "Mobile: 617-444-0103",
        "Cell: 617-444-0104",
        "Personal: 617-444-0105",
        "Home: 617-444-0106",
        "617-444-0107"
      ].map(value => ({ value, citation: citation(value) }))
    })]);

    expect(sanitized.phoneNumbers.map(({ value }) => value)).toEqual(["617-444-0107"]);
  });

  it("rejects an affirmative NPI mismatch but not stale specialty disagreement", () => {
    const request = [{
      providerId: "provider-123",
      npi: "1234567890",
      name: "Ada Smith",
      specialty: "Family Medicine"
    }];
    const exactIdentity = profile({
      specialties: [{ value: "Diagnostic Radiology", citation: citation("Diagnostic Radiology") }],
      phoneNumbers: []
    });

    expect(sanitizeProviderProfilesForRequest([exactIdentity], request)).toHaveLength(1);
    expect(sanitizeProviderProfilesForRequest([{ ...exactIdentity, npi: "1098765432" }], request)).toEqual([]);
  });

  it("retains a specialty-only profile and a website equal to its directly cited page", () => {
    const firstPartyEvidence = "https://provider.example.org/about/ada-smith";
    const [sanitized] = sanitizeProviderProfiles([profile({
      specialties: [{ value: "Family Medicine", citation: citation("Family Medicine") }],
      phoneNumbers: [],
      websites: [{
        value: firstPartyEvidence,
        citation: citation("Ada Smith practices with Provider Example", firstPartyEvidence)
      }]
    })], { allowedSourceUrls: [sourceUrl, firstPartyEvidence] });

    expect(sanitized.specialties).toHaveLength(1);
    expect(sanitized.websites[0]).toEqual(expect.objectContaining({
      value: firstPartyEvidence,
      citation: expect.objectContaining({ sourceUrl: firstPartyEvidence })
    }));
  });

  it("does not perform a production host fetch while parsing", () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn(() => Promise.reject(new Error("must not fetch")));
    global.fetch = fetchSpy;
    try {
      expect(parseProviderProfilesFromResponse(response({
        type: "web_search_call",
        action: { type: "search", sources: [{ type: "url", url: sourceUrl }] }
      }))).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

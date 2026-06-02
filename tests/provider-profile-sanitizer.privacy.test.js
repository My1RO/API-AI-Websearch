const {
  sanitizeProviderProfiles,
  sanitizeProviderProfilesForRequest
} = require("../src/services/provider-profile-sanitizer.service");

describe("provider profile sanitizer", () => {
  const baseProfile = {
    providerId: "provider-123",
    npi: "1234567890",
    providerName: "The Cleveland Clinic Foundation",
    specialties: [],
    locations: [],
    phoneNumbers: [],
    ratings: [],
    publicInsuranceMentions: [],
    confidenceNotes: [],
    sources: []
  };

  it("drops ratings from directory-only sources while preserving supported contact facts", () => {
    const [profile] = sanitizeProviderProfiles([
      {
        ...baseProfile,
        phoneNumbers: [{ value: "(216) 444-2200", sourceId: "npi-source" }],
        locations: [
          {
            addressLine1: "9500 Euclid Ave",
            city: "Cleveland",
            state: "OH",
            zip: "44195",
            sourceId: "npi-source"
          }
        ],
        ratings: [{ value: "5 out of 5 stars", scale: "5", sourceId: "npi-source" }],
        sources: [
          {
            id: "npi-source",
            title: "THE CLEVELAND CLINIC FOUNDATION - NPI 1234567890",
            domain: "npiprofile.com"
          }
        ]
      }
    ]);

    expect(profile.phoneNumbers).toHaveLength(1);
    expect(profile.locations).toHaveLength(1);
    expect(profile.ratings).toEqual([]);
  });

  it("allows ratings from public review or rating sources", () => {
    const [profile] = sanitizeProviderProfiles([
      {
        ...baseProfile,
        ratings: [{ value: "4.8", scale: "5", sourceId: "rating-source" }],
        sources: [
          {
            id: "rating-source",
            title: "Public ratings",
            domain: "healthgrades.com"
          }
        ]
      }
    ]);

    expect(profile.ratings).toEqual([
      {
        value: "4.8",
        scale: "5",
        sourceId: "rating-source",
        sourceName: "Public ratings"
      }
    ]);
  });

  it("drops placeholder facts and sources before results can reach Redis", () => {
    const profiles = sanitizeProviderProfiles([
      {
        ...baseProfile,
        providerName: "Dr. Public Provider",
        phoneNumbers: [{ value: "(212) 555-0199", sourceId: "sample-source" }],
        locations: [
          {
            addressLine1: "Public address unavailable",
            city: "Cleveland",
            state: "OH",
            zip: "44113",
            sourceId: "sample-source"
          }
        ],
        sources: [
          {
            id: "sample-source",
            title: "Sample provider directory",
            domain: "example.com"
          }
        ]
      }
    ]);

    expect(profiles).toEqual([]);
  });

  it("drops Figma/demo source labels and placeholder phone formats", () => {
    const profiles = sanitizeProviderProfiles([
      {
        ...baseProfile,
        providerName: "Dr. Public Provider",
        phoneNumbers: [{ value: "(212) 123-4567", sourceId: "source-name" }],
        locations: [
          {
            addressLine1: "392 Jefferson Ave Ste 3",
            city: "Cuyahoga County",
            state: "OH",
            zip: "44131",
            sourceId: "source-name"
          }
        ],
        sources: [
          {
            id: "source-name",
            title: "Source name",
            domain: "loremipsum.com"
          }
        ]
      }
    ]);

    expect(profiles).toEqual([]);
  });

  it("drops profile shells that have no safe contact facts", () => {
    const profiles = sanitizeProviderProfiles([
      {
        ...baseProfile,
        providerName: "Dr. Public Provider",
        sources: [
          {
            id: "directory",
            title: "Public directory",
            domain: "npiprofile.com"
          }
        ]
      }
    ]);

    expect(profiles).toEqual([]);
  });

  it("normalizes sourced object values returned by AI into display-safe facts", () => {
    const [profile] = sanitizeProviderProfiles([
      {
        providerId: "provider-123",
        npi: "1234567890",
        providerName: { value: "The Cleveland Clinic Foundation" },
        specialties: [],
        locations: [
          {
            addressLine1: { value: "9500 Euclid Ave", sourceId: "src-1" },
            city: { value: "Cleveland" },
            state: { value: "OH" },
            zip: { value: "44195" }
          }
        ],
        phoneNumbers: [{ value: "(216) 444-2200", source: { id: "src-1", title: "NPI Profile" } }],
        ratings: [],
        publicInsuranceMentions: [],
        confidenceNotes: "Public directory match",
        sources: [{ id: "src-1", title: "NPI Profile", domain: "npiprofile.com" }]
      }
    ]);

    expect(profile.providerName).toBe("The Cleveland Clinic Foundation");
    expect(profile.locations).toEqual([
      {
        addressLine1: "9500 Euclid Ave",
        addressLine2: null,
        city: "Cleveland",
        state: "OH",
        zip: "44195",
        sourceId: "src-1",
        sourceName: "NPI Profile"
      }
    ]);
    expect(profile.phoneNumbers).toEqual([
      {
        value: "(216) 444-2200",
        sourceId: "src-1",
        sourceName: "NPI Profile"
      }
    ]);
    expect(profile.confidenceNotes).toEqual([]);
  });

  it("drops individual facts without source IDs instead of rejecting the full profile", () => {
    const [profile] = sanitizeProviderProfiles([
      {
        ...baseProfile,
        specialties: [{ value: "General Acute Care Hospital" }],
        publicInsuranceMentions: [{ value: "Accepts public plans", sourceId: "missing-domain" }],
        phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
        locations: [
          {
            addressLine1: "9500 Euclid Ave",
            city: "Cleveland",
            state: "OH",
            zip: "44195",
            sourceId: "directory"
          }
        ],
        sources: [
          {
            id: "missing-domain",
            title: "Directory without a domain"
          },
          {
            title: "NPI Profile",
            domain: "npiprofile.com"
          },
          {
            id: "directory",
            title: "NPI Profile",
            domain: "npiprofile.com"
          }
        ]
      }
    ]);

    expect(profile.specialties).toEqual([]);
    expect(profile.publicInsuranceMentions).toEqual([]);
    expect(profile.phoneNumbers).toHaveLength(1);
    expect(profile.locations).toHaveLength(1);
  });

  it("binds safe profiles only when they match the requested provider identity", () => {
    const profiles = sanitizeProviderProfilesForRequest(
      [
        {
          ...baseProfile,
          providerId: "wrong-provider",
          providerName: "Cleveland Eye Clinic",
          phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
          sources: [{ id: "directory", title: "NPI Profile", domain: "npiprofile.com" }]
        },
        {
          ...baseProfile,
          providerId: undefined,
          npi: undefined,
          providerName: "The Cleveland Clinic Foundation",
          phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
          sources: [{ id: "directory", title: "NPI Profile", domain: "npiprofile.com" }]
        }
      ],
      [
        {
          providerId: "selected-provider",
          npi: "1679525919",
          name: "The Cleveland Clinic Foundation"
        }
      ]
    );

    expect(profiles).toHaveLength(1);
    expect(profiles[0].providerId).toBe("selected-provider");
    expect(profiles[0].npi).toBe("1679525919");
    expect(profiles[0].providerName).toBe("The Cleveland Clinic Foundation");
  });

  it("uses the requested provider name when AI omits a name but the NPI matches", () => {
    const profiles = sanitizeProviderProfilesForRequest(
      [
        {
          providerId: undefined,
          npi: "1679525919",
          phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
          sources: [{ id: "directory", title: "NPI Profile", domain: "npiprofile.com" }]
        }
      ],
      [
        {
          providerId: "selected-provider",
          npi: "1679525919",
          name: "The Cleveland Clinic Foundation"
        }
      ]
    );

    expect(profiles).toHaveLength(1);
    expect(profiles[0].providerId).toBe("selected-provider");
    expect(profiles[0].npi).toBe("1679525919");
    expect(profiles[0].providerName).toBe("The Cleveland Clinic Foundation");
  });

  it("drops generic profiles that cannot be tied back to a requested provider", () => {
    const profiles = sanitizeProviderProfilesForRequest(
      [
        {
          ...baseProfile,
          providerId: undefined,
          npi: undefined,
          providerName: "Provider",
          phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
          sources: [{ id: "directory", title: "NPI Profile", domain: "npiprofile.com" }]
        }
      ],
      [
        {
          providerId: "selected-provider",
          npi: "1679525919",
          name: "The Cleveland Clinic Foundation"
        }
      ]
    );

    expect(profiles).toEqual([]);
  });

  it("drops profiles with a conflicting returned npi even when providerId matches", () => {
    const profiles = sanitizeProviderProfilesForRequest(
      [
        {
          ...baseProfile,
          providerId: "1679525919",
          npi: "1689791295",
          providerName: "The Cleveland Clinic Foundation",
          phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
          sources: [{ id: "directory", title: "NPI Profile", domain: "npiprofile.com" }]
        }
      ],
      [
        {
          providerId: "1679525919",
          name: "The Cleveland Clinic Foundation"
        }
      ]
    );

    expect(profiles).toEqual([]);
  });
});

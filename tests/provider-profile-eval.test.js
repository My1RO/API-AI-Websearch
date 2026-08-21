const {
  aggregateScores,
  canonicalizeWebsite,
  hmacEvalFact,
  normalizeAddress,
  normalizePhone,
  pollProviderProfileJob,
  providerEvalCaseSchema,
  repeatVariance,
  scoreCase,
  wilsonInterval
} = require("../src/eval/provider-profile-eval");

const evalCase = {
  schemaVersion: 1,
  caseId: "case-001",
  request: {
    providerId: "provider-001",
    npi: "1234567890",
    name: "Public Clinic",
    city: "Cleveland",
    state: "OH",
    zip: "44113"
  },
  strata: {
    entityType: "facility",
    region: "Midwest",
    rurality: "urban",
    specialtyGroup: "Primary care",
    edgeCases: ["multi_location"]
  },
  cmsBaseline: {
    capturedAt: "2026-01-15T00:00:00.000Z",
    providerId: "provider-001",
    name: "Public Clinic",
    address: "100 Public Street, Cleveland, OH 44113"
  },
  gold: {
    identity: { npi: "1234567890", entityType: "facility" },
    phones: [{
      value: "216-444-2200",
      status: "confirmed_current",
      displaySafe: true,
      sources: [{
        kind: "provider_official",
        domain: "publicclinic.org",
        capturedAt: "2026-01-15T00:00:00.000Z",
        evidenceId: "evidence-phone"
      }]
    }],
    addresses: [{
      value: "100 Public St, Cleveland, OH 44113",
      status: "confirmed_current",
      displaySafe: true,
      sources: [{
        kind: "cms",
        domain: "healthcare.gov",
        capturedAt: "2026-01-15T00:00:00.000Z",
        evidenceId: "evidence-address"
      }]
    }],
    websites: [],
    ratings: []
  }
};

const citation = {
  sourceUrl: "https://publicclinic.org/contact",
  sourceTitle: "Public Clinic",
  providerIdentitySpan: "Public Clinic NPI 1234567890",
  factSpan: "100 Public Street, Cleveland, OH 44113; (216) 444-2200",
  explicitFactDateSpan: null
};

const profile = {
  providerId: "provider-001",
  npi: "1234567890",
  providerName: "Public Clinic",
  specialties: [],
  locations: [{
    addressLine1: "100 Public Street",
    city: "Cleveland",
    state: "OH",
    zip: "44113",
    citation
  }],
  phoneNumbers: [{ value: "(216) 444-2200", citation }],
  ratings: [],
  websites: []
};

const observation = {
  schemaVersion: 1,
  caseId: "case-001",
  repeat: 1,
  startedAt: "2026-01-15T00:00:00.000Z",
  completedAt: "2026-01-15T00:00:01.000Z",
  latencyMs: 1000,
  terminalStatus: "completed",
  profile
};

describe("provider profile evaluation harness", () => {
  it("strictly rejects consumer and raw response fields from locked cases", () => {
    expect(() => providerEvalCaseSchema.parse({ ...evalCase, memberDob: "1980-01-01" })).toThrow();
    expect(() => providerEvalCaseSchema.parse({
      ...evalCase,
      request: { ...evalCase.request, quoteId: "quote-1" }
    })).toThrow();
  });

  it("normalizes phone, address, and website facts", () => {
    expect(normalizePhone("+1 (216) 444-2200 ext. 42")).toEqual({ digits: "2164442200", extension: "42" });
    expect(normalizeAddress("100 Public Street, Cleveland OH 44113").canonical)
      .toBe("100 public st cleveland oh 44113");
    expect(canonicalizeWebsite("https://www.PublicClinic.org/contact/?tracking=1#top"))
      .toBe("publicclinic.org/contact");
    expect(canonicalizeWebsite("https://publicclinic.org/provider?id=123"))
      .toBe("publicclinic.org/provider?id=123");
  });

  it("scores emitted precision, recall, top-one accuracy, and source support separately", () => {
    const score = scoreCase(evalCase, observation);
    expect(score.identityCorrect).toBe(true);
    expect(score.fields.phones).toEqual(expect.objectContaining({
      eligible: 1,
      emitted: 1,
      correct: 1,
      recovered: 1,
      topOneCorrect: 1,
      citationPresent: 1
    }));
    expect(score.fields.addresses.topOneCorrect).toBe(1);
    expect(score.cmsAddressConflict).toBe(false);
    const aggregate = aggregateScores([score]);
    expect(aggregate.fields.phones.topOneAccuracy.value).toBe(1);
    expect(aggregate.wrongProviderRate.value).toBe(0);
  });

  it("counts missing top-one output as incorrect without inventing emitted errors", () => {
    const score = scoreCase(evalCase, { ...observation, profile: { ...profile, phoneNumbers: [] } });
    expect(score.fields.phones).toEqual(expect.objectContaining({ emitted: 0, correct: 0, topOneCorrect: 0 }));
  });

  it("detects unsafe personal facts by HMAC without storing their plaintext", () => {
    const key = "test-only-evaluation-key";
    const unsafeHash = hmacEvalFact("phones", "216-999-0000", key);
    const unsafeCase = {
      ...evalCase,
      gold: {
        ...evalCase.gold,
        phones: [{ status: "unsafe_personal", displaySafe: false, valueHash: unsafeHash, sources: [] }]
      }
    };
    expect(providerEvalCaseSchema.parse(unsafeCase).gold.phones[0]).not.toHaveProperty("value");
    const score = scoreCase(unsafeCase, {
      ...observation,
      profile: { ...profile, phoneNumbers: [{ value: "(216) 999-0000", citation }] }
    }, { hmacKey: key });
    expect(score.fields.phones.unsafeDisclosures).toBe(1);
  });

  it("calculates bounded Wilson intervals and repeat agreement", () => {
    expect(wilsonInterval(5, 10)).toEqual(expect.objectContaining({
      lower: expect.any(Number),
      upper: expect.any(Number)
    }));
    const repeats = repeatVariance([
      observation,
      { ...observation, repeat: 2, profile: { ...profile, ratings: [{ value: "4.8", citation }] } }
    ]);
    expect(repeats.cases[0].meanJaccard).toBeLessThan(1);
  });

  it("polls only the existing asynchronous provider-profile API", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const responses = [
      new Response(JSON.stringify({
        requestId,
        status: "queued",
        expiresAt: "2026-01-15T00:03:00.000Z",
        profiles: [],
        providerJobs: []
      }), { status: 202, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({
        requestId,
        status: "completed",
        expiresAt: "2026-01-15T00:30:00.000Z",
        profiles: [profile],
        providerJobs: []
      }), { status: 200, headers: { "content-type": "application/json" } })
    ];
    const fetchImpl = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    let time = Date.parse("2026-01-15T00:00:00.000Z");
    const result = await pollProviderProfileJob({
      apiBase: "https://service.invalid/v1/ai",
      request: evalCase.request,
      caseId: evalCase.caseId,
      repeat: 1,
      fetchImpl,
      sleep: async () => { time += 2000; },
      now: () => time
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://service.invalid/v1/ai/provider-profiles", expect.objectContaining({ method: "POST" }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, `${"https://service.invalid/v1/ai/provider-profiles/"}${requestId}`, expect.any(Object));
    expect(result).toEqual(expect.objectContaining({ terminalStatus: "completed", latencyMs: 2000 }));
  });
});

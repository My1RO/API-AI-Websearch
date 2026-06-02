const { loadFirstAvailable, pickFunction } = require("./helpers/source-hook-loader");

const candidateJobStoreHook = loadFirstAvailable([
  "../src/services/provider-profile-job-store",
  "../src/services/provider-profile-jobs.service",
  "../src/services/provider-profile-job.service",
  "../src/services/profile-job.service",
  "../src/services/provider-profile.service"
]);

const directApiNames = {
  createJob: ["createJob", "enqueueJob", "queueJob"],
  markRunning: ["markRunning", "setRunning"],
  markCompleted: ["markCompleted", "setCompleted", "completeJob"],
  markFailed: ["markFailed", "setFailed", "failJob"],
  getJob: ["getJob", "getProviderProfileJob", "readJob"]
};

const factoryNames = [
  "createProviderProfileJobStore",
  "createProviderProfileJobsStore",
  "createProfileJobStore",
  "createJobStore"
];

const hasRedisJobContract = (sourceModule) =>
  Boolean(pickFunction(sourceModule, factoryNames)) ||
  Object.values(directApiNames).every((names) => Boolean(pickFunction(sourceModule, names)));

const jobStoreHook =
  candidateJobStoreHook.module && hasRedisJobContract(candidateJobStoreHook.module)
    ? candidateJobStoreHook
    : { id: null, module: null, errors: candidateJobStoreHook.errors || [] };

const describeWhenHookExists = jobStoreHook.module ? describe : describe.skip;

const createMockRedis = () => {
  const store = new Map();

  return {
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return "OK";
    }),
    setex: jest.fn(async (key, _ttlSeconds, value) => {
      store.set(key, value);
      return "OK";
    }),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1)
  };
};

describeWhenHookExists("provider profile Redis polling contract", () => {
  const makeStore =
    pickFunction(jobStoreHook.module, factoryNames) || null;

  const createJob = pickFunction(jobStoreHook.module, directApiNames.createJob);
  const markRunning = pickFunction(jobStoreHook.module, directApiNames.markRunning);
  const markCompleted = pickFunction(jobStoreHook.module, directApiNames.markCompleted);
  const markFailed = pickFunction(jobStoreHook.module, directApiNames.markFailed);
  const getJob = pickFunction(jobStoreHook.module, directApiNames.getJob);

  const resolveApi = (redis) => {
    if (makeStore) {
      return makeStore({
        redis,
        jobTtlSeconds: 3600,
        resultTtlSeconds: 1800,
        now: () => new Date("2026-06-01T12:00:00.000Z")
      });
    }

    return {
      createJob,
      markRunning,
      markCompleted,
      markFailed,
      getJob
    };
  };

  it("stores queued/running/failed job states with the job TTL", async () => {
    const redis = createMockRedis();
    const api = resolveApi(redis);

    expect(api.createJob).toEqual(expect.any(Function));
    expect(api.markRunning).toEqual(expect.any(Function));
    expect(api.markFailed).toEqual(expect.any(Function));

    await api.createJob("request-1");
    await api.markRunning("request-1");
    await api.markFailed("request-1", "search failed");

    const writes = [...redis.set.mock.calls, ...redis.setex.mock.calls];
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(writes)).toContain("queued");
    expect(JSON.stringify(writes)).toContain("running");
    expect(JSON.stringify(writes)).toContain("failed");
    expect(writes.some((call) => call.includes(3600))).toBe(true);
  });

  it("stores completed results with the shorter result TTL and without raw prompt/source URL payloads", async () => {
    const redis = createMockRedis();
    const api = resolveApi(redis);

    expect(api.markCompleted).toEqual(expect.any(Function));

    await api.markCompleted("request-1", [
      {
        providerName: "Dr. Ada Smith",
        phoneNumbers: [{ value: "+16174440123", sourceId: "nppes" }],
        prompt: "FORBIDDEN_PROMPT",
        rawResponse: "FORBIDDEN_RAW_RESPONSE",
        sources: [
          {
            id: "nppes",
            title: "NPPES",
            domain: "npiregistry.cms.hhs.gov",
            url: "https://example.invalid/source"
          }
        ]
      }
    ]);

    const writes = [...redis.set.mock.calls, ...redis.setex.mock.calls];
    expect(JSON.stringify(writes)).toContain("completed");
    expect(writes.some((call) => call.includes(1800))).toBe(true);
    expect(JSON.stringify(writes)).not.toContain("FORBIDDEN_PROMPT");
    expect(JSON.stringify(writes)).not.toContain("FORBIDDEN_RAW_RESPONSE");
    expect(JSON.stringify(writes)).not.toContain("https://example.invalid/source");
  });

  it("returns expired when Redis has no job payload", async () => {
    const redis = createMockRedis();
    redis.get.mockResolvedValue(null);
    const api = resolveApi(redis);

    expect(api.getJob).toEqual(expect.any(Function));
    await expect(api.getJob("request-1")).resolves.toEqual(
      expect.objectContaining({ status: "expired" })
    );
  });

  it("returns partial provider snapshots before every provider reaches a terminal state", async () => {
    const redis = createMockRedis();
    const api = resolveApi(redis);

    expect(api.createJob).toEqual(expect.any(Function));
    expect(api.markProviderSearching).toEqual(expect.any(Function));
    expect(api.markProviderCompleted).toEqual(expect.any(Function));
    expect(api.markProviderNoResults).toEqual(expect.any(Function));

    const created = await api.createJob("request-1", {
      providers: [
        {
          providerId: "1679525919",
          npi: "1679525919",
          name: "THE CLEVELAND CLINIC FOUNDATION",
          city: "Cleveland",
          state: "OH",
          zip: "44195"
        },
        {
          providerId: "second-provider",
          name: "Second Provider",
          city: "Cleveland",
          state: "OH",
          zip: "44113"
        }
      ],
      lineOfCoverage: "Medical"
    });
    const firstProviderKey = created.providerJobs[0].requestProviderKey;
    const secondProviderKey = created.providerJobs[1].requestProviderKey;

    expect(created).toEqual(expect.objectContaining({
      status: "queued",
      profiles: [],
      summary: {
        total: 2,
        completed: 0,
        noResults: 0,
        failed: 0,
        running: 2
      }
    }));
    expect(created.providerJobs.map((job) => job.status)).toEqual(["queued", "queued"]);

    const searching = await api.markProviderSearching("request-1", firstProviderKey);
    expect(searching.status).toBe("running");
    expect(searching.providerJobs[0]).toEqual(expect.objectContaining({
      status: "searching",
      loading: true
    }));

    const partial = await api.markProviderCompleted("request-1", firstProviderKey, [
      {
        providerId: "1679525919",
        npi: "1679525919",
        providerName: "THE CLEVELAND CLINIC FOUNDATION",
        phoneNumbers: [{ value: "(216) 444-2200", sourceId: "directory" }],
        locations: [{
          addressLine1: "9500 Euclid Ave",
          city: "Cleveland",
          state: "OH",
          zip: "44195",
          sourceId: "directory"
        }],
        sources: [{ id: "directory", title: "NPI Profile", domain: "npiprofile.com" }]
      }
    ]);

    expect(partial.status).toBe("running");
    expect(partial.summary).toEqual({
      total: 2,
      completed: 1,
      noResults: 0,
      failed: 0,
      running: 1
    });
    expect(partial.profiles).toHaveLength(1);
    expect(partial.providerJobs[0]).toEqual(expect.objectContaining({
      status: "completed",
      loading: false
    }));
    expect(partial.providerJobs[1]).toEqual(expect.objectContaining({
      status: "queued",
      loading: true
    }));
    expect(JSON.stringify(partial)).not.toContain("https://");

    const completed = await api.markProviderNoResults("request-1", secondProviderKey);

    expect(completed.status).toBe("completed");
    expect(completed.summary).toEqual({
      total: 2,
      completed: 1,
      noResults: 1,
      failed: 0,
      running: 0
    });
    expect(completed.profiles).toHaveLength(1);
    expect(completed.providerJobs[1]).toEqual(expect.objectContaining({
      status: "no_results",
      loading: false
    }));
    expect([...redis.set.mock.calls, ...redis.setex.mock.calls].some((call) => call.includes(1800))).toBe(true);
  });
});

if (!jobStoreHook.module) {
  test("provider profile Redis polling source hook is not available yet", () => {
    expect(jobStoreHook.id).toBeNull();
  });
}

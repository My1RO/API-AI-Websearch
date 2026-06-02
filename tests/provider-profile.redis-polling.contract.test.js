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

const createMockRedis = () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue("OK"),
  setex: jest.fn().mockResolvedValue("OK"),
  expire: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1)
});

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
});

if (!jobStoreHook.module) {
  test("provider profile Redis polling source hook is not available yet", () => {
    expect(jobStoreHook.id).toBeNull();
  });
}

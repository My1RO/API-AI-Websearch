import { randomUUID } from "node:crypto";

import { env } from "../config/env";
import { HttpError } from "../errors/http-error";
import { ensureRedis, redis } from "../db/redis";
import {
  ProviderProfile,
  ProviderProfileJob,
  ProviderProfileJobStatus,
  ProviderProfileProviderJob,
  ProviderProfileProviderJobStatus,
  ProviderProfileRequestItem
} from "../types/provider-profile";
import {
  CreateProviderProfilesInput,
  providerProfileJobSchema
} from "../validators/provider-profile.validator";
import { getProviderProfileAiClient } from "./ai-provider";
import {
  sanitizeProviderProfiles,
  sanitizeProviderProfilesForRequest
} from "./provider-profile-sanitizer.service";

const jobKey = (requestId: string): string => `ai:websearch:provider-profile:job:${requestId}`;
const providerSearchConcurrency = 3;

const expiresAt = (ttlSeconds: number): string => new Date(Date.now() + ttlSeconds * 1000).toISOString();

const setJob = async (job: ProviderProfileJob, ttlSeconds: number): Promise<void> => {
  await redis.set(jobKey(job.requestId), JSON.stringify(job), "EX", ttlSeconds);
};

interface RedisJobStoreClient {
  get(key: string): Promise<string | null>;
  set?(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  setex?(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

interface ProviderProfileJobStoreOptions {
  redis: RedisJobStoreClient;
  jobTtlSeconds?: number;
  resultTtlSeconds?: number;
  now?: () => Date;
}

const terminalProviderStatuses = new Set<ProviderProfileProviderJobStatus>([
  "completed",
  "no_results",
  "failed",
  "expired"
]);

const getRequestedProviderNpi = (provider: ProviderProfileRequestItem): string | undefined => {
  if (provider.npi) {
    return provider.npi;
  }

  return provider.providerId && /^\d{10}$/.test(provider.providerId) ? provider.providerId : undefined;
};

const normalizeIdentity = (value: string | undefined): string => (value || "").trim().toLowerCase();

const normalizeNameIdentity = (value: string | undefined): string => {
  return normalizeIdentity(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
};

const providerProfileMatchesProvider = (
  profile: ProviderProfile,
  provider: ProviderProfileRequestItem
): boolean => {
  const profileProviderId = normalizeIdentity(profile.providerId);
  const requestedProviderId = normalizeIdentity(provider.providerId);
  const profileNpi = normalizeIdentity(profile.npi);
  const requestedNpi = normalizeIdentity(getRequestedProviderNpi(provider));

  if (profileNpi && requestedNpi && profileNpi !== requestedNpi) {
    return false;
  }

  if (profileProviderId && requestedProviderId && profileProviderId === requestedProviderId) {
    return true;
  }

  if (profileNpi && requestedNpi && profileNpi === requestedNpi) {
    return true;
  }

  const profileName = normalizeNameIdentity(profile.providerName);
  const requestedName = normalizeNameIdentity(provider.name);
  return Boolean(profileName && requestedName && profileName === requestedName);
};

const requestProviderKey = (provider: ProviderProfileRequestItem, index: number): string => {
  const identity = provider.npi
    ? `npi:${provider.npi}`
    : provider.providerId
      ? `providerId:${provider.providerId}`
      : `name:${normalizeNameIdentity(provider.name) || "provider"}`;

  return `${index}:${identity}`.slice(0, 320);
};

const providerJobFromRequest = (
  provider: ProviderProfileRequestItem,
  index: number,
  status: ProviderProfileProviderJobStatus = "queued"
): ProviderProfileProviderJob => ({
  requestProviderKey: requestProviderKey(provider, index),
  providerId: provider.providerId,
  npi: getRequestedProviderNpi(provider),
  providerName: provider.name,
  status,
  loading: !terminalProviderStatuses.has(status),
  startedAt: null,
  completedAt: null,
  error: null
});

const summarizeProviderJobs = (providerJobs: ProviderProfileProviderJob[] = []) => {
  const total = providerJobs.length;
  const completed = providerJobs.filter((job) => job.status === "completed").length;
  const noResults = providerJobs.filter((job) => job.status === "no_results").length;
  const failed = providerJobs.filter((job) => job.status === "failed" || job.status === "expired").length;
  const running = providerJobs.filter((job) => !terminalProviderStatuses.has(job.status)).length;

  return {
    total,
    completed,
    noResults,
    failed,
    running
  };
};

const aggregateJobStatus = (
  providerJobs: ProviderProfileProviderJob[] | undefined,
  fallbackStatus: ProviderProfileJobStatus
): ProviderProfileJobStatus => {
  if (!providerJobs || providerJobs.length === 0) {
    return fallbackStatus;
  }

  if (providerJobs.every((job) => job.status === "queued")) {
    return "queued";
  }

  if (providerJobs.some((job) => !terminalProviderStatuses.has(job.status))) {
    return "running";
  }

  return "completed";
};

const withDerivedJobState = (job: ProviderProfileJob): ProviderProfileJob => {
  if (!job.providerJobs) {
    return job;
  }

  return {
    ...job,
    status: aggregateJobStatus(job.providerJobs, job.status),
    summary: summarizeProviderJobs(job.providerJobs)
  };
};

const buildInitialProviderProfileJob = (
  requestId: string,
  input: CreateProviderProfilesInput | undefined,
  ttlSeconds: number,
  now: () => Date = () => new Date()
): ProviderProfileJob => {
  const providerJobs = input?.providers.map((provider, index) => providerJobFromRequest(provider, index));
  const job: ProviderProfileJob = {
    requestId,
    status: "queued",
    expiresAt: new Date(now().getTime() + ttlSeconds * 1000).toISOString(),
    profiles: providerJobs ? [] : undefined,
    providerJobs
  };

  return withDerivedJobState(job);
};

const updateProviderJob = (
  job: ProviderProfileJob,
  requestProviderKey: string,
  updates: Partial<ProviderProfileProviderJob>
): ProviderProfileJob => {
  const providerJobs = (job.providerJobs || []).map((providerJob) => {
    if (providerJob.requestProviderKey !== requestProviderKey) {
      return providerJob;
    }

    const status = updates.status || providerJob.status;
    return {
      ...providerJob,
      ...updates,
      status,
      loading: !terminalProviderStatuses.has(status)
    };
  });

  return withDerivedJobState({
    ...job,
    providerJobs
  });
};

const completedJobTtl = (job: ProviderProfileJob, jobTtlSeconds: number, resultTtlSeconds: number): number => {
  return job.status === "completed" ? resultTtlSeconds : jobTtlSeconds;
};

export const createProviderProfileJobStore = (options: ProviderProfileJobStoreOptions) => {
  const jobTtlSeconds = Math.min(options.jobTtlSeconds || env.profileJobTtlSeconds, 3600);
  const resultTtlSeconds = Math.min(options.resultTtlSeconds || env.profileResultTtlSeconds, 1800);
  const now = options.now || (() => new Date());

  const storeExpiresAt = (ttlSeconds: number): string => new Date(now().getTime() + ttlSeconds * 1000).toISOString();

  const writeJob = async (job: ProviderProfileJob, ttlSeconds: number): Promise<void> => {
    const payload = JSON.stringify(job);
    if (options.redis.set) {
      await options.redis.set(jobKey(job.requestId), payload, "EX", ttlSeconds);
      return;
    }

    if (options.redis.setex) {
      await options.redis.setex(jobKey(job.requestId), ttlSeconds, payload);
    }
  };

  const readJob = async (requestId: string): Promise<ProviderProfileJob> => {
    const rawJob = await options.redis.get(jobKey(requestId));
    if (!rawJob) {
      return {
        requestId,
        status: "expired",
        expiresAt: now().toISOString()
      };
    }

    return JSON.parse(rawJob) as ProviderProfileJob;
  };

  const updateJob = async (
    requestId: string,
    updater: (job: ProviderProfileJob) => ProviderProfileJob
  ): Promise<ProviderProfileJob> => {
    const job = withDerivedJobState(updater(await readJob(requestId)));
    const ttlSeconds = completedJobTtl(job, jobTtlSeconds, resultTtlSeconds);
    const output = {
      ...job,
      expiresAt: storeExpiresAt(ttlSeconds)
    };

    await writeJob(output, ttlSeconds);
    return output;
  };

  return {
    createJob: async (requestId: string, input?: CreateProviderProfilesInput): Promise<ProviderProfileJob> => {
      const job = buildInitialProviderProfileJob(requestId, input, jobTtlSeconds, now);
      await writeJob(job, jobTtlSeconds);
      return job;
    },
    markRunning: async (requestId: string): Promise<ProviderProfileJob> => {
      const job: ProviderProfileJob = {
        requestId,
        status: "running",
        expiresAt: storeExpiresAt(jobTtlSeconds)
      };
      await writeJob(job, jobTtlSeconds);
      return job;
    },
    markCompleted: async (requestId: string, profiles: unknown): Promise<ProviderProfileJob> => {
      const job: ProviderProfileJob = {
        requestId,
        status: "completed",
        expiresAt: storeExpiresAt(resultTtlSeconds),
        profiles: sanitizeProviderProfiles(profiles)
      };
      await writeJob(job, resultTtlSeconds);
      return job;
    },
    markFailed: async (requestId: string, error: string): Promise<ProviderProfileJob> => {
      const job: ProviderProfileJob = {
        requestId,
        status: "failed",
        expiresAt: storeExpiresAt(jobTtlSeconds),
        error: error.slice(0, 255)
      };
      await writeJob(job, jobTtlSeconds);
      return job;
    },
    markProviderSearching: async (requestId: string, requestProviderKey: string): Promise<ProviderProfileJob> => {
      return updateJob(requestId, (job) => updateProviderJob(job, requestProviderKey, {
        status: "searching",
        startedAt: now().toISOString(),
        error: null
      }));
    },
    markProviderCompleted: async (
      requestId: string,
      requestProviderKey: string,
      profiles: unknown
    ): Promise<ProviderProfileJob> => {
      return updateJob(requestId, (job) => updateProviderJob({
        ...job,
        profiles: [...(job.profiles || []), ...sanitizeProviderProfiles(profiles)]
      }, requestProviderKey, {
        status: "completed",
        completedAt: now().toISOString(),
        error: null
      }));
    },
    markProviderNoResults: async (requestId: string, requestProviderKey: string): Promise<ProviderProfileJob> => {
      return updateJob(requestId, (job) => updateProviderJob(job, requestProviderKey, {
        status: "no_results",
        completedAt: now().toISOString(),
        error: null
      }));
    },
    markProviderFailed: async (
      requestId: string,
      requestProviderKey: string,
      error: string
    ): Promise<ProviderProfileJob> => {
      return updateJob(requestId, (job) => updateProviderJob(job, requestProviderKey, {
        status: "failed",
        completedAt: now().toISOString(),
        error: error.slice(0, 255)
      }));
    },
    getJob: async (requestId: string): Promise<ProviderProfileJob> => {
      return readJob(requestId);
    }
  };
};

const safeJobError = (error: unknown): string => {
  if (error instanceof HttpError && error.status < 500) {
    return error.message;
  }

  return "Provider profile search failed.";
};

const sanitizeCompletedProfiles = (
  profiles: unknown,
  input: CreateProviderProfilesInput
): ReturnType<typeof sanitizeProviderProfiles> => {
  return sanitizeProviderProfilesForRequest(profiles, input.providers);
};

const runProviderProfileJob = async (
  requestId: string,
  input: CreateProviderProfilesInput
): Promise<void> => {
  const client = getProviderProfileAiClient();
  let currentJob = buildInitialProviderProfileJob(requestId, input, env.profileJobTtlSeconds);
  let writeQueue = Promise.resolve();

  const writeSnapshot = (updater: (job: ProviderProfileJob) => ProviderProfileJob): Promise<void> => {
    writeQueue = writeQueue.then(async () => {
      currentJob = withDerivedJobState(updater(currentJob));
      const ttlSeconds = completedJobTtl(currentJob, env.profileJobTtlSeconds, env.profileResultTtlSeconds);
      currentJob = {
        ...currentJob,
        expiresAt: expiresAt(ttlSeconds)
      };

      await setJob(currentJob, ttlSeconds);
    });

    return writeQueue;
  };

  const searchProvider = async (provider: ProviderProfileRequestItem, index: number): Promise<void> => {
    const key = requestProviderKey(provider, index);
    await writeSnapshot((job) => updateProviderJob(job, key, {
      status: "searching",
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null
    }));

    try {
      const profiles = await client.searchProviderProfiles({
        providers: [provider],
        lineOfCoverage: input.lineOfCoverage
      });
      const sanitizedProfiles = sanitizeCompletedProfiles(profiles, {
        providers: [provider],
        lineOfCoverage: input.lineOfCoverage
      });

      await writeSnapshot((job) => updateProviderJob({
        ...job,
        profiles: [
          ...(job.profiles || []).filter((profile) => !providerProfileMatchesProvider(profile, provider)),
          ...sanitizedProfiles
        ]
      }, key, {
        status: sanitizedProfiles.length > 0 ? "completed" : "no_results",
        completedAt: new Date().toISOString(),
        error: null
      }));
    } catch (error) {
      await writeSnapshot((job) => updateProviderJob(job, key, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: safeJobError(error)
      }));
    }
  };

  try {
    let nextProviderIndex = 0;
    const workerCount = Math.min(providerSearchConcurrency, input.providers.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextProviderIndex < input.providers.length) {
        const providerIndex = nextProviderIndex;
        nextProviderIndex += 1;
        await searchProvider(input.providers[providerIndex], providerIndex);
      }
    });

    await Promise.all(workers);
    await writeQueue;
  } catch (error) {
    await setJob(
      {
        requestId,
        status: "failed",
        expiresAt: expiresAt(env.profileResultTtlSeconds),
        error: safeJobError(error)
      },
      env.profileResultTtlSeconds
    );
  }
};

export const createProviderProfileJob = async (
  input: CreateProviderProfilesInput
): Promise<ProviderProfileJob> => {
  getProviderProfileAiClient();

  try {
    await ensureRedis();
  } catch {
    throw new HttpError(503, "Provider profile job store is unavailable.", "JOB_STORE_UNAVAILABLE");
  }

  const requestId = randomUUID();
  const job = buildInitialProviderProfileJob(requestId, input, env.profileJobTtlSeconds);

  await setJob(job, env.profileJobTtlSeconds);
  void runProviderProfileJob(requestId, input);

  return job;
};

export const getProviderProfileJob = async (requestId: string): Promise<ProviderProfileJob> => {
  try {
    await ensureRedis();
  } catch {
    throw new HttpError(503, "Provider profile job store is unavailable.", "JOB_STORE_UNAVAILABLE");
  }

  const rawJob = await redis.get(jobKey(requestId));
  if (!rawJob) {
    return {
      requestId,
      status: "expired",
      expiresAt: new Date().toISOString()
    };
  }

  return providerProfileJobSchema.parse(JSON.parse(rawJob));
};

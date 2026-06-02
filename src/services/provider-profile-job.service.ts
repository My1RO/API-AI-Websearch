import { randomUUID } from "node:crypto";

import { env } from "../config/env";
import { HttpError } from "../errors/http-error";
import { ensureRedis, redis } from "../db/redis";
import { ProviderProfileJob } from "../types/provider-profile";
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

  return {
    createJob: async (requestId: string): Promise<ProviderProfileJob> => {
      const job: ProviderProfileJob = {
        requestId,
        status: "queued",
        expiresAt: storeExpiresAt(jobTtlSeconds)
      };
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
    getJob: async (requestId: string): Promise<ProviderProfileJob> => {
      const rawJob = await options.redis.get(jobKey(requestId));
      if (!rawJob) {
        return {
          requestId,
          status: "expired",
          expiresAt: now().toISOString()
        };
      }

      return JSON.parse(rawJob) as ProviderProfileJob;
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
  try {
    await setJob(
      {
        requestId,
        status: "running",
        expiresAt: expiresAt(env.profileJobTtlSeconds)
      },
      env.profileJobTtlSeconds
    );

    const profiles = await getProviderProfileAiClient().searchProviderProfiles(input);
    const sanitizedProfiles = sanitizeCompletedProfiles(profiles, input);

    await setJob(
      {
        requestId,
        status: "completed",
        expiresAt: expiresAt(env.profileResultTtlSeconds),
        profiles: sanitizedProfiles
      },
      env.profileResultTtlSeconds
    );
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
  const job: ProviderProfileJob = {
    requestId,
    status: "queued",
    expiresAt: expiresAt(env.profileJobTtlSeconds)
  };

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

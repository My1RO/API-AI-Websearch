import Redis from "ioredis";

import { env } from "../config/env";

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

redis.on("error", () => {
  // Redis health is reported through /health and route errors without logging connection details.
});

export const ensureRedis = async (): Promise<void> => {
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
};

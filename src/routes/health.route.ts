import { Router } from "express";

import { getAiRuntimeStatus } from "../config/runtime";
import { ensureRedis, redis } from "../db/redis";
import { asyncHandler } from "../middleware/async-handler";

export const healthRouter = Router();

healthRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    let redisStatus: "ok" | "unavailable" = "ok";

    try {
      await ensureRedis();
      await redis.ping();
    } catch {
      redisStatus = "unavailable";
    }

    response.status(redisStatus === "ok" ? 200 : 503).json({
      service: "api-ai-websearch",
      status: redisStatus === "ok" ? "ok" : "degraded",
      redis: redisStatus,
      ai: getAiRuntimeStatus(),
      timestamp: new Date().toISOString()
    });
  })
);

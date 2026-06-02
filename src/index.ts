import { env } from "./config/env";
import { createApp } from "./app";
import { closeDataSource } from "./db/data-source";
import { redis } from "./db/redis";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log("API-AI-Websearch listening", {
    port: env.port,
    provider: env.aiProvider,
    nodeEnv: env.nodeEnv
  });
});

const shutdown = async (): Promise<void> => {
  server.close(async () => {
    redis.disconnect();
    await closeDataSource();
    process.exit(0);
  });
};

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});

import express from "express";

import { aiRouter } from "./routes/ai.routes";
import { healthRouter } from "./routes/health.route";
import { authContextMiddleware } from "./middleware/auth-context.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", type: ["application/json", "application/*+json"] }));

  app.use("/health", healthRouter);
  app.use("/v1/ai", authContextMiddleware, aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

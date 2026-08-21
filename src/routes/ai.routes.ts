import { Router } from "express";
import { z } from "zod";

import { assertAiRuntimeReady } from "../config/runtime";
import { saveFeedback, savePhoneCall } from "../services/feedback.service";
import {
  createProviderProfileJob,
  getProviderProfileJob
} from "../services/provider-profile-job.service";
import {
  createProviderProfilesSchema,
  feedbackSchema,
  phoneCallSchema,
  requestIdParamSchema
} from "../validators/provider-profile.validator";
import { asyncHandler } from "../middleware/async-handler";
import { healthRouter } from "./health.route";

export const aiRouter = Router();

const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  return schema.parse(body);
};

aiRouter.use("/health", healthRouter);

export const brokerOrgIdFromRequest = (request: Express.Request): string => {
  return request.authContext.subdomain || "local";
};

const feedbackSubmitterClasses = new Set([
  "consumer",
  "producer",
  "broker_admin",
  "general_agent",
  "internal_administrator"
]);

const submitterClassFromRequest = (request: Express.Request): string => {
  const userClass = request.authContext.userClass || "";
  return feedbackSubmitterClasses.has(userClass) ? userClass : "unknown";
};

aiRouter.post(
  "/provider-profiles",
  asyncHandler(async (request, response) => {
    assertAiRuntimeReady();
    const input = parseBody(createProviderProfilesSchema, request.body);
    const job = await createProviderProfileJob(input, brokerOrgIdFromRequest(request));

    response.status(202).json(job);
  })
);

aiRouter.get(
  "/provider-profiles/:requestId",
  asyncHandler(async (request, response) => {
    assertAiRuntimeReady();
    const requestId = requestIdParamSchema.parse(request.params.requestId);
    const job = await getProviderProfileJob(requestId, brokerOrgIdFromRequest(request));

    response.status(200).json(job);
  })
);

aiRouter.post(
  "/provider-feedback",
  asyncHandler(async (request, response) => {
    assertAiRuntimeReady();
    const input = parseBody(feedbackSchema, {
      ...request.body,
      brokerOrgId: brokerOrgIdFromRequest(request),
      submitterClass: submitterClassFromRequest(request)
    });
    await saveFeedback(input);

    response.status(201).json({ status: "accepted" });
  })
);

aiRouter.post(
  "/provider-phone-call",
  asyncHandler(async (request, response) => {
    assertAiRuntimeReady();
    const input = parseBody(phoneCallSchema, {
      ...request.body,
      brokerOrgId: brokerOrgIdFromRequest(request)
    });
    await savePhoneCall(input);

    response.status(201).json({ status: "accepted" });
  })
);

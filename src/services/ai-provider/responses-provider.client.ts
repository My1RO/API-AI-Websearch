import OpenAI from "openai";

import { env } from "../../config/env";
import {
  AI_REASONING_EFFORT,
  AI_WEBSEARCH_ALLOWED_DOMAINS,
  AI_WEBSEARCH_BLOCKED_DOMAINS,
  AI_WEBSEARCH_MAX_TOOL_CALLS,
  AI_WEBSEARCH_PARALLEL_TOOL_CALLS,
  AI_WEBSEARCH_TOOL_CHOICE,
  AZURE_OPENAI_DEPLOYMENT,
  ReasoningEffort,
  SearchToolChoice
} from "../../config/provider-profile-model";
import { AiProviderError } from "../../errors/http-error";
import { assertAiRuntimeReady, azureOpenAiResponsesBaseUrl } from "../../config/runtime";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { parseProviderProfilesFromResponse } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";
import { buildReasoningOptions, buildWebSearchFilters, supportsReasoningModel, WebSearchFilters } from "./search-request-config";
import {
  AiProviderAttempt,
  AiProviderUsageRecord,
  logAiProviderSearchSummary,
  recordAiProviderUsage
} from "./usage-telemetry";

interface AzureWebSearchTool {
  type: "web_search";
  filters?: WebSearchFilters;
}

export interface ProviderProfileResponseRequest {
  model: string;
  instructions: string;
  input: string;
  tools: AzureWebSearchTool[];
  tool_choice: SearchToolChoice;
  max_tool_calls: number;
  parallel_tool_calls: boolean;
  store: false;
  reasoning?: { effort: ReasoningEffort };
}

interface ResponseStatusShape {
  status?: unknown;
}

const SDK_MAX_RETRIES = 2;

export const normalizedResponsesBaseUrl = (): string => {
  const baseUrl = azureOpenAiResponsesBaseUrl(env.azureOpenAiEndpoint);
  if (!baseUrl) {
    assertAiRuntimeReady();
    throw new Error("Azure OpenAI endpoint validation did not produce a base URL.");
  }

  return baseUrl;
};

export const createResponsesClient = (): OpenAI => {
  assertAiRuntimeReady();
  return new OpenAI({
    apiKey: env.azureOpenAiApiKey,
    baseURL: normalizedResponsesBaseUrl(),
    maxRetries: SDK_MAX_RETRIES
  });
};

export const providerProfileResponseRequest = (
  input: CreateProviderProfilesInput,
  identityOnly: boolean
): ProviderProfileResponseRequest => {
  const reasoning = supportsReasoningModel(AZURE_OPENAI_DEPLOYMENT)
    ? buildReasoningOptions(AI_REASONING_EFFORT)
    : undefined;
  const request: ProviderProfileResponseRequest = {
    model: AZURE_OPENAI_DEPLOYMENT,
    instructions: providerProfileSystemInstructions,
    input: buildProviderProfilePrompt(input, { identityOnly }),
    tools: [webSearchTool()],
    tool_choice: AI_WEBSEARCH_TOOL_CHOICE,
    max_tool_calls: AI_WEBSEARCH_MAX_TOOL_CALLS,
    parallel_tool_calls: AI_WEBSEARCH_PARALLEL_TOOL_CALLS,
    store: false
  };

  if (reasoning) {
    request.reasoning = reasoning;
  }

  return request;
};

export const assertCompletedResponse = (response: unknown): void => {
  const status = (response as ResponseStatusShape).status;

  if (typeof status === "string" && status !== "completed") {
    throw new AiProviderError();
  }
};

export class ProviderProfileResponsesClient implements ProviderProfileAiClient {
  private client?: OpenAI;

  async searchProviderProfiles(input: CreateProviderProfilesInput) {
    const usageRecords: AiProviderUsageRecord[] = [];
    const searchStartedAt = Date.now();
    let searchOutcome: "completed" | "failed" = "failed";

    try {
      const response = await this.createResponse(input, false, usageRecords);

      try {
        const profiles = parseProviderProfilesFromResponse(response);
        searchOutcome = "completed";
        return profiles;
      } catch (parseError) {
        if (!(parseError instanceof AiProviderError)) {
          throw parseError;
        }

        const retryResponse = await this.createResponse(input, true, usageRecords);
        const profiles = parseProviderProfilesFromResponse(retryResponse);
        searchOutcome = "completed";
        return profiles;
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw new AiProviderError();
    } finally {
      logAiProviderSearchSummary(usageRecords, searchOutcome, Date.now() - searchStartedAt);
    }
  }

  private async createResponse(
    input: CreateProviderProfilesInput,
    identityOnly: boolean,
    usageRecords: AiProviderUsageRecord[]
  ): Promise<unknown> {
    assertAiRuntimeReady();
    const request = providerProfileResponseRequest(input, identityOnly);
    const attempt: AiProviderAttempt = identityOnly ? "identity_retry" : "initial";
    const startedAt = Date.now();
    let usageRecorded = false;

    logAiProviderRequestMetadata({
      provider: "azure",
      model: AZURE_OPENAI_DEPLOYMENT,
      input,
      identityOnly,
      toolType: request.tools[0].type,
      toolChoice: request.tool_choice,
      store: request.store,
      maxToolCalls: request.max_tool_calls,
      parallelToolCalls: request.parallel_tool_calls,
      reasoningEffort: request.reasoning?.effort
    });

    try {
      const response = await this.responsesClient().responses.create(request as never);
      const status = (response as ResponseStatusShape).status;
      usageRecords.push(recordAiProviderUsage({
        model: AZURE_OPENAI_DEPLOYMENT,
        attempt,
        outcome: typeof status === "string" && status !== "completed" ? "incomplete" : "completed",
        durationMs: Date.now() - startedAt,
        response
      }));
      usageRecorded = true;
      assertCompletedResponse(response);
      return response;
    } catch (error) {
      if (!usageRecorded) {
        usageRecords.push(recordAiProviderUsage({
          model: AZURE_OPENAI_DEPLOYMENT,
          attempt,
          outcome: "request_error",
          durationMs: Date.now() - startedAt
        }));
      }

      throw error;
    }
  }

  private responsesClient(): OpenAI {
    if (!this.client) {
      this.client = createResponsesClient();
    }

    return this.client;
  }
}

const webSearchTool = (): AzureWebSearchTool => {
  const filters = buildWebSearchFilters(AI_WEBSEARCH_ALLOWED_DOMAINS, AI_WEBSEARCH_BLOCKED_DOMAINS);
  return filters ? { type: "web_search", filters } : { type: "web_search" };
};

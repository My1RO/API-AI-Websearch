import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";

import { env, ReasoningEffort, SearchToolChoice } from "../../config/env";
import { AiProviderError } from "../../errors/http-error";
import { assertAiRuntimeReady, azureOpenAiResponsesBaseUrl } from "../../config/runtime";
import {
  CreateProviderProfilesInput,
  providerProfileStructuredOutputSchema
} from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { parseProviderProfilesFromResponse } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";
import { buildReasoningOptions, buildWebSearchFilters, supportsReasoningModel, WebSearchFilters } from "./search-request-config";
import {
  AiProviderAttempt,
  AiProviderAttemptOutcome,
  AiProviderRetryReason,
  AiProviderUsageRecord,
  logAiProviderSearchSummary,
  recordAiProviderUsage
} from "./usage-telemetry";
import {
  createAiTransportSemanticAttemptTrace,
  createAiTransportTracingFetch,
  runWithAiTransportSemanticAttempt
} from "./transport-attempt-telemetry";

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
  include: ["web_search_call.action.sources"];
  text: {
    format: ReturnType<typeof zodTextFormat>;
  };
  store: false;
  reasoning?: { effort: ReasoningEffort };
}

interface ResponseStatusShape {
  status?: unknown;
  incomplete_details?: unknown;
  content_filters?: unknown;
  output?: unknown;
}

interface ResponseOutputShape {
  type?: unknown;
  content?: unknown;
}

interface ResponseContentShape {
  type?: unknown;
}

const INITIAL_SDK_MAX_RETRIES = 1;
const SEMANTIC_RETRY_SDK_MAX_RETRIES = 0;

class RetryableAiProviderResponseError extends AiProviderError {
  readonly retryReason: AiProviderRetryReason;

  constructor(retryReason: AiProviderRetryReason) {
    super();
    this.retryReason = retryReason;
  }
}

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
    maxRetries: INITIAL_SDK_MAX_RETRIES,
    fetch: createAiTransportTracingFetch()
  });
};

export const providerProfileResponseRequest = (
  input: CreateProviderProfilesInput,
  identityOnly: boolean
): ProviderProfileResponseRequest => {
  const reasoning = supportsReasoningModel(env.azureOpenAiDeployment)
    ? buildReasoningOptions(env.aiReasoningEffort)
    : undefined;
  const request: ProviderProfileResponseRequest = {
    model: env.azureOpenAiDeployment,
    instructions: providerProfileSystemInstructions,
    input: buildProviderProfilePrompt(input, { identityOnly }),
    tools: [webSearchTool()],
    tool_choice: env.aiWebSearchToolChoice,
    max_tool_calls: env.aiWebSearchMaxToolCalls,
    parallel_tool_calls: env.aiWebSearchParallelToolCalls,
    include: ["web_search_call.action.sources"],
    text: {
      format: zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles")
    },
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

const incompleteReason = (response: unknown): string | undefined => {
  const details = (response as ResponseStatusShape).incomplete_details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }

  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
};

const isCompletionContentFilter = (response: unknown): boolean => {
  const shaped = response as ResponseStatusShape;
  if (shaped.status !== "incomplete" || incompleteReason(response) !== "content_filter") {
    return false;
  }

  return Array.isArray(shaped.content_filters) && shaped.content_filters.some((filter) => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      return false;
    }

    const record = filter as { source_type?: unknown; blocked?: unknown };
    return record.source_type === "completion" && record.blocked === true;
  });
};

const hasNativeRefusal = (response: unknown): boolean => {
  const output = (response as ResponseStatusShape).output;
  if (!Array.isArray(output)) {
    return false;
  }

  return output.some((item: ResponseOutputShape) => (
    item?.type === "message"
    && Array.isArray(item.content)
    && item.content.some((content: ResponseContentShape) => content?.type === "refusal")
  ));
};

const isMalformedStrictOutputError = (error: unknown): boolean => (
  error instanceof AiProviderError || error instanceof ZodError
);

export class ProviderProfileResponsesClient implements ProviderProfileAiClient {
  private client?: OpenAI;

  async searchProviderProfiles(input: CreateProviderProfilesInput) {
    const usageRecords: AiProviderUsageRecord[] = [];
    const searchStartedAt = Date.now();
    let searchOutcome: "completed" | "failed" = "failed";

    try {
      try {
        const profiles = await this.executeAttempt(input, "initial", null, usageRecords);
        searchOutcome = "completed";
        return profiles;
      } catch (error) {
        if (!(error instanceof RetryableAiProviderResponseError)) {
          throw error;
        }

        const retryAttempt: AiProviderAttempt = error.retryReason === "content_filter_full_retry"
          || error.retryReason === "native_refusal_full_retry"
          ? "full_retry"
          : "identity_retry";
        const profiles = await this.executeAttempt(input, retryAttempt, error.retryReason, usageRecords);
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

  private async executeAttempt(
    input: CreateProviderProfilesInput,
    attempt: AiProviderAttempt,
    attemptRetryReason: AiProviderRetryReason | null,
    usageRecords: AiProviderUsageRecord[]
  ) {
    assertAiRuntimeReady();
    const identityOnly = attempt === "identity_retry";
    const request = providerProfileResponseRequest(input, identityOnly);
    const maxRetries = attempt === "initial" ? INITIAL_SDK_MAX_RETRIES : SEMANTIC_RETRY_SDK_MAX_RETRIES;
    const transportTrace = createAiTransportSemanticAttemptTrace(attempt);
    const startedAt = Date.now();
    let response: unknown;
    let outcome: AiProviderAttemptOutcome = "request_error";
    let retryReason = attemptRetryReason;

    logAiProviderRequestMetadata({
      provider: "azure",
      model: env.azureOpenAiDeployment,
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
      response = await runWithAiTransportSemanticAttempt(
        transportTrace,
        () => this.responsesClient().responses.create(request as never, { maxRetries })
      );
      const status = (response as ResponseStatusShape).status;
      if (typeof status === "string" && status !== "completed") {
        outcome = "incomplete";
        if (isCompletionContentFilter(response)) {
          if (attempt === "initial") {
            retryReason = "content_filter_full_retry";
            throw new RetryableAiProviderResponseError(retryReason);
          }
        }

        throw new AiProviderError();
      }

      if (hasNativeRefusal(response)) {
        outcome = "refusal";
        if (attempt === "initial") {
          retryReason = "native_refusal_full_retry";
          throw new RetryableAiProviderResponseError(retryReason);
        }

        throw new AiProviderError();
      }

      try {
        const profiles = parseProviderProfilesFromResponse(response);
        outcome = "completed";
        return profiles;
      } catch (error) {
        if (!isMalformedStrictOutputError(error)) {
          throw error;
        }

        outcome = "malformed";
        if (attempt === "initial") {
          retryReason = "malformed_identity_retry";
          throw new RetryableAiProviderResponseError(retryReason);
        }

        throw new AiProviderError();
      }
    } finally {
      usageRecords.push(recordAiProviderUsage({
        model: env.azureOpenAiDeployment,
        attempt,
        retryReason,
        outcome,
        durationMs: Date.now() - startedAt,
        response,
        semanticAttemptId: transportTrace.semanticAttemptId,
        transportHttpAttemptCount: transportTrace.httpAttempts.length,
        transportRetryCount: Math.max(0, transportTrace.httpAttempts.length - 1)
      }));
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
  const filters = buildWebSearchFilters(env.aiWebSearchAllowedDomains, env.aiWebSearchBlockedDomains);
  return filters ? { type: "web_search", filters } : { type: "web_search" };
};

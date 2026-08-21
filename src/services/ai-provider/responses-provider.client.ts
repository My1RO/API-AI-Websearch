import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";

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
import {
  CreateProviderProfilesInput,
  providerProfileStructuredOutputSchema
} from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { parseProviderProfilesFromResponse } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { buildReasoningOptions, buildWebSearchFilters, supportsReasoningModel, WebSearchFilters } from "./search-request-config";

type AiProviderAttempt = "initial" | "full_retry" | "identity_retry";
type AiProviderRetryReason =
  | "content_filter_full_retry"
  | "native_refusal_full_retry"
  | "malformed_identity_retry";

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
    maxRetries: INITIAL_SDK_MAX_RETRIES
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
    try {
      try {
        return await this.executeAttempt(input, "initial");
      } catch (error) {
        if (!(error instanceof RetryableAiProviderResponseError)) {
          throw error;
        }

        const retryAttempt: AiProviderAttempt = error.retryReason === "content_filter_full_retry"
          || error.retryReason === "native_refusal_full_retry"
          ? "full_retry"
          : "identity_retry";
        return await this.executeAttempt(input, retryAttempt);
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw new AiProviderError();
    }
  }

  private async executeAttempt(
    input: CreateProviderProfilesInput,
    attempt: AiProviderAttempt
  ) {
    assertAiRuntimeReady();
    const identityOnly = attempt === "identity_retry";
    const request = providerProfileResponseRequest(input, identityOnly);
    const maxRetries = attempt === "initial" ? INITIAL_SDK_MAX_RETRIES : SEMANTIC_RETRY_SDK_MAX_RETRIES;

    const response = await this.responsesClient().responses.create(request as never, { maxRetries });
    const status = (response as ResponseStatusShape).status;
    if (typeof status === "string" && status !== "completed") {
      if (isCompletionContentFilter(response)) {
        if (attempt === "initial") {
          throw new RetryableAiProviderResponseError("content_filter_full_retry");
        }
      }

      throw new AiProviderError();
    }

    if (hasNativeRefusal(response)) {
      if (attempt === "initial") {
        throw new RetryableAiProviderResponseError("native_refusal_full_retry");
      }

      throw new AiProviderError();
    }

    try {
      return parseProviderProfilesFromResponse(response);
    } catch (error) {
      if (!isMalformedStrictOutputError(error)) {
        throw error;
      }
      if (attempt === "initial") {
        throw new RetryableAiProviderResponseError("malformed_identity_retry");
      }

      throw new AiProviderError();
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

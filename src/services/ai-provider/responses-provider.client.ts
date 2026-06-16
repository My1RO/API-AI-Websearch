import OpenAI from "openai";

import { env, ReasoningEffort, SearchContextSize, SearchToolChoice } from "../../config/env";
import { AiProviderError } from "../../errors/http-error";
import { assertAiRuntimeReady } from "../../config/runtime";
import type { AiProviderName } from "../../config/runtime";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { extractResponseText, parseProviderProfilesFromText } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";
import { buildReasoningOptions, buildWebSearchFilters, supportsReasoningModel, WebSearchFilters } from "./search-request-config";

interface OpenAiWebSearchTool {
  type: "web_search";
  external_web_access: false;
  search_context_size: SearchContextSize;
  filters?: WebSearchFilters;
}

interface AzureWebSearchTool {
  type: "web_search";
  filters?: WebSearchFilters;
}

type ProviderProfileWebSearchTool = OpenAiWebSearchTool | AzureWebSearchTool;

export interface ProviderProfileResponseRequest {
  model: string;
  instructions: string;
  input: string;
  tools: ProviderProfileWebSearchTool[];
  tool_choice: SearchToolChoice;
  max_tool_calls: number;
  parallel_tool_calls: boolean;
  store: false;
  reasoning?: { effort: ReasoningEffort };
}

interface ResponseStatusShape {
  status?: unknown;
}

export const normalizedResponsesBaseUrl = (provider: AiProviderName): string | undefined => {
  if (provider === "openai") {
    return env.aiBaseUrl ? env.aiBaseUrl.replace(/\/+$/, "") : undefined;
  }

  const baseUrl = env.aiBaseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    return undefined;
  }

  return baseUrl.toLowerCase().endsWith("/openai/v1") ? baseUrl : `${baseUrl}/openai/v1`;
};

export const createResponsesClient = (provider: AiProviderName): OpenAI => {
  return new OpenAI({
    apiKey: env.aiApiKey,
    baseURL: normalizedResponsesBaseUrl(provider)
  });
};

export const providerProfileResponseRequest = (
  provider: AiProviderName,
  input: CreateProviderProfilesInput,
  identityOnly: boolean
): ProviderProfileResponseRequest => {
  const reasoning = supportsReasoningModel(env.aiModel) ? buildReasoningOptions(env.aiReasoningEffort) : undefined;
  const request: ProviderProfileResponseRequest = {
    model: env.aiModel,
    instructions: providerProfileSystemInstructions,
    input: buildProviderProfilePrompt(input, { identityOnly }),
    tools: [webSearchTool(provider)],
    tool_choice: env.aiWebSearchToolChoice,
    max_tool_calls: env.aiWebSearchMaxToolCalls,
    parallel_tool_calls: env.aiWebSearchParallelToolCalls,
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
    try {
      const response = await this.createResponse(input);

      try {
        return parseProviderProfilesFromText(extractResponseText(response));
      } catch (parseError) {
        if (!(parseError instanceof AiProviderError)) {
          throw parseError;
        }

        const retryResponse = await this.createResponse(input, true);
        return parseProviderProfilesFromText(extractResponseText(retryResponse));
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw new AiProviderError();
    }
  }

  private async createResponse(input: CreateProviderProfilesInput, identityOnly = false): Promise<unknown> {
    const provider = assertAiRuntimeReady();
    const request = providerProfileResponseRequest(provider, input, identityOnly);

    logAiProviderRequestMetadata({
      provider,
      model: env.aiModel,
      input,
      identityOnly,
      toolType: request.tools[0].type,
      toolChoice: request.tool_choice,
      externalWebAccess: false,
      store: request.store,
      maxToolCalls: request.max_tool_calls,
      parallelToolCalls: request.parallel_tool_calls,
      searchContextSize: "search_context_size" in request.tools[0] ? request.tools[0].search_context_size : undefined,
      reasoningEffort: request.reasoning?.effort
    });

    const response = await this.responsesClient(provider).responses.create(request as never);
    assertCompletedResponse(response);
    return response;
  }

  private responsesClient(provider: AiProviderName): OpenAI {
    if (!this.client) {
      this.client = createResponsesClient(provider);
    }

    return this.client;
  }
}

const webSearchTool = (provider: AiProviderName): ProviderProfileWebSearchTool => {
  const filters = buildWebSearchFilters(env.aiWebSearchAllowedDomains, env.aiWebSearchBlockedDomains);

  if (provider === "azure") {
    return filters ? { type: "web_search", filters } : { type: "web_search" };
  }

  return {
    type: "web_search",
    external_web_access: false,
    search_context_size: env.aiOpenAiSearchContextSize,
    ...(filters ? { filters } : {})
  };
};

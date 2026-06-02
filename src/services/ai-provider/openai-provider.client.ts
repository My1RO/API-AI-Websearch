import OpenAI from "openai";

import { env, ReasoningEffort, SearchContextSize, SearchReturnTokenBudget, SearchToolChoice } from "../../config/env";
import { AiProviderError } from "../../errors/http-error";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { extractResponseText, parseProviderProfilesFromText } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";
import { buildReasoningOptions, buildWebSearchFilters, supportsOpenAiReasoning, WebSearchFilters } from "./search-request-config";

interface OpenAiWebSearchTool {
  type: "web_search";
  external_web_access: false;
  search_context_size: SearchContextSize;
  return_token_budget?: SearchReturnTokenBudget;
  filters?: WebSearchFilters;
}

interface OpenAiProviderProfileRequest {
  model: string;
  instructions: string;
  input: string;
  tools: OpenAiWebSearchTool[];
  tool_choice: SearchToolChoice;
  max_tool_calls: number;
  parallel_tool_calls: boolean;
  store: false;
  reasoning?: { effort: ReasoningEffort };
}

export class OpenAiProviderProfileClient implements ProviderProfileAiClient {
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
    const request = this.responseRequest(input, identityOnly);

    logAiProviderRequestMetadata({
      provider: "openai",
      model: env.openaiModel,
      input,
      identityOnly,
      toolType: request.tools[0].type,
      toolChoice: request.tool_choice,
      externalWebAccess: request.tools[0].external_web_access,
      store: request.store,
      maxToolCalls: request.max_tool_calls,
      parallelToolCalls: request.parallel_tool_calls,
      searchContextSize: request.tools[0].search_context_size,
      reasoningEffort: request.reasoning?.effort
    });

    return this.openai().responses.create(request as never);
  }

  private responseRequest(input: CreateProviderProfilesInput, identityOnly: boolean): OpenAiProviderProfileRequest {
    const reasoning = this.reasoningOptions();
    const request: OpenAiProviderProfileRequest = {
      model: env.openaiModel,
      instructions: providerProfileSystemInstructions,
      input: buildProviderProfilePrompt(input, { identityOnly }),
      tools: [this.webSearchTool()],
      tool_choice: env.openaiWebSearchToolChoice,
      max_tool_calls: env.openaiWebSearchMaxToolCalls,
      parallel_tool_calls: env.openaiWebSearchParallelToolCalls,
      store: false
    };

    if (reasoning) {
      request.reasoning = reasoning;
    }

    return request;
  }

  private webSearchTool(): OpenAiWebSearchTool {
    const tool: OpenAiWebSearchTool = {
      type: "web_search",
      external_web_access: false,
      search_context_size: env.openaiWebSearchContextSize
    };
    const filters = buildWebSearchFilters(env.openaiWebSearchAllowedDomains, env.openaiWebSearchBlockedDomains);

    if (filters) {
      tool.filters = filters;
    }

    if (env.openaiWebSearchReturnTokenBudget && env.openaiWebSearchReturnTokenBudget !== "default") {
      tool.return_token_budget = env.openaiWebSearchReturnTokenBudget;
    }

    return tool;
  }

  private reasoningOptions(): { effort: ReasoningEffort } | undefined {
    if (!supportsOpenAiReasoning(env.openaiModel)) {
      return undefined;
    }

    return buildReasoningOptions(env.openaiReasoningEffort);
  }

  private openai(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: env.openaiApiKey
      });
    }

    return this.client;
  }
}

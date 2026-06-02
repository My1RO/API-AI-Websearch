import { env, ReasoningEffort, SearchToolChoice } from "../../config/env";
import { AiProviderError } from "../../errors/http-error";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { extractResponseText, parseProviderProfilesFromText } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";
import { buildReasoningOptions, buildWebSearchFilters, WebSearchFilters } from "./search-request-config";

interface AzureWebSearchTool {
  type: "web_search";
  filters?: WebSearchFilters;
}

interface AzureProviderProfileRequest {
  model: string;
  instructions: string;
  input: string;
  tools: AzureWebSearchTool[];
  tool_choice: SearchToolChoice;
  max_tool_calls: number;
  parallel_tool_calls: boolean;
  store: false;
  reasoning?: { effort: ReasoningEffort };
  include?: string[];
}

export class AzureProviderProfileClient implements ProviderProfileAiClient {
  async searchProviderProfiles(input: CreateProviderProfilesInput) {
    const response = await this.createResponse(input);

    try {
      return parseProviderProfilesFromText(extractResponseText(response));
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw new AiProviderError();
      }

      const retryResponse = await this.createResponse(input, true);
      return parseProviderProfilesFromText(extractResponseText(retryResponse));
    }
  }

  private async createResponse(input: CreateProviderProfilesInput, identityOnly = false): Promise<unknown> {
    const request = this.responseRequest(input, identityOnly);

    logAiProviderRequestMetadata({
      provider: "azure",
      model: env.azureDeployment,
      input,
      identityOnly,
      toolType: request.tools[0].type,
      toolChoice: request.tool_choice,
      externalWebAccess: false,
      store: request.store,
      maxToolCalls: request.max_tool_calls,
      parallelToolCalls: request.parallel_tool_calls,
      reasoningEffort: request.reasoning?.effort,
      includeSources: Boolean(request.include?.includes("web_search_call.action.sources"))
    });

    const response = await fetch(this.responsesUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": env.azureApiKey
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new AiProviderError();
    }

    return response.json();
  }

  private responseRequest(input: CreateProviderProfilesInput, identityOnly: boolean): AzureProviderProfileRequest {
    const reasoning = buildReasoningOptions(env.azureReasoningEffort);
    const request: AzureProviderProfileRequest = {
      model: env.azureDeployment,
      instructions: providerProfileSystemInstructions,
      input: buildProviderProfilePrompt(input, { identityOnly }),
      tools: [this.webSearchTool()],
      tool_choice: env.azureWebSearchToolChoice,
      max_tool_calls: env.azureWebSearchMaxToolCalls,
      parallel_tool_calls: env.azureWebSearchParallelToolCalls,
      store: false
    };

    if (reasoning) {
      request.reasoning = reasoning;
    }

    if (env.azureWebSearchIncludeSources) {
      request.include = ["web_search_call.action.sources"];
    }

    return request;
  }

  private webSearchTool(): AzureWebSearchTool {
    const tool: AzureWebSearchTool = {
      type: "web_search"
    };
    const filters = buildWebSearchFilters(env.azureWebSearchAllowedDomains, env.azureWebSearchBlockedDomains);

    if (filters) {
      tool.filters = filters;
    }

    return tool;
  }

  private responsesUrl(): string {
    const endpoint = env.azureEndpoint.replace(/\/+$/, "");
    const responsesPath = endpoint.endsWith("/openai/v1") ? `${endpoint}/responses` : `${endpoint}/openai/v1/responses`;

    if (!env.azureApiVersion) {
      return responsesPath;
    }

    const apiVersion = encodeURIComponent(env.azureApiVersion);
    return `${responsesPath}?api-version=${apiVersion}`;
  }
}

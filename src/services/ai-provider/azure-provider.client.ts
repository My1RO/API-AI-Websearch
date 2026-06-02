import { env } from "../../config/env";
import { AiProviderError } from "../../errors/http-error";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { extractResponseText, parseProviderProfilesFromText } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";

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
    logAiProviderRequestMetadata({
      provider: "azure",
      model: env.azureDeployment,
      input,
      identityOnly
    });

    const response = await fetch(this.responsesUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": env.azureApiKey
      },
      body: JSON.stringify({
        model: env.azureDeployment,
        instructions: providerProfileSystemInstructions,
        input: buildProviderProfilePrompt(input, { identityOnly }),
        tools: [
          {
            type: "web_search",
            external_web_access: false,
            search_context_size: "low"
          }
        ],
        tool_choice: "required",
        max_tool_calls: 1,
        parallel_tool_calls: false,
        store: false
      })
    });

    if (!response.ok) {
      throw new AiProviderError();
    }

    return response.json();
  }

  private responsesUrl(): string {
    const endpoint = env.azureEndpoint.replace(/\/+$/, "");
    const apiVersion = encodeURIComponent(env.azureApiVersion);
    return `${endpoint}/openai/v1/responses?api-version=${apiVersion}`;
  }
}

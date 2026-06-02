import OpenAI from "openai";

import { env } from "../../config/env";
import { AiProviderError } from "../../errors/http-error";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";
import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../prompt-builder.service";
import { extractResponseText, parseProviderProfilesFromText } from "./response-parser";
import { ProviderProfileAiClient } from "./provider-client";
import { logAiProviderRequestMetadata } from "./request-metadata-log";

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
    logAiProviderRequestMetadata({
      provider: "openai",
      model: env.openaiModel,
      input,
      identityOnly
    });

    return this.openai().responses.create({
      model: env.openaiModel,
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
    } as never);
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

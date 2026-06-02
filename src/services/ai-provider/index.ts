import { assertAiRuntimeReady } from "../../config/runtime";
import { AzureProviderProfileClient } from "./azure-provider.client";
import { OpenAiProviderProfileClient } from "./openai-provider.client";
import { ProviderProfileAiClient } from "./provider-client";

const clients: Record<string, ProviderProfileAiClient> = {
  azure: new AzureProviderProfileClient(),
  openai: new OpenAiProviderProfileClient()
};

export const getProviderProfileAiClient = (): ProviderProfileAiClient => {
  const provider = assertAiRuntimeReady();
  return clients[provider];
};

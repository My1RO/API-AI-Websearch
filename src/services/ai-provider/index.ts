import { ProviderProfileAiClient } from "./provider-client";
import { ProviderProfileResponsesClient } from "./responses-provider.client";

const client = new ProviderProfileResponsesClient();

export const getProviderProfileAiClient = (): ProviderProfileAiClient => {
  return client;
};

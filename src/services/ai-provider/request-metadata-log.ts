import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";

interface AiProviderRequestMetadata {
  provider: "azure";
  model: string;
  input: CreateProviderProfilesInput;
  identityOnly: boolean;
  toolType: string;
  toolChoice: string;
  store: boolean;
  maxToolCalls: number;
  parallelToolCalls: boolean;
  reasoningEffort?: string;
}

export const logAiProviderRequestMetadata = ({
  provider,
  model,
  input,
  identityOnly,
  toolType,
  toolChoice,
  store,
  maxToolCalls,
  parallelToolCalls,
  reasoningEffort
}: AiProviderRequestMetadata): void => {
  console.log("AI provider request metadata", {
    provider,
    model,
    lineOfCoverage: input.lineOfCoverage,
    providerCount: input.providers.length,
    providersWithNpi: input.providers.filter((profileProvider) => Boolean(profileProvider.npi)).length,
    providersWithProviderId: input.providers.filter((profileProvider) => Boolean(profileProvider.providerId)).length,
    providersWithLocationHints: input.providers.filter((profileProvider) => (
      Boolean(profileProvider.city) || Boolean(profileProvider.state) || Boolean(profileProvider.zip)
    )).length,
    identityOnly,
    toolType,
    toolChoice,
    store,
    maxToolCalls,
    parallelToolCalls,
    reasoningEffort
  });
};

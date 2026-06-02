import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";

interface AiProviderRequestMetadata {
  provider: "openai" | "azure";
  model: string;
  input: CreateProviderProfilesInput;
  identityOnly: boolean;
  toolType: string;
  toolChoice: string;
  externalWebAccess: boolean;
  store: boolean;
  maxToolCalls: number;
  parallelToolCalls: boolean;
  searchContextSize?: string;
  reasoningEffort?: string;
  includeSources?: boolean;
}

export const logAiProviderRequestMetadata = ({
  provider,
  model,
  input,
  identityOnly,
  toolType,
  toolChoice,
  externalWebAccess,
  store,
  maxToolCalls,
  parallelToolCalls,
  searchContextSize,
  reasoningEffort,
  includeSources
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
    externalWebAccess,
    store,
    maxToolCalls,
    parallelToolCalls,
    searchContextSize,
    reasoningEffort,
    includeSources
  });
};

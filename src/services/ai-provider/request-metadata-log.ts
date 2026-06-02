import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";

interface AiProviderRequestMetadata {
  provider: "openai" | "azure";
  model: string;
  input: CreateProviderProfilesInput;
  identityOnly: boolean;
}

export const logAiProviderRequestMetadata = ({
  provider,
  model,
  input,
  identityOnly
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
    toolType: "web_search",
    externalWebAccess: false,
    store: false,
    maxToolCalls: 1,
    parallelToolCalls: false
  });
};

import { ProviderProfile } from "../../types/provider-profile";
import { CreateProviderProfilesInput } from "../../validators/provider-profile.validator";

export interface ProviderProfileAiClient {
  searchProviderProfiles(input: CreateProviderProfilesInput): Promise<ProviderProfile[]>;
}

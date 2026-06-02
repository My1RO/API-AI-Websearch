import { env } from "./env";
import { HttpError } from "../errors/http-error";

export type AiProviderName = "openai" | "azure";

export interface AiRuntimeStatus {
  provider: string;
  enabled: boolean;
  ready: boolean;
  reason?: string;
}

const providerNames: AiProviderName[] = ["openai", "azure"];

export const getConfiguredProvider = (): AiProviderName | null => {
  return providerNames.includes(env.aiProvider as AiProviderName) ? (env.aiProvider as AiProviderName) : null;
};

export const getAiRuntimeStatus = (): AiRuntimeStatus => {
  const provider = getConfiguredProvider();

  if (!provider) {
    return {
      provider: env.aiProvider,
      enabled: false,
      ready: false,
      reason: "unsupported_provider"
    };
  }

  if (!env.aiFeatureEnabled) {
    return {
      provider,
      enabled: false,
      ready: false,
      reason: "feature_disabled"
    };
  }

  if (!env.aiComplianceConfirmed) {
    return {
      provider,
      enabled: true,
      ready: false,
      reason: "compliance_gate_unconfirmed"
    };
  }

  if (provider === "openai") {
    if (!env.openaiApiKey) {
      return {
        provider,
        enabled: true,
        ready: false,
        reason: "provider_not_configured"
      };
    }

    if (env.openaiExternalWebAccess || env.openaiStore) {
      return {
        provider,
        enabled: true,
        ready: false,
        reason: "unsafe_provider_config"
      };
    }
  }

  if (provider === "azure") {
    if (!env.azureContentLoggingConfirmed) {
      return {
        provider,
        enabled: true,
        ready: false,
        reason: "azure_compliance_gate_unconfirmed"
      };
    }

    if (!env.azureWebSearchEnabled) {
      return {
        provider,
        enabled: true,
        ready: false,
        reason: "azure_web_search_disabled"
      };
    }

    if (!env.azureWebSearchComplianceConfirmed) {
      return {
        provider,
        enabled: true,
        ready: false,
        reason: "azure_web_search_compliance_gate_unconfirmed"
      };
    }

    if (!env.azureEndpoint || !env.azureApiKey || !env.azureDeployment) {
      return {
        provider,
        enabled: true,
        ready: false,
        reason: "provider_not_configured"
      };
    }
  }

  return {
    provider,
    enabled: true,
    ready: true
  };
};

export const assertAiRuntimeReady = (): AiProviderName => {
  const status = getAiRuntimeStatus();
  const provider = getConfiguredProvider();

  if (!status.ready || !provider) {
    throw new HttpError(503, "AI provider profile runtime is not available.", "AI_RUNTIME_UNAVAILABLE");
  }

  return provider;
};

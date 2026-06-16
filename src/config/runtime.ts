import { env } from "./env";
import { HttpError } from "../errors/http-error";

export type AiProviderName = "openai" | "azure";

export interface AiRuntimeStatus {
  provider: string;
  enabled: boolean;
  ready: boolean;
  reason?: string;
  baseUrl?: string;
}

const providerNames: AiProviderName[] = ["openai", "azure"];

export const getConfiguredProvider = (): AiProviderName | null => {
  if (env.aiProviderOverride) {
    return providerNames.includes(env.aiProviderOverride as AiProviderName) ? env.aiProviderOverride as AiProviderName : null;
  }

  return providerFromBaseUrl(env.aiBaseUrl);
};

export const providerFromBaseUrl = (baseUrl: string): AiProviderName | null => {
  if (!baseUrl) {
    return "openai";
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (hostname === "api.openai.com") {
    return "openai";
  }

  if (hostname.endsWith(".openai.azure.com") || pathname.includes("/openai/v1")) {
    return "azure";
  }

  return null;
};

export const getAiRuntimeStatus = (): AiRuntimeStatus => {
  const provider = getConfiguredProvider();

  if (!provider) {
    return {
      provider: env.aiProviderOverride || "unknown",
      enabled: false,
      ready: false,
      reason: "unsupported_provider",
      baseUrl: env.aiBaseUrl
    };
  }

  if (!env.aiFeatureEnabled) {
    return {
      provider,
      enabled: false,
      ready: false,
      reason: "feature_disabled",
      baseUrl: env.aiBaseUrl
    };
  }

  if (!env.aiComplianceConfirmed) {
    return {
      provider,
      enabled: true,
      ready: false,
      reason: "compliance_gate_unconfirmed",
      baseUrl: env.aiBaseUrl
    };
  }

  if (!env.aiApiKey || !env.aiModel) {
    return {
      provider,
      enabled: true,
      ready: false,
      reason: "provider_not_configured",
      baseUrl: env.aiBaseUrl
    };
  }

  return {
    provider,
    enabled: true,
    ready: true,
    baseUrl: env.aiBaseUrl
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

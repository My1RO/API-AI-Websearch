import { env } from "./env";
import { HttpError } from "../errors/http-error";

export interface AiRuntimeStatus {
  provider: "azure";
  enabled: boolean;
  ready: boolean;
  reason?: string;
  baseUrl?: string;
}

export const azureOpenAiResponsesBaseUrl = (endpoint: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const isAzureHost = hostname.endsWith(".openai.azure.com");
  const isSupportedPath = pathname === "" || pathname === "/openai/v1";
  const hasOnlyEndpointParts = !parsed.username && !parsed.password && !parsed.port
    && !parsed.search && !parsed.hash;

  if (parsed.protocol !== "https:" || !isAzureHost || !isSupportedPath || !hasOnlyEndpointParts) {
    return null;
  }

  return `${parsed.origin}/openai/v1`;
};

export const getAiRuntimeStatus = (): AiRuntimeStatus => {
  const baseUrl = azureOpenAiResponsesBaseUrl(env.azureOpenAiEndpoint);

  if (!baseUrl) {
    return {
      provider: "azure",
      enabled: false,
      ready: false,
      reason: env.azureOpenAiEndpoint ? "invalid_azure_endpoint" : "azure_endpoint_not_configured",
      baseUrl: env.azureOpenAiEndpoint
    };
  }

  if (!env.aiFeatureEnabled) {
    return {
      provider: "azure",
      enabled: false,
      ready: false,
      reason: "feature_disabled",
      baseUrl
    };
  }

  if (!env.aiComplianceConfirmed) {
    return {
      provider: "azure",
      enabled: true,
      ready: false,
      reason: "compliance_gate_unconfirmed",
      baseUrl
    };
  }

  if (!env.azureOpenAiApiKey || !env.azureOpenAiDeployment) {
    return {
      provider: "azure",
      enabled: true,
      ready: false,
      reason: "provider_not_configured",
      baseUrl
    };
  }

  return {
    provider: "azure",
    enabled: true,
    ready: true,
    baseUrl
  };
};

export const assertAiRuntimeReady = (): void => {
  const status = getAiRuntimeStatus();

  if (!status.ready) {
    throw new HttpError(503, "AI provider profile runtime is not available.", "AI_RUNTIME_UNAVAILABLE");
  }
};

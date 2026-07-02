import dotenv from "dotenv";

dotenv.config();

const booleanValue = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const numberValue = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
};

const boundedNumberValue = (value: string | undefined, defaultValue: number, maxValue: number): number => {
  return Math.min(numberValue(value, defaultValue), maxValue);
};

const enumValue = <T extends string>(value: string | undefined, allowedValues: readonly T[], defaultValue: T): T => {
  const normalizedValue = (value || "").toLowerCase();
  return allowedValues.includes(normalizedValue as T) ? normalizedValue as T : defaultValue;
};

const optionalEnumValue = <T extends string>(value: string | undefined, allowedValues: readonly T[]): T | undefined => {
  const normalizedValue = (value || "").toLowerCase();
  return allowedValues.includes(normalizedValue as T) ? normalizedValue as T : undefined;
};

const csvValues = (value: string | undefined, maxValues: number): string[] => {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxValues);
};

const searchContextSizes = ["low", "medium", "high"] as const;
const searchToolChoices = ["auto", "required"] as const;
const reasoningEfforts = ["low", "medium", "high", "xhigh"] as const;

export type SearchContextSize = (typeof searchContextSizes)[number];
export type SearchToolChoice = (typeof searchToolChoices)[number];
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export const env = {
  port: numberValue(process.env.PORT, 3065),
  nodeEnv: process.env.NODE_ENV || "development",
  aiFeatureEnabled: booleanValue(process.env.AI_FEATURE_ENABLED),
  aiProviderOverride: envProviderOverride(process.env.AI_PROVIDER, process.env.NODE_ENV || "development"),
  aiComplianceConfirmed: booleanValue(process.env.AI_WEBSEARCH_COMPLIANCE_CONFIRMED),
  aiBaseUrl: process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || process.env.AZURE_OPENAI_ENDPOINT || "",
  aiApiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || "",
  aiModel: process.env.AI_MODEL || process.env.OPENAI_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.5",
  aiWebSearchToolChoice: enumValue(process.env.AI_WEBSEARCH_TOOL_CHOICE, searchToolChoices, "required"),
  aiWebSearchMaxToolCalls: boundedNumberValue(process.env.AI_WEBSEARCH_MAX_TOOL_CALLS, 8, 20),
  aiWebSearchParallelToolCalls: booleanValue(process.env.AI_WEBSEARCH_PARALLEL_TOOL_CALLS, true),
  aiReasoningEffort: optionalEnumValue(process.env.AI_REASONING_EFFORT || "medium", reasoningEfforts),
  aiOpenAiSearchContextSize: enumValue(process.env.AI_OPENAI_WEBSEARCH_CONTEXT_SIZE, searchContextSizes, "medium"),
  aiWebSearchAllowedDomains: csvValues(process.env.AI_WEBSEARCH_ALLOWED_DOMAINS, 100),
  aiWebSearchBlockedDomains: csvValues(process.env.AI_WEBSEARCH_BLOCKED_DOMAINS, 100),
  redisUrl: process.env.REDIS_URL || "redis://redis:6379",
  mysql: {
    host: process.env.MYSQL_HOST || "db",
    port: numberValue(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || "app",
    password: process.env.MYSQL_PASSWORD || "app",
    database: process.env.MYSQL_DATABASE || "api_ai_websearch"
  },
  profileJobTtlSeconds: boundedNumberValue(process.env.PROFILE_JOB_TTL_SECONDS, 3600, 3600),
  profileResultTtlSeconds: boundedNumberValue(process.env.PROFILE_RESULT_TTL_SECONDS, 1800, 1800),
  providerSearchConcurrency: boundedNumberValue(process.env.PROVIDER_PROFILE_SEARCH_CONCURRENCY, 2, 5),
  feedbackNoteMaxLength: numberValue(process.env.FEEDBACK_NOTE_MAX_LENGTH, 240)
};

function envProviderOverride(provider: string | undefined, nodeEnv: string): string {
  if (nodeEnv !== "test") {
    return "";
  }

  return (provider || "").toLowerCase();
}

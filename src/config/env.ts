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
const searchReturnTokenBudgets = ["default", "unlimited"] as const;

export type SearchContextSize = (typeof searchContextSizes)[number];
export type SearchToolChoice = (typeof searchToolChoices)[number];
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export type SearchReturnTokenBudget = (typeof searchReturnTokenBudgets)[number];

export const env = {
  port: numberValue(process.env.PORT, 3065),
  nodeEnv: process.env.NODE_ENV || "development",
  aiFeatureEnabled: booleanValue(process.env.AI_FEATURE_ENABLED),
  aiProvider: (process.env.AI_PROVIDER || "openai").toLowerCase(),
  aiComplianceConfirmed: booleanValue(process.env.AI_WEBSEARCH_COMPLIANCE_CONFIRMED),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.5",
  openaiExternalWebAccess: booleanValue(process.env.OPENAI_WEB_SEARCH_EXTERNAL_ACCESS, false),
  openaiStore: booleanValue(process.env.OPENAI_STORE, false),
  openaiWebSearchContextSize: enumValue(process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE, searchContextSizes, "medium"),
  openaiWebSearchToolChoice: enumValue(process.env.OPENAI_WEB_SEARCH_TOOL_CHOICE, searchToolChoices, "required"),
  openaiWebSearchMaxToolCalls: boundedNumberValue(process.env.OPENAI_WEB_SEARCH_MAX_TOOL_CALLS, 8, 20),
  openaiWebSearchParallelToolCalls: booleanValue(process.env.OPENAI_WEB_SEARCH_PARALLEL_TOOL_CALLS, true),
  openaiReasoningEffort: optionalEnumValue(process.env.OPENAI_REASONING_EFFORT || "medium", reasoningEfforts),
  openaiWebSearchReturnTokenBudget: optionalEnumValue(
    process.env.OPENAI_WEB_SEARCH_RETURN_TOKEN_BUDGET,
    searchReturnTokenBudgets
  ),
  openaiWebSearchAllowedDomains: csvValues(process.env.OPENAI_WEB_SEARCH_ALLOWED_DOMAINS, 100),
  openaiWebSearchBlockedDomains: csvValues(process.env.OPENAI_WEB_SEARCH_BLOCKED_DOMAINS, 100),
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  azureApiKey: process.env.AZURE_OPENAI_API_KEY || "",
  azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || "",
  azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || "",
  azureContentLoggingConfirmed: booleanValue(process.env.AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED),
  azureWebSearchEnabled: booleanValue(process.env.AZURE_OPENAI_WEB_SEARCH_ENABLED),
  azureWebSearchComplianceConfirmed: booleanValue(process.env.AZURE_OPENAI_WEB_SEARCH_COMPLIANCE_CONFIRMED),
  azureWebSearchToolChoice: enumValue(process.env.AZURE_OPENAI_WEB_SEARCH_TOOL_CHOICE, searchToolChoices, "required"),
  azureWebSearchMaxToolCalls: boundedNumberValue(process.env.AZURE_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS, 8, 20),
  azureWebSearchParallelToolCalls: booleanValue(process.env.AZURE_OPENAI_WEB_SEARCH_PARALLEL_TOOL_CALLS, true),
  azureReasoningEffort: optionalEnumValue(process.env.AZURE_OPENAI_REASONING_EFFORT, reasoningEfforts),
  azureWebSearchIncludeSources: booleanValue(process.env.AZURE_OPENAI_WEB_SEARCH_INCLUDE_SOURCES),
  azureWebSearchAllowedDomains: csvValues(process.env.AZURE_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS, 100),
  azureWebSearchBlockedDomains: csvValues(process.env.AZURE_OPENAI_WEB_SEARCH_BLOCKED_DOMAINS, 100),
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
  feedbackNoteMaxLength: numberValue(process.env.FEEDBACK_NOTE_MAX_LENGTH, 240)
};

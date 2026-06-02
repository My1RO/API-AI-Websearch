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

export const env = {
  port: numberValue(process.env.PORT, 3065),
  nodeEnv: process.env.NODE_ENV || "development",
  aiFeatureEnabled: booleanValue(process.env.AI_FEATURE_ENABLED),
  aiProvider: (process.env.AI_PROVIDER || "openai").toLowerCase(),
  aiComplianceConfirmed: booleanValue(process.env.AI_WEBSEARCH_COMPLIANCE_CONFIRMED),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1",
  openaiExternalWebAccess: booleanValue(process.env.OPENAI_WEB_SEARCH_EXTERNAL_ACCESS, false),
  openaiStore: booleanValue(process.env.OPENAI_STORE, false),
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  azureApiKey: process.env.AZURE_OPENAI_API_KEY || "",
  azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || "",
  azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview",
  azureContentLoggingConfirmed: booleanValue(process.env.AZURE_OPENAI_CONTENT_LOGGING_CONFIRMED),
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

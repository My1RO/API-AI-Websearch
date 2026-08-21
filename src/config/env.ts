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
  aiComplianceConfirmed: booleanValue(process.env.AI_WEBSEARCH_COMPLIANCE_CONFIRMED),
  azureOpenAiEndpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  azureOpenAiApiKey: process.env.AZURE_OPENAI_API_KEY || "",
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
  providerSearchConcurrency: boundedNumberValue(process.env.PROVIDER_PROFILE_SEARCH_CONCURRENCY, 2, 5)
};

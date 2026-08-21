export const AZURE_OPENAI_DEPLOYMENT = "gpt-5.6-terra" as const;
export const AI_WEBSEARCH_TOOL_CHOICE = "required" as const;
export const AI_WEBSEARCH_MAX_TOOL_CALLS = 8;
export const AI_WEBSEARCH_PARALLEL_TOOL_CALLS = true;
export const AI_REASONING_EFFORT = "low" as const;
export const AI_WEBSEARCH_ALLOWED_DOMAINS: readonly string[] = Object.freeze([]);
export const AI_WEBSEARCH_BLOCKED_DOMAINS: readonly string[] = Object.freeze([]);

export type SearchToolChoice = typeof AI_WEBSEARCH_TOOL_CHOICE;
export type ReasoningEffort = typeof AI_REASONING_EFFORT;

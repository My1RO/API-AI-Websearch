import { ReasoningEffort } from "../../config/provider-profile-model";

export interface WebSearchFilters {
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export const buildWebSearchFilters = (
  allowedDomains: readonly string[],
  blockedDomains: readonly string[]
): WebSearchFilters | undefined => {
  const filters: WebSearchFilters = {};

  if (allowedDomains.length > 0) {
    filters.allowed_domains = [...allowedDomains];
  }

  if (blockedDomains.length > 0) {
    filters.blocked_domains = [...blockedDomains];
  }

  return filters.allowed_domains || filters.blocked_domains ? filters : undefined;
};

export const supportsReasoningModel = (model: string): boolean => {
  const normalizedModel = model.toLowerCase();
  return normalizedModel.startsWith("gpt-5") || /^o\d/.test(normalizedModel);
};

export const buildReasoningOptions = (effort: ReasoningEffort | undefined): { effort: ReasoningEffort } | undefined => {
  return effort ? { effort } : undefined;
};

import { AiProviderError } from "../../errors/http-error";
import { sanitizeProviderProfiles } from "../provider-profile-sanitizer.service";

interface ResponseContentPart {
  type?: string;
  text?: unknown;
  annotations?: unknown;
}

interface ResponseOutputItem {
  type?: string;
  content?: ResponseContentPart[];
  action?: unknown;
}

interface ResponseShape {
  output_text?: unknown;
  output_parsed?: unknown;
  output?: ResponseOutputItem[];
}

const stripCodeFence = (value: string): string => {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
};

const extractJsonText = (value: string): string => {
  const stripped = stripCodeFence(value);
  const objectIndex = stripped.indexOf("{");
  const arrayIndex = stripped.indexOf("[");
  const firstIndex = [objectIndex, arrayIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];

  if (firstIndex === undefined) {
    throw new AiProviderError("AI provider did not return a profile payload.");
  }

  const lastObject = stripped.lastIndexOf("}");
  const lastArray = stripped.lastIndexOf("]");
  const lastIndex = Math.max(lastObject, lastArray);

  if (lastIndex < firstIndex) {
    throw new AiProviderError("AI provider did not return a profile payload.");
  }

  return stripped.slice(firstIndex, lastIndex + 1);
};

export const extractResponseText = (response: unknown): string => {
  const shaped = response as ResponseShape;
  if (typeof shaped.output_text === "string" && shaped.output_text.trim()) {
    return shaped.output_text;
  }

  const text = shaped.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();

  if (!text) {
    throw new AiProviderError("AI provider did not return a profile payload.");
  }

  return text;
};

export const parseProviderProfilesFromText = (value: string) => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonText(value));
  } catch {
    throw new AiProviderError("AI provider returned an invalid profile payload.");
  }

  const profiles = Array.isArray(parsed) ? parsed : (parsed as { profiles?: unknown }).profiles;
  if (!profiles) {
    throw new AiProviderError("AI provider returned an invalid profile payload.");
  }

  return sanitizeProviderProfiles(profiles);
};

const citationUrlFromAnnotation = (annotation: unknown): string | undefined => {
  if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
    return undefined;
  }

  const record = annotation as Record<string, unknown>;
  if (record.type !== "url_citation") {
    return undefined;
  }
  const nested = record.url_citation;
  if (typeof record.url === "string") {
    return record.url;
  }
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedUrl = (nested as Record<string, unknown>).url;
    return typeof nestedUrl === "string" ? nestedUrl : undefined;
  }

  return undefined;
};

export const extractResponseCitationUrls = (response: unknown): string[] => {
  const shaped = response as ResponseShape;
  return [...new Set(
    (shaped.output || [])
      .flatMap((item) => item.content || [])
      .flatMap((part) => Array.isArray(part.annotations) ? part.annotations : [])
      .map(citationUrlFromAnnotation)
      .filter((url): url is string => Boolean(url))
  )];
};

export const extractResponseWebSearchSourceUrls = (response: unknown): string[] => {
  const shaped = response as ResponseShape;
  return [...new Set(
    (shaped.output || [])
      .filter((item) => item.type === "web_search_call")
      .flatMap((item) => {
        if (!item.action || typeof item.action !== "object" || Array.isArray(item.action)) {
          return [];
        }
        const sources = (item.action as Record<string, unknown>).sources;
        return Array.isArray(sources) ? sources : [];
      })
      .map((source) => {
        if (!source || typeof source !== "object" || Array.isArray(source)) {
          return undefined;
        }
        const url = (source as Record<string, unknown>).url;
        return typeof url === "string" ? url : undefined;
      })
      .filter((url): url is string => Boolean(url))
  )];
};

export const extractResponseWebSearchOpenedUrls = (response: unknown): string[] => {
  const shaped = response as ResponseShape;
  return [...new Set(
    (shaped.output || [])
      .filter((item) => item.type === "web_search_call")
      .map((item) => {
        if (!item.action || typeof item.action !== "object" || Array.isArray(item.action)) {
          return undefined;
        }
        const action = item.action as Record<string, unknown>;
        return action.type === "open_page" && typeof action.url === "string"
          ? action.url
          : undefined;
      })
      .filter((url): url is string => Boolean(url))
  )];
};

export const extractResponseProvenanceUrls = (response: unknown): string[] => [
  ...new Set([
    ...extractResponseCitationUrls(response),
    ...extractResponseWebSearchSourceUrls(response),
    ...extractResponseWebSearchOpenedUrls(response)
  ])
];

export const parseProviderProfilesFromResponse = (response: unknown) => {
  const shaped = response as ResponseShape;
  let parsed: unknown = shaped.output_parsed;

  if (!parsed) {
    try {
      parsed = JSON.parse(extractJsonText(extractResponseText(response)));
    } catch {
      throw new AiProviderError("AI provider returned an invalid profile payload.");
    }
  }

  const profiles = Array.isArray(parsed) ? parsed : (parsed as { profiles?: unknown }).profiles;
  if (!profiles) {
    throw new AiProviderError("AI provider returned an invalid profile payload.");
  }

  return sanitizeProviderProfiles(profiles, {
    allowedSourceUrls: extractResponseProvenanceUrls(response)
  });
};

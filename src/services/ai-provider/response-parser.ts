import { AiProviderError } from "../../errors/http-error";
import { sanitizeProviderProfiles } from "../provider-profile-sanitizer.service";

interface ResponseContentPart {
  type?: string;
  text?: unknown;
}

interface ResponseOutputItem {
  type?: string;
  content?: ResponseContentPart[];
}

interface ResponseShape {
  output_text?: unknown;
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

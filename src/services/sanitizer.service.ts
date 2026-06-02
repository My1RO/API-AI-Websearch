import { HttpError } from "../errors/http-error";

const controlCharacters = /[\u0000-\u001f\u007f]/g;
const whitespace = /\s+/g;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;
const citationPayloadPattern = /"url"\s*:|"annotations"\s*:|"citation"\s*:/i;
const placeholderPhonePattern = /\b(?:\(?\d{3}\)?\D*)?555\D*\d{4}\b|\b555\D*010\D*\d{4}\b|\b(?:\(?\d{3}\)?\D*)?123\D*4567\b/i;
const placeholderTextPatterns = [
  /^string(?:\s+optional)?$/i,
  /^unknown$/i,
  /^n\/a$/i,
  /\bmock\b/i,
  /\bfake\b/i,
  /\bdummy\b/i,
  /\bsample\b/i,
  /\bplaceholder\b/i,
  /\bdemo\b/i,
  /\btest\b/i,
  /\blorem\s*ipsum\b/i,
  /loremipsum/i,
  /source\s*(name|label)?/i,
  /public address unavailable/i
];
const placeholderDomainPattern = /^(?:example\.(?:com|org|net)|mock\.local|localhost|local|public-source|(?:.+\.)?test)$/i;
const unsafeContentPatterns = [
  /\bquote\b/i,
  /\bmember\b/i,
  /\bclient\b/i,
  /\bpatient\b/i,
  /\bdob\b/i,
  /\bdate\s*of\s*birth\b/i,
  /\bbirth\s*date\b/i,
  /\bdiagnos\w*\b/i,
  /\bmedication\w*\b/i,
  /\bprescription\w*\b/i,
  /\bssn\b/i,
  /@/
];

export const cleanPublicText = (value: string | null | undefined, maxLength: number): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const cleaned = value.replace(controlCharacters, " ").replace(whitespace, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
};

export const containsUnsafeStoredContent = (value: string): boolean => {
  return urlPattern.test(value) || citationPayloadPattern.test(value) || unsafeContentPatterns.some((pattern) => pattern.test(value));
};

export const containsPlaceholderContent = (value: string): boolean => {
  const cleaned = value.replace(controlCharacters, " ").replace(whitespace, " ").trim();
  return placeholderPhonePattern.test(cleaned) || placeholderTextPatterns.some((pattern) => pattern.test(cleaned));
};

export const isPlaceholderDomain = (value: string | undefined): boolean => {
  const cleaned = cleanPublicText(value, 255)?.toLowerCase();
  return !cleaned || placeholderDomainPattern.test(cleaned);
};

export const cleanSafeStoredFact = (value: string, maxLength = 500): string | undefined => {
  const cleaned = cleanPublicText(value, maxLength);
  if (!cleaned || containsUnsafeStoredContent(cleaned) || containsPlaceholderContent(cleaned)) {
    return undefined;
  }

  return cleaned;
};

export const sanitizeStoredFactOrThrow = (value: string, fieldName: string, maxLength = 255): string => {
  const cleaned = cleanSafeStoredFact(value, maxLength);
  if (!cleaned) {
    throw new HttpError(400, `${fieldName} is not safe for AI feedback storage.`, "UNSAFE_FACT_VALUE");
  }

  return cleaned;
};

export const sanitizePhoneNumberOrThrow = (value: string): string => {
  const cleaned = cleanPublicText(value, 30);
  if (!cleaned || containsUnsafeStoredContent(cleaned) || containsPlaceholderContent(cleaned)) {
    throw new HttpError(400, "normalizedPhone is not safe for storage.", "UNSAFE_PHONE_VALUE");
  }

  const normalized = cleaned.replace(/[^\d+(). -]/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, "normalizedPhone is invalid.", "INVALID_PHONE_VALUE");
  }

  return normalized.trim();
};

export const safeSourceId = (value: string | undefined, fallback: string): string => {
  const cleaned = cleanPublicText(value, 80)?.replace(/[^a-zA-Z0-9_.:-]/g, "-").replace(/-+/g, "-");
  return cleaned || fallback;
};

export const safeDomain = (domain: string | undefined, url: string | undefined, fallback = "public-source"): string => {
  const fromUrl = (() => {
    if (!url) {
      return undefined;
    }

    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return undefined;
    }
  })();

  const cleaned = cleanPublicText(fromUrl || domain, 255)?.toLowerCase();
  if (!cleaned || containsUnsafeStoredContent(cleaned) || isPlaceholderDomain(cleaned)) {
    return fallback;
  }

  return cleaned.replace(/[^a-z0-9.-]/g, "").replace(/^\.+|\.+$/g, "") || fallback;
};

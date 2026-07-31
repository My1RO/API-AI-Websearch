import {
  ProviderCitation,
  ProviderLocation,
  ProviderProfile,
  ProviderProfileRequestItem,
  ProviderRating,
  SourcedValue
} from "../types/provider-profile";
import { providerProfilesSchema } from "../validators/provider-profile.validator";
import { cleanPublicText, cleanSafeStoredFact, safePublicUrl } from "./sanitizer.service";

export interface ProviderProfileSanitizerOptions {
  allowedSourceUrls?: Iterable<string>;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
};

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : value ? [value] : [];

const coerceString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
};

const normalizeCitationInput = (value: unknown): Record<string, unknown> => {
  const citation = asRecord(value) || {};
  return {
    sourceUrl: coerceString(citation.sourceUrl),
    sourceTitle: coerceString(citation.sourceTitle) || null
  };
};

const normalizeSourcedValueInput = (value: unknown): Record<string, unknown> => {
  const fact = asRecord(value) || {};
  return {
    value: coerceString(fact.value),
    citation: normalizeCitationInput(fact.citation)
  };
};

const normalizeLocationInput = (value: unknown): Record<string, unknown> => {
  const location = asRecord(value) || {};
  return {
    addressLine1: coerceString(location.addressLine1),
    addressLine2: coerceString(location.addressLine2) || null,
    city: coerceString(location.city) || null,
    state: coerceString(location.state) || null,
    zip: coerceString(location.zip) || null,
    citation: normalizeCitationInput(location.citation)
  };
};

const normalizeRatingInput = (value: unknown): Record<string, unknown> => {
  const rating = asRecord(value) || {};
  return {
    value: coerceString(rating.value),
    scale: coerceString(rating.scale) || null,
    citation: normalizeCitationInput(rating.citation)
  };
};

const normalizeProfileInput = (value: unknown): Record<string, unknown> => {
  const profile = asRecord(value) || {};
  return {
    providerId: coerceString(profile.providerId),
    npi: coerceString(profile.npi),
    providerName: coerceString(profile.providerName) || "Provider",
    specialties: asArray(profile.specialties).map(normalizeSourcedValueInput),
    locations: asArray(profile.locations).map(normalizeLocationInput),
    phoneNumbers: asArray(profile.phoneNumbers).map(normalizeSourcedValueInput),
    ratings: asArray(profile.ratings).map(normalizeRatingInput),
    websites: asArray(profile.websites).map(normalizeSourcedValueInput),
    confidenceNotes: []
  };
};

const faxPattern = /\b(fax|facsimile)\b/i;
const personalPhoneLabelPattern = /\b(mobile|cell(?:ular| phone)?|personal|home)\b/i;
const residentialAddressPattern = /\b(residential|residence|home address)\b/i;
const selfDeclaredProhibitedSourcePattern = /\b(people[ -]?finder|people[ -]?search|personal record|residential record|home address|mobile number|cell phone|social media)\b/i;
const generationArtifactPattern = /\b(this schema|response format|does not permit null|use null|likely validation|let'?s produce)\b/i;
const placeholderAddressPattern = /^(?:\/?null|none|n\/?a|city|state|zip|address(?:line)?\s*\d?)$/i;
const concatenatedFieldLabelPattern = /(?:address\s*line|city.*city|state.*state|zip.*zip)/i;

const allowedUrlSet = (urls: Iterable<string> | undefined): Set<string> | undefined => {
  return urls === undefined
    ? undefined
    : new Set([...urls].map((url) => safePublicUrl(url)).filter((url): url is string => Boolean(url)));
};

const citationHasAllowedProvenance = (
  sourceUrl: string,
  allowedUrls: Set<string> | undefined
): boolean => allowedUrls === undefined || allowedUrls.has(sourceUrl);

const sanitizeCitation = (
  citation: ProviderCitation,
  allowedUrls: Set<string> | undefined
): ProviderCitation | undefined => {
  const sourceUrl = safePublicUrl(citation.sourceUrl);
  if (!sourceUrl || !citationHasAllowedProvenance(sourceUrl, allowedUrls)) {
    return undefined;
  }
  const domain = new URL(sourceUrl).hostname.replace(/^www\./i, "");
  if (citation.sourceTitle && selfDeclaredProhibitedSourcePattern.test(citation.sourceTitle)) {
    return undefined;
  }
  return {
    sourceUrl,
    sourceTitle: cleanSafeStoredFact(citation.sourceTitle || domain, 255) || domain
  };
};

const sanitizeSourcedValue = (
  value: SourcedValue,
  allowedUrls: Set<string> | undefined
): SourcedValue | undefined => {
  const safeValue = cleanSafeStoredFact(value.value);
  const citation = sanitizeCitation(value.citation, allowedUrls);
  return safeValue && citation ? { value: safeValue, citation } : undefined;
};

const sanitizePhoneNumber = (
  value: SourcedValue,
  allowedUrls: Set<string> | undefined
): SourcedValue | undefined => {
  const sanitized = sanitizeSourcedValue(value, allowedUrls);
  if (!sanitized || faxPattern.test(sanitized.value) || personalPhoneLabelPattern.test(sanitized.value)) {
    return undefined;
  }
  const digitCount = sanitized.value.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15 ? sanitized : undefined;
};

const sanitizeWebsite = (
  value: SourcedValue,
  allowedUrls: Set<string> | undefined
): SourcedValue | undefined => {
  const citation = sanitizeCitation(value.citation, allowedUrls);
  if (!citation) {
    return undefined;
  }
  const website = safePublicUrl(value.value);
  return website && website === citation.sourceUrl ? { value: website, citation } : undefined;
};

const optionalAddressPart = (value: string | null | undefined, maximum: number): string | null => {
  const cleaned = cleanSafeStoredFact(value || "", maximum);
  return !cleaned
    || placeholderAddressPattern.test(cleaned)
    || generationArtifactPattern.test(cleaned)
    || concatenatedFieldLabelPattern.test(cleaned)
    ? null
    : cleaned;
};

const sanitizeLocation = (
  location: ProviderLocation,
  allowedUrls: Set<string> | undefined
): ProviderLocation | undefined => {
  const addressLine1 = cleanSafeStoredFact(location.addressLine1, 255);
  const rawAddress = [location.addressLine1, location.addressLine2, location.city, location.state, location.zip]
    .filter(Boolean).join(" ");
  const requiredAddress = [location.addressLine1, location.city, location.state, location.zip]
    .filter(Boolean).join(" ");
  const citation = sanitizeCitation(location.citation, allowedUrls);
  if (!addressLine1 || !citation || generationArtifactPattern.test(requiredAddress) || residentialAddressPattern.test(rawAddress)) {
    return undefined;
  }
  return {
    addressLine1,
    addressLine2: optionalAddressPart(location.addressLine2, 255),
    city: optionalAddressPart(location.city, 120),
    state: cleanPublicText(location.state || "", 2) || null,
    zip: cleanPublicText(location.zip || "", 10) || null,
    citation
  };
};

const sanitizeRating = (
  rating: ProviderRating,
  allowedUrls: Set<string> | undefined
): ProviderRating | undefined => {
  const value = cleanSafeStoredFact(rating.value, 80);
  const citation = sanitizeCitation(rating.citation, allowedUrls);
  if (!value || !citation) {
    return undefined;
  }
  return {
    value,
    scale: cleanSafeStoredFact(rating.scale || "", 80) || null,
    citation
  };
};

const normalizedFactKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const dedupePreservingOrder = <T>(values: T[], valueKey: (value: T) => string): T[] => {
  const unique = new Map<string, T>();
  values.forEach((value) => {
    const key = valueKey(value);
    if (!unique.has(key)) {
      unique.set(key, value);
    }
  });
  return [...unique.values()];
};

const normalizeIdentity = (value: string | null | undefined): string => (value || "").trim().toLowerCase();

const dedupeProfilePreservingModelOrder = (profile: ProviderProfile): ProviderProfile => {
  return {
    ...profile,
    phoneNumbers: dedupePreservingOrder(
      profile.phoneNumbers,
      (phone) => normalizedFactKey(phone.value)
    ),
    locations: dedupePreservingOrder(
      profile.locations,
      (location) => normalizedFactKey([
        location.addressLine1, location.addressLine2, location.city, location.state, location.zip
      ].filter(Boolean).join(" "))
    ),
    ratings: dedupePreservingOrder(
      profile.ratings,
      (rating) => `${rating.citation.sourceUrl}:${normalizedFactKey(rating.value)}`
    ),
    websites: dedupePreservingOrder(
      profile.websites,
      (website) => website.value.toLowerCase()
    )
  };
};

const hasDisplayableContactFacts = (profile: ProviderProfile): boolean => {
  return profile.phoneNumbers.length > 0
    || profile.locations.length > 0
    || profile.ratings.length > 0
    || profile.websites.length > 0;
};

const npiPattern = /^\d{10}$/;

const getRequestedProviderNpi = (provider: ProviderProfileRequestItem): string | undefined => {
  return provider.npi
    || (provider.providerId && npiPattern.test(provider.providerId) ? provider.providerId : undefined);
};

const normalizeNameIdentity = (value: string | undefined): string => {
  return normalizeIdentity(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
};

const profileMatchesRequestedProvider = (
  profile: ProviderProfile,
  provider: ProviderProfileRequestItem
): boolean => {
  const profileProviderId = normalizeIdentity(profile.providerId);
  const requestedProviderId = normalizeIdentity(provider.providerId);
  const profileNpi = normalizeIdentity(profile.npi);
  const requestedNpi = normalizeIdentity(getRequestedProviderNpi(provider));
  if (profileNpi && requestedNpi && profileNpi !== requestedNpi) {
    return false;
  }
  if (profileProviderId && requestedProviderId && profileProviderId === requestedProviderId) {
    return true;
  }
  if (profileNpi && requestedNpi && profileNpi === requestedNpi) {
    return true;
  }
  const profileName = normalizeNameIdentity(profile.providerName);
  const requestedName = normalizeNameIdentity(provider.name);
  return Boolean(profileName && requestedName && profileName === requestedName);
};

const bindProfileToRequestedProvider = (
  profile: ProviderProfile,
  provider: ProviderProfileRequestItem
): ProviderProfile => ({
  ...profile,
  providerId: provider.providerId || profile.providerId,
  npi: getRequestedProviderNpi(provider) || profile.npi,
  providerName: normalizeNameIdentity(profile.providerName) === "provider"
    ? provider.name || profile.providerName
    : profile.providerName || provider.name
});

export const sanitizeProviderProfiles = (
  value: unknown,
  options: ProviderProfileSanitizerOptions = {}
): ProviderProfile[] => {
  const profiles = providerProfilesSchema.parse(asArray(value).map(normalizeProfileInput));
  const allowedUrls = allowedUrlSet(options.allowedSourceUrls);

  return profiles.map((profile) => {
    const providerName = cleanSafeStoredFact(profile.providerName, 255) || "Provider";
    const providerNpi = cleanPublicText(profile.npi, 10);
    const websiteCandidates = profile.websites
      .map((website) => sanitizeWebsite(website, allowedUrls))
      .filter((website): website is SourcedValue => Boolean(website));

    const locations = profile.locations
      .map((location) => sanitizeLocation(location, allowedUrls))
      .filter((location): location is ProviderLocation => Boolean(location));

    const output: ProviderProfile = {
      providerId: cleanPublicText(profile.providerId, 255),
      npi: providerNpi,
      providerName,
      specialties: profile.specialties
        .map((specialty) => sanitizeSourcedValue(specialty, allowedUrls))
        .filter((specialty): specialty is SourcedValue => Boolean(specialty)),
      locations,
      phoneNumbers: profile.phoneNumbers
        .map((phone) => sanitizePhoneNumber(phone, allowedUrls))
        .filter((phone): phone is SourcedValue => Boolean(phone)),
      ratings: profile.ratings
        .map((rating) => sanitizeRating(rating, allowedUrls))
        .filter((rating): rating is ProviderRating => Boolean(rating)),
      websites: websiteCandidates,
      confidenceNotes: []
    };

    return dedupeProfilePreservingModelOrder(output);
  }).filter(hasDisplayableContactFacts);
};

export const sanitizeProviderProfilesForRequest = (
  value: unknown,
  providers: ProviderProfileRequestItem[]
): ProviderProfile[] => {
  const requested = providers.filter((provider) => provider.name || provider.providerId || provider.npi);
  return sanitizeProviderProfiles(value).flatMap((profile) => {
    const provider = requested.find((candidate) => profileMatchesRequestedProvider(profile, candidate));
    return provider
      ? [dedupeProfilePreservingModelOrder(bindProfileToRequestedProvider(profile, provider))]
      : [];
  });
};

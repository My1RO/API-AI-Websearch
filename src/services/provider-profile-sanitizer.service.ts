import {
  ProviderLocation,
  ProviderProfile,
  ProviderProfileRequestItem,
  ProviderRating,
  ProviderSource,
  SourcedValue
} from "../types/provider-profile";
import { providerProfilesSchema } from "../validators/provider-profile.validator";
import { cleanPublicText, cleanSafeStoredFact, safeDomain, safePublicUrl, safeSourceId } from "./sanitizer.service";

const fallbackSourceId = "public-source";

export interface ProviderProfileSanitizerOptions {
  allowedSourceUrls?: Iterable<string>;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

const asArray = (value: unknown): unknown[] => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const coerceString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return coerceString(record.value)
    || coerceString(record.text)
    || coerceString(record.content)
    || coerceString(record.name)
    || coerceString(record.title)
    || coerceString(record.label);
};

const coerceSourceId = (entry: Record<string, unknown>): string | undefined => {
  const source = asRecord(entry.source);
  return coerceString(entry.sourceId)
    || coerceString(entry.source_id)
    || coerceString(source?.id)
    || coerceString(source?.sourceId);
};

const coerceSourceName = (entry: Record<string, unknown>): string | undefined => {
  const source = asRecord(entry.source);
  return coerceString(entry.sourceName)
    || coerceString(entry.source_name)
    || coerceString(source?.title)
    || coerceString(source?.name)
    || coerceString(source?.label);
};

const normalizeSourcedValueInput = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) {
    return {
      value: coerceString(value)
    };
  }

  return {
    ...record,
    value: coerceString(record.value)
      || coerceString(record.phone)
      || coerceString(record.number)
      || coerceString(record.phoneNumber)
      || coerceString(record.url)
      || coerceString(record.href)
      || coerceString(record.website)
      || coerceString(record.name)
      || coerceString(record.text),
    sourceId: coerceSourceId(record) || fallbackSourceId,
    sourceName: coerceSourceName(record)
  };
};

const normalizeLocationInput = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) {
    return {
      addressLine1: coerceString(value)
    };
  }

  const addressLine1Record = asRecord(record.addressLine1)
    || asRecord(record.street1)
    || asRecord(record.streetLine1)
    || asRecord(record.street_line_1);

  return {
    ...record,
    addressLine1: coerceString(record.addressLine1)
      || coerceString(record.street1)
      || coerceString(record.streetLine1)
      || coerceString(record.street_line_1)
      || coerceString(record.address),
    addressLine2: coerceString(record.addressLine2)
      || coerceString(record.street2)
      || coerceString(record.streetLine2)
      || coerceString(record.street_line_2)
      || null,
    city: coerceString(record.city) || null,
    state: coerceString(record.state) || null,
    zip: coerceString(record.zip) || coerceString(record.zipCode) || coerceString(record.zip_code) || null,
    sourceId: coerceSourceId(record) || (addressLine1Record ? coerceSourceId(addressLine1Record) : undefined) || fallbackSourceId,
    sourceName: coerceSourceName(record) || (addressLine1Record ? coerceSourceName(addressLine1Record) : undefined)
  };
};

const normalizeRatingInput = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) {
    return {
      value: coerceString(value)
    };
  }

  return {
    ...record,
    value: coerceString(record.value) || coerceString(record.rating) || coerceString(record.score),
    scale: coerceString(record.scale) || null,
    sourceId: coerceSourceId(record) || fallbackSourceId,
    sourceName: coerceSourceName(record)
  };
};

const normalizeSourceInput = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) {
    return {
      id: coerceString(value),
      title: coerceString(value),
      domain: coerceString(value)
    };
  }

  return {
    ...record,
    id: coerceString(record.id) || coerceString(record.sourceId) || coerceString(record.domain) || coerceString(record.title) || fallbackSourceId,
    title: coerceString(record.title) || coerceString(record.name) || coerceString(record.label) || coerceString(record.domain) || "Public source",
    domain: coerceString(record.domain) || coerceString(record.hostname),
    url: coerceString(record.url) || coerceString(record.href)
  };
};

const hasNormalizedValue = (value: Record<string, unknown>): boolean => Boolean(value.value);
const hasNormalizedAddress = (value: Record<string, unknown>): boolean => Boolean(value.addressLine1);
const hasNormalizedSourceLocation = (value: Record<string, unknown>): boolean => Boolean(value.domain || value.url);

const normalizeProfileInput = (value: unknown): Record<string, unknown> => {
  const profile = asRecord(value) || {};

  return {
    ...profile,
    providerId: coerceString(profile.providerId),
    npi: coerceString(profile.npi),
    providerName: coerceString(profile.providerName) || coerceString(profile.name) || "Provider",
    specialties: asArray(profile.specialties).map(normalizeSourcedValueInput).filter(hasNormalizedValue),
    locations: asArray(profile.locations || profile.addresses).map(normalizeLocationInput).filter(hasNormalizedAddress),
    phoneNumbers: asArray(profile.phoneNumbers || profile.phones || profile.phone_numbers).map(normalizeSourcedValueInput).filter(hasNormalizedValue),
    ratings: asArray(profile.ratings).map(normalizeRatingInput).filter(hasNormalizedValue),
    websites: asArray(profile.websites || profile.links || profile.website).map(normalizeSourcedValueInput).filter(hasNormalizedValue),
    publicInsuranceMentions: asArray(profile.publicInsuranceMentions || profile.insuranceMentions).map(normalizeSourcedValueInput).filter(hasNormalizedValue),
    confidenceNotes: Array.isArray(profile.confidenceNotes) ? profile.confidenceNotes.map(coerceString).filter(Boolean) : [],
    sources: asArray(profile.sources).map(normalizeSourceInput).filter(hasNormalizedSourceLocation)
  };
};

const makeFallbackSource = (sourceId = fallbackSourceId, sourceName?: string): ProviderSource => ({
  id: safeSourceId(sourceId, fallbackSourceId),
  title: cleanSafeStoredFact(sourceName || "Public source", 255) || "Public source",
  domain: "public-source"
});

const hasDisplayableSource = (source: ProviderSource | undefined): source is ProviderSource => {
  return Boolean(source?.domain && source.domain !== "public-source");
};

const sanitizeSources = (
  sources: ProviderSource[],
  options: ProviderProfileSanitizerOptions = {},
  providerNpi?: string
): { sources: ProviderSource[]; sourceIdMap: Map<string, string> } => {
  const sanitizedSources = new Map<string, ProviderSource>();
  const sourceIdMap = new Map<string, string>();
  const allowedSourceUrls = options.allowedSourceUrls === undefined
    ? undefined
    : new Set([...options.allowedSourceUrls]
      .map((url) => safePublicUrl(url))
      .filter((url): url is string => Boolean(url)));

  const nppesNpiFromUrl = (value: string): string | undefined => {
    try {
      const url = new URL(value);
      if (url.hostname !== "npiregistry.cms.hhs.gov") {
        return undefined;
      }
      const providerView = url.pathname.match(/^\/provider-view\/(\d{10})\/?$/);
      return providerView?.[1]
        || (url.pathname === "/api/" && /^\d{10}$/.test(url.searchParams.get("number") || "")
          ? url.searchParams.get("number") || undefined
          : undefined);
    } catch {
      return undefined;
    }
  };

  const hasAllowedProvenance = (url: string | undefined): boolean => {
    if (allowedSourceUrls === undefined) {
      return true;
    }
    if (!url) {
      return false;
    }
    if (allowedSourceUrls.has(url)) {
      return true;
    }
    const sourceNpi = nppesNpiFromUrl(url);
    return Boolean(
      providerNpi
      && sourceNpi === providerNpi
      && [...allowedSourceUrls].some((allowedUrl) => nppesNpiFromUrl(allowedUrl) === providerNpi)
    );
  };

  sources.forEach((source, index) => {
    const id = safeSourceId(source.id, `source-${index + 1}`);
    const title = cleanSafeStoredFact(source.title, 255);
    const domain = safeDomain(source.domain, source.url);

    const url = safePublicUrl(source.url, domain);
    if (
      !title
      || domain === fallbackSourceId
      || !hasAllowedProvenance(url)
    ) {
      return;
    }

    sourceIdMap.set(source.id, id);
    sanitizedSources.set(id, {
      id,
      title,
      domain,
      url
    });
  });

  if (sanitizedSources.size === 0) {
    return {
      sources: [],
      sourceIdMap
    };
  }

  return {
    sources: [...sanitizedSources.values()],
    sourceIdMap
  };
};

const sourceIndex = (sources: ProviderSource[]): Map<string, ProviderSource> => {
  return new Map(sources.map((source) => [source.id, source]));
};

const governmentContactDomains = [
  "healthcare.gov",
  "cms.gov",
  "medicare.gov",
  "nppes.cms.hhs.gov",
  "npiregistry.cms.hhs.gov"
];
const professionalDirectoryDomains = ["npiprofile.com", "zocdoc.com", "healthgrades.com", "webmd.com", "vitals.com", "doximity.com"];
const ratingDomains = ["zocdoc.com", "healthgrades.com", "webmd.com", "vitals.com"];
const blockedContactDomains = [
  "whitepages.com", "spokeo.com", "beenverified.com", "truthfinder.com", "radaris.com",
  "fastpeoplesearch.com", "truepeoplesearch.com", "numlookup.com", "411.com",
  "findwhocallsyou.com", "robokiller.com",
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com"
];
const personalContactSourcePattern = /\b(people\s*finder|personal|residential|home address|mobile number|cell phone|social media)\b/i;
const professionalContactSourcePattern = /\b(provider|physician|pediatrics|contact|hospital|health system|medical center|clinic|practice|official)\b/i;
const faxPattern = /\b(fax|facsimile)\b/i;
const personalPhoneLabelPattern = /\b(mobile|cell(?:ular| phone)?|personal|home)\b/i;
const residentialAddressPattern = /\b(residential|residence|home address)\b/i;
const generationArtifactPattern = /\b(this schema|response format|does not permit null|use null|likely validation|let'?s produce)\b/i;
const placeholderAddressPattern = /^(?:\/?null|none|n\/?a|city|state|zip|address(?:line)?\s*\d?)$/i;
const concatenatedFieldLabelPattern = /(?:address\s*line|city.*city|state.*state|zip.*zip)/i;

const domainMatches = (domain: string, approvedDomains: string[]): boolean => approvedDomains.some((approved) => (
  domain === approved || domain.endsWith(`.${approved}`)
));

const providerNameTokens = (providerName: string): string[] => {
  const ignored = new Set([
    "the", "and", "for", "doctor", "dr", "md", "do", "phd", "ms", "msw", "pa", "aprn", "fnp",
    "provider", "medical", "health", "clinic", "center", "inc", "llc", "services", "care"
  ]);
  return providerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !ignored.has(token));
};

const sourceDirectlyAttributedToProvider = (
  source: ProviderSource,
  providerName: string,
  providerNpi?: string | null
): boolean => {
  const sourceText = `${source.title} ${source.url || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (providerNpi && /^\d{10}$/.test(providerNpi) && sourceText.includes(providerNpi)) {
    return true;
  }

  const tokens = providerNameTokens(providerName);
  const requiredMatches = tokens.length === 1 ? 1 : 2;
  return tokens.length > 0
    && tokens.filter((token) => sourceText.includes(token)).length >= requiredMatches;
};

const sourceLooksOfficialForProvider = (source: ProviderSource, providerName: string): boolean => {
  if (
    !source.url
    || domainMatches(source.domain, blockedContactDomains)
    || domainMatches(source.domain, governmentContactDomains)
    || domainMatches(source.domain, professionalDirectoryDomains)
  ) {
    return false;
  }
  return sourceDirectlyAttributedToProvider(source, providerName);
};

const contactSourceRank = (source: ProviderSource | undefined, providerName: string): number => {
  if (!source) {
    return 99;
  }

  if (domainMatches(source.domain, blockedContactDomains) || personalContactSourcePattern.test(source.title)) {
    return 99;
  }

  if (sourceLooksOfficialForProvider(source, providerName)) {
    return 0;
  }

  if (domainMatches(source.domain, governmentContactDomains)) {
    return 1;
  }

  if (domainMatches(source.domain, professionalDirectoryDomains)) {
    return 2;
  }

  // API provenance plus the prompt establishes that the page was consulted for
  // public professional information. Keep deterministic rejection for known
  // unsafe source classes, but do not treat a closed title vocabulary as the
  // definition of an official provider or facility source.
  return 3;
};

const resolveSourceId = (
  originalSourceId: string,
  sourceName: string | undefined,
  sources: Map<string, ProviderSource>,
  sourceIdMap: Map<string, string>
): string => {
  const mappedSourceId = sourceIdMap.get(originalSourceId) || safeSourceId(originalSourceId, fallbackSourceId);
  if (!sources.has(mappedSourceId)) {
    sources.set(mappedSourceId, makeFallbackSource(mappedSourceId, sourceName));
  }

  return mappedSourceId;
};

const sanitizeSourcedValue = (
  value: SourcedValue,
  sources: Map<string, ProviderSource>,
  sourceIdMap: Map<string, string>
): SourcedValue | undefined => {
  const safeValue = cleanSafeStoredFact(value.value);
  if (!safeValue) {
    return undefined;
  }

  const sourceId = resolveSourceId(value.sourceId, value.sourceName, sources, sourceIdMap);
  const source = sources.get(sourceId);
  if (!hasDisplayableSource(source)) {
    return undefined;
  }

  return {
    value: safeValue,
    sourceId,
    sourceName: source.title
  };
};

const sanitizePhoneNumber = (
  value: SourcedValue,
  sources: Map<string, ProviderSource>,
  sourceIdMap: Map<string, string>
): SourcedValue | undefined => {
  const sanitized = sanitizeSourcedValue(value, sources, sourceIdMap);
  if (!sanitized || faxPattern.test(sanitized.value) || personalPhoneLabelPattern.test(sanitized.value)) {
    return undefined;
  }

  const digitCount = sanitized.value.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15 ? sanitized : undefined;
};

const sanitizeWebsite = (
  value: SourcedValue,
  sources: Map<string, ProviderSource>,
  sourceIdMap: Map<string, string>,
  providerName: string
): SourcedValue | undefined => {
  const sourceId = resolveSourceId(value.sourceId, value.sourceName, sources, sourceIdMap);
  const source = sources.get(sourceId);
  if (
    !source
    || !hasDisplayableSource(source)
    || !source.url
    || contactSourceRank(source, providerName) === 99
    || domainMatches(source.domain, governmentContactDomains)
    || domainMatches(source.domain, professionalDirectoryDomains)
  ) {
    return undefined;
  }

  const website = safePublicUrl(value.value, source.domain);
  if (!website || website !== source.url) {
    return undefined;
  }

  return {
    value: website,
    sourceId,
    sourceName: source.title
  };
};

const sanitizeLocation = (
  location: ProviderLocation,
  sources: Map<string, ProviderSource>,
  sourceIdMap: Map<string, string>
): ProviderLocation | undefined => {
  const addressLine1 = cleanSafeStoredFact(location.addressLine1, 255);
  const rawAddressText = [
    location.addressLine1,
    location.addressLine2,
    location.city,
    location.state,
    location.zip
  ].filter(Boolean).join(" ");
  const requiredAddressText = [
    location.addressLine1,
    location.city,
    location.state,
    location.zip
  ].filter(Boolean).join(" ");
  if (!addressLine1 || generationArtifactPattern.test(requiredAddressText) || residentialAddressPattern.test(rawAddressText)) {
    return undefined;
  }

  const sourceId = resolveSourceId(location.sourceId, location.sourceName, sources, sourceIdMap);
  const source = sources.get(sourceId);
  if (!hasDisplayableSource(source)) {
    return undefined;
  }

  const optionalAddressPart = (value: string | null | undefined, maximum: number): string | null => {
    const cleaned = cleanSafeStoredFact(value || "", maximum);
    return !cleaned
      || placeholderAddressPattern.test(cleaned)
      || generationArtifactPattern.test(cleaned)
      || concatenatedFieldLabelPattern.test(cleaned)
      ? null
      : cleaned;
  };

  return {
    addressLine1,
    addressLine2: optionalAddressPart(location.addressLine2, 255),
    city: optionalAddressPart(location.city, 120),
    state: cleanPublicText(location.state || "", 2) || null,
    zip: cleanPublicText(location.zip || "", 10) || null,
    sourceId,
    sourceName: source.title
  };
};

const sanitizeRating = (
  rating: ProviderRating,
  sources: Map<string, ProviderSource>,
  sourceIdMap: Map<string, string>
): ProviderRating | undefined => {
  const value = cleanSafeStoredFact(rating.value, 80);
  if (!value) {
    return undefined;
  }

  const sourceId = resolveSourceId(rating.sourceId, rating.sourceName, sources, sourceIdMap);
  const source = sources.get(sourceId);
  if (!hasDisplayableSource(source)) {
    return undefined;
  }

  if (contactSourceRank(source, "") === 99 || !domainMatches(source.domain, ratingDomains)) {
    return undefined;
  }

  return {
    value,
    scale: cleanSafeStoredFact(rating.scale || "", 80) || null,
    sourceId,
    sourceName: source?.title
  };
};

const normalizedFactKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const sourceHasAddressAnchor = (
  source: ProviderSource,
  locations: ProviderLocation[]
): boolean => {
  const sourceText = `${source.title} ${source.url || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return locations.some((location) => {
    const tokens = location.addressLine1
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2);
    const requiredMatches = Math.min(4, tokens.length);
    return tokens.length >= 3
      && tokens.filter((token) => sourceText.includes(token)).length >= requiredMatches;
  });
};

const dedupeAndSort = <T>(
  values: T[],
  valueKey: (value: T) => string,
  rank: (value: T) => number
): T[] => {
  const unique = new Map<string, T>();
  values.forEach((value) => {
    const key = valueKey(value);
    const existing = unique.get(key);
    if (!existing || rank(value) < rank(existing)) {
      unique.set(key, value);
    }
  });

  return [...unique.values()].sort((left, right) => {
    const rankDifference = rank(left) - rank(right);
    return rankDifference || valueKey(left).localeCompare(valueKey(right));
  });
};

const locationHintRank = (location: ProviderLocation, provider: ProviderProfileRequestItem): number => {
  let rank = 0;
  if (provider.zip && location.zip !== provider.zip) {
    rank += 4;
  }
  if (provider.city && normalizeIdentity(location.city) !== normalizeIdentity(provider.city)) {
    rank += 2;
  }
  if (provider.state && normalizeIdentity(location.state) !== normalizeIdentity(provider.state)) {
    rank += 1;
  }
  return rank;
};

const prioritizeProfileForRequest = (
  profile: ProviderProfile,
  provider: ProviderProfileRequestItem
): ProviderProfile => {
  const sources = sourceIndex(profile.sources);
  const providerName = provider.name || profile.providerName;
  return {
    ...profile,
    phoneNumbers: dedupeAndSort(
      profile.phoneNumbers,
      (phone) => normalizedFactKey(phone.value),
      (phone) => contactSourceRank(sources.get(phone.sourceId), providerName)
    ),
    locations: dedupeAndSort(
      profile.locations,
      (location) => normalizedFactKey([
        location.addressLine1,
        location.addressLine2,
        location.city,
        location.state,
        location.zip
      ].filter(Boolean).join(" ")),
      (location) => locationHintRank(location, provider) * 10
        + contactSourceRank(sources.get(location.sourceId), providerName)
    ),
    ratings: dedupeAndSort(
      profile.ratings,
      (rating) => `${rating.sourceId}:${normalizedFactKey(rating.value)}`,
      () => 0
    ),
    websites: dedupeAndSort(
      profile.websites,
      (website) => website.value.toLowerCase(),
      (website) => contactSourceRank(sources.get(website.sourceId), providerName)
    ),
    sources: [...profile.sources].sort((left, right) => (
      contactSourceRank(left, providerName) - contactSourceRank(right, providerName)
      || left.domain.localeCompare(right.domain)
    ))
  };
};

const sourceIdsForProfile = (profile: ProviderProfile): Set<string> => {
  return new Set(
    [
      ...profile.specialties,
      ...profile.locations,
      ...profile.phoneNumbers,
      ...profile.ratings,
      ...profile.websites,
      ...profile.publicInsuranceMentions
    ]
      .map((fact) => fact.sourceId)
      .filter(Boolean)
  );
};

const hasDisplayableContactFacts = (profile: ProviderProfile): boolean => {
  return profile.phoneNumbers.length > 0
    || profile.locations.length > 0
    || profile.ratings.length > 0
    || profile.websites.length > 0;
};

const normalizeIdentity = (value: string | null | undefined): string => {
  return (value || "").trim().toLowerCase();
};

const npiPattern = /^\d{10}$/;

const getRequestedProviderNpi = (provider: ProviderProfileRequestItem): string | undefined => {
  if (provider.npi) {
    return provider.npi;
  }

  return provider.providerId && npiPattern.test(provider.providerId) ? provider.providerId : undefined;
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

  return profiles.map((profile) => {
    const profileNpi = cleanPublicText(profile.npi, 10);
    const sanitized = sanitizeSources(profile.sources, options, profileNpi);
    const sources = sourceIndex(sanitized.sources);

    const providerName = cleanSafeStoredFact(profile.providerName, 255) || "Provider";
    const providerNpi = profileNpi;

    const sourceIsDirectlyAttributed = (source: ProviderSource | undefined): source is ProviderSource => Boolean(
      source
      && contactSourceRank(source, providerName) < 99
      && sourceDirectlyAttributedToProvider(source, providerName, providerNpi)
    );

    const officialWebsiteDomains = new Set(profile.websites.flatMap((website) => {
      const sourceId = sanitized.sourceIdMap.get(website.sourceId) || safeSourceId(website.sourceId, fallbackSourceId);
      const source = sources.get(sourceId);
      const websiteUrl = safePublicUrl(website.value, source?.domain);
      return source
        && sourceIsDirectlyAttributed(source)
        && websiteUrl
        && websiteUrl === source.url
        && !domainMatches(source.domain, governmentContactDomains)
        && !domainMatches(source.domain, professionalDirectoryDomains)
        ? [source.domain]
        : [];
    }));

    const sourceHasOfficialDomainAnchor = (source: ProviderSource | undefined): source is ProviderSource => Boolean(
      source
      && officialWebsiteDomains.has(source.domain)
      && professionalContactSourcePattern.test(source.title)
    );

    const locations = profile.locations
      .map((location) => sanitizeLocation(location, sources, sanitized.sourceIdMap))
      .filter((location): location is ProviderLocation => Boolean(location))
      .filter((location) => {
        const source = sources.get(location.sourceId);
        return sourceIsDirectlyAttributed(source) || sourceHasOfficialDomainAnchor(source);
      });

    const sourceHasAcceptedAddressAnchor = (source: ProviderSource | undefined): source is ProviderSource => Boolean(
      source
      && contactSourceRank(source, providerName) < 99
      && sourceHasAddressAnchor(source, locations)
    );

    const output: ProviderProfile = {
      providerId: cleanPublicText(profile.providerId, 255),
      npi: providerNpi,
      providerName,
      specialties: profile.specialties
        .map((specialty) => sanitizeSourcedValue(specialty, sources, sanitized.sourceIdMap))
        .filter((specialty): specialty is SourcedValue => Boolean(specialty)),
      locations,
      phoneNumbers: profile.phoneNumbers
        .map((phoneNumber) => sanitizePhoneNumber(phoneNumber, sources, sanitized.sourceIdMap))
        .filter((phoneNumber): phoneNumber is SourcedValue => Boolean(phoneNumber))
        .filter((phoneNumber) => {
          const source = sources.get(phoneNumber.sourceId);
          return sourceIsDirectlyAttributed(source)
            || sourceHasOfficialDomainAnchor(source)
            || sourceHasAcceptedAddressAnchor(source);
        }),
      ratings: profile.ratings
        .map((rating) => sanitizeRating(rating, sources, sanitized.sourceIdMap))
        .filter((rating): rating is ProviderRating => Boolean(rating)),
      websites: profile.websites
        .map((website) => sanitizeWebsite(website, sources, sanitized.sourceIdMap, providerName))
        .filter((website): website is SourcedValue => Boolean(website))
        .filter((website) => {
          const source = sources.get(website.sourceId);
          return sourceIsDirectlyAttributed(source) || sourceHasAcceptedAddressAnchor(source);
        }),
      publicInsuranceMentions: profile.publicInsuranceMentions
        .map((mention) => sanitizeSourcedValue(mention, sources, sanitized.sourceIdMap))
        .filter((mention): mention is SourcedValue => Boolean(mention)),
      confidenceNotes: [],
      sources: []
    };

    const referencedSourceIds = sourceIdsForProfile(output);
    output.sources = [...sources.values()]
      .filter(hasDisplayableSource)
      .filter((source) => referencedSourceIds.has(source.id));

    return prioritizeProfileForRequest(output, { name: providerName });
  }).filter(hasDisplayableContactFacts);
};

export const sanitizeProviderProfilesForRequest = (
  value: unknown,
  providers: ProviderProfileRequestItem[]
): ProviderProfile[] => {
  const requestedProviders = providers.filter((provider) => provider.name || provider.providerId || provider.npi);

  return sanitizeProviderProfiles(value).flatMap((profile) => {
    const requestedProvider = requestedProviders.find((provider) => profileMatchesRequestedProvider(profile, provider));
    if (!requestedProvider) {
      return [];
    }

    return [prioritizeProfileForRequest(bindProfileToRequestedProvider(profile, requestedProvider), requestedProvider)];
  });
};

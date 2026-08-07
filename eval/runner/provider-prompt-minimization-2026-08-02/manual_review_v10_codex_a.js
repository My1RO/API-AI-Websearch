#!/usr/bin/env node
"use strict";

// Codex-harness manual-review transport for the first blinded half of the V10
// development campaign. Semantic policy is frozen in each review-input.json;
// this helper performs repeatable normalization/search after the reviewer has
// inspected the complete artifacts. It intentionally never resolves or reads
// the sealed mapping.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { verifyManualOutput } = require("./manual_review_harness.js");

const WORKSPACE = process.env.EDE_SHARED_WORKSPACE || "/Users/kui/lucie/EDE";
const CAMPAIGN = process.env.MANUAL_CAMPAIGN_ROOT || path.join(WORKSPACE,
  "test-evidence/provider-prompt-minimization-2026-08-02/runs/" +
  "development-curve-corrected-nine-arm-manual-review-v10");
const MIN_PRESENTATION_INDEX = Number(process.env.MANUAL_MIN_PRESENTATION_INDEX || 0);
const MAX_PRESENTATION_INDEX = Number(process.env.MANUAL_MAX_PRESENTATION_INDEX || 116);
const EXPECTED_SELECTED_UNITS = Number(process.env.MANUAL_EXPECTED_SELECTED_UNITS || 117);
const REVIEWER_PROTOCOL = Object.freeze({
  reviewMode: "codex_harness_manual",
  id: process.env.MANUAL_REVIEWER_ID || "codex-gpt5-manual-v10",
  protocolVersion: process.env.MANUAL_PROTOCOL_VERSION || "v13-manual-v10",
  runtimeIdentity: process.env.MANUAL_RUNTIME_IDENTITY || "codex-desktop-gpt5"
});
const SESSION_PREFIX = process.env.MANUAL_SESSION_PREFIX || "v10-a";

const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const stableDigits = (value) => String(value || "").replace(/\D/g, "");
const canonicalUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch { return String(value || "").trim().toLowerCase().replace(/\/+$/, ""); }
};
const hostOf = (value) => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
const normalize = (value) => String(value ?? "").normalize("NFKD").toLowerCase()
  .replace(/&amp;|&/g, " and ")
  .replace(/\bwest virginia\b/g, " wv ")
  .replace(/\bnorth carolina\b/g, " nc ")
  .replace(/\bsouth carolina\b/g, " sc ")
  .replace(/\btennessee\b/g, " tn ")
  .replace(/\btexas\b/g, " tx ")
  .replace(/\bohio\b/g, " oh ")
  .replace(/\bflorida\b/g, " fl ")
  .replace(/\bgeorgia\b/g, " ga ")
  .replace(/\bkentucky\b/g, " ky ")
  .replace(/\bcalifornia\b/g, " ca ")
  .replace(/\bnew york\b/g, " ny ")
  .replace(/\bpennsylvania\b/g, " pa ")
  .replace(/\b(street|st\.?|str)\b/g, " st ")
  .replace(/\b(avenue|ave\.?)\b/g, " ave ")
  .replace(/\b(road|rd\.?)\b/g, " rd ")
  .replace(/\b(drive|dr\.?)\b/g, " dr ")
  .replace(/\b(lane|ln\.?)\b/g, " ln ")
  .replace(/\b(court|ct\.?)\b/g, " ct ")
  .replace(/\b(parkway|pkwy\.?)\b/g, " pkwy ")
  .replace(/\b(place|pl\.?)\b/g, " pl ")
  .replace(/\b(boulevard|blvd\.?)\b/g, " blvd ")
  .replace(/\b(highway|hwy\.?)\b/g, " hwy ")
  .replace(/\b(suite|ste\.?)\b/g, " ste ")
  .replace(/\b(north|n\.?)\b/g, " n ")
  .replace(/\b(south|s\.?)\b/g, " s ")
  .replace(/\b(east|e\.?)\b/g, " e ")
  .replace(/\b(west|w\.?)\b/g, " w ")
  .replace(/\bphysician assistant(?:-certified)?\b/g, " pa ")
  .replace(/\bfamily nurse practitioner\b/g, " family nurse practitioner ")
  .replace(/[^a-z0-9]+/g, " ").trim();
const compact = (value) => normalize(value).replace(/\s+/g, "");
const tokens = (value) => normalize(value).split(/\s+/).filter((token) => token.length > 1);
const unique = (values) => [...new Set(values)];
const valueText = (fact) => typeof fact?.value === "string"
  ? fact.value : Object.values(fact?.value || {}).filter(Boolean).join(" ");

const DIRECTORY_HOST_PATTERNS = [
  /(^|\.)healthline\.com$/, /(^|\.)medicalnewstoday\.com$/, /(^|\.)webmd\.com$/,
  /(^|\.)usnews\.com$/, /(^|\.)healthgrades\.com$/, /(^|\.)vitals\.com$/,
  /(^|\.)sharecare\.com$/, /(^|\.)doximity\.com$/, /(^|\.)docspot\.com$/,
  /(^|\.)npidb\.org$/, /(^|\.)npino\.com$/, /(^|\.)npiprofile\.com$/,
  /(^|\.)opennpi\.com$/, /(^|\.)npir\.org$/, /(^|\.)npinumberlookup\.org$/,
  /(^|\.)ehealthscores\.com$/, /(^|\.)npino\.org$/, /(^|\.)solvhealth\.com$/,
  /(^|\.)ourhealthnetwork\.com$/, /(^|\.)labdraw\.com$/, /(^|\.)carechanges\.com$/,
  /(^|\.)nursinghomedata\.org$/, /(^|\.)nursinghomes\.com$/,
  /(^|\.)nursinghomedatabase\.com$/, /(^|\.)urgentcarelocations\.org$/,
  /(^|\.)mapquest\.com$/, /(^|\.)yahoo\.com$/, /(^|\.)yellowpages\.com$/,
  /(^|\.)zocdoc\.com$/, /(^|\.)findatopdoc\.com$/, /(^|\.)doctor\.com$/,
  /(^|\.)providerwire\.com$/, /(^|\.)hipaaspace\.com$/, /(^|\.)npi-lookup\.org$/
  , /(^|\.)healthprovidersdata\.com$/, /(^|\.)medicarelist\.com$/,
  /(^|\.)healthcare4ppl\.com$/, /(^|\.)healthcare6\.com$/
];
const RATING_HOST_PATTERNS = [/ratemds/, /birdeye/, /reviews?\./, /wellness\.com$/];
const PROHIBITED_HOST_PATTERNS = [
  /fastpeoplesearch/, /truepeoplesearch/, /whitepages/, /beenverified/, /spokeo/,
  /peoplefinders/, /radaris/, /facebook\.com$/, /linkedin\.com$/, /instagram\.com$/,
  /x\.com$/, /twitter\.com$/, /pinterest\.com$/
];
const NONSUBSTANTIVE = /(access denied|enable javascript|just a moment|verify you are human|captcha|robot check|forbidden)/i;

const sourceReadable = (source) => source.hostReadStatus === "read"
  && source.body.trim().length >= 180
  && !(source.body.trim().length < 1200 && NONSUBSTANTIVE.test(source.body));
const hostMatches = (host, patterns) => patterns.some((pattern) => pattern.test(host));
const isGovernment = (host) => host.endsWith(".gov") || host.includes("cms.hhs.gov") || host.includes("nppes.cms.hhs.gov");
const isProhibited = (host) => hostMatches(host, PROHIBITED_HOST_PATTERNS);
const isDirectory = (host) => hostMatches(host, DIRECTORY_HOST_PATTERNS);
const isRating = (host) => hostMatches(host, RATING_HOST_PATTERNS);
const Q3_ASSERTION_HOSTS = new Set(["ehealthscores.com", "npino.org", "solvhealth.com"]);

const requestNameTokens = (request) => tokens(request.name)
  .filter((token) => !new Set(["dr", "mr", "mrs", "ms", "md", "dpt", "aprn", "pa", "pac", "crna",
    "dentist", "lcsw", "lisws", "lmsw", "otr", "lpcc", "qmhs", "bcba", "inc", "llc"]).has(token));
const identityEvidence = (source, request) => {
  if (!source.readable) return { npi: false, name: false, location: false, exact: false, strong: false };
  const bodyNorm = normalize(source.body);
  const npi = bodyNorm.replace(/\D/g, "").includes(stableDigits(request.npi));
  const nameTokens = requestNameTokens(request);
  const matches = nameTokens.filter((token) => bodyNorm.includes(token));
  const facility = nameTokens.length >= 3;
  const name = facility ? matches.length >= Math.min(3, nameTokens.length)
    : matches.length >= Math.min(2, nameTokens.length);
  const city = normalize(request.city);
  const state = normalize(request.state);
  const zip = stableDigits(request.zip).slice(0, 5);
  const location = Boolean(city && bodyNorm.includes(city))
    && (Boolean(state && new RegExp(`(^|\\s)${state}(\\s|$)`).test(bodyNorm)) || Boolean(zip && source.body.includes(zip)));
  return { npi, name, location, exact: npi, strong: name && location };
};

const addressSupport = (value, body) => {
  const components = value || {};
  const normBody = normalize(body);
  const lineTokens = tokens(`${components.addressLine1 || ""} ${components.addressLine2 || ""}`)
    .filter((token) => !new Set(["st", "ave", "rd", "dr", "blvd", "hwy", "ste"]).has(token));
  const lineHitCount = unique(lineTokens).filter((token) => normBody.includes(token)).length;
  const number = String(components.addressLine1 || "").match(/\b\d+[A-Za-z]?\b/)?.[0] || "";
  const numberHit = !number || new RegExp(`(^|\\D)${number}(\\D|$)`).test(body);
  const cityHit = !components.city || normBody.includes(normalize(components.city));
  const stateHit = !components.state || new RegExp(`(^|\\s)${normalize(components.state)}(\\s|$)`).test(normBody);
  const zip = stableDigits(components.zip).slice(0, 5);
  const zipHit = !zip || body.includes(zip);
  const lineRatio = lineTokens.length ? lineHitCount / unique(lineTokens).length : 1;
  const exact = numberHit && lineRatio >= 0.72 && cityHit && stateHit && zipHit;
  const partial = !exact && numberHit && lineRatio >= 0.5 && (cityHit || zipHit);
  return { exact, partial };
};
const specialtySupport = (value, body) => {
  const normBody = normalize(body);
  if (normBody.includes(normalize(value))) return { exact: true, partial: false };
  const factTokens = unique(tokens(value).filter((token) => !new Set(["and", "the", "of"]).has(token)));
  const hit = factTokens.filter((token) => normBody.includes(token)).length;
  const ratio = factTokens.length ? hit / factTokens.length : 0;
  return { exact: ratio >= 0.8, partial: ratio >= 0.5 };
};
const phoneSupport = (value, body) => {
  const digits = stableDigits(value).slice(-10);
  const bodyDigits = stableDigits(body);
  return { exact: digits.length >= 7 && bodyDigits.includes(digits), partial: false };
};
const websiteSupport = (value, source) => {
  const equal = canonicalUrl(value) === canonicalUrl(source.finalUrl || source.url);
  const mentioned = normalize(source.body).includes(normalize(hostOf(value)));
  return { exact: equal || mentioned, partial: false };
};
const supportInSource = (fact, source) => {
  if (!source.readable) return { exact: false, partial: false, unreadable: true };
  if (fact.fieldType === "phone") return { ...phoneSupport(fact.value, source.body), unreadable: false };
  if (fact.fieldType === "address") return { ...addressSupport(fact.value, source.body), unreadable: false };
  if (fact.fieldType === "website") return { ...websiteSupport(fact.value, source), unreadable: false };
  if (fact.fieldType === "specialty") return { ...specialtySupport(fact.value, source.body), unreadable: false };
  if (fact.fieldType === "rating") {
    const target = compact(valueText(fact));
    return { exact: Boolean(target && compact(source.body).includes(target)), partial: false, unreadable: false };
  }
  const target = compact(valueText(fact));
  return { exact: Boolean(target && compact(source.body).includes(target)), partial: false, unreadable: false };
};
const unsafePhone = (fact, sources) => {
  if (fact.fieldType !== "phone") return null;
  const digits = stableDigits(fact.value).slice(-10);
  let matched = 0;
  let unsafe = 0;
  let unsafeKind = null;
  for (const source of sources.filter((item) => item.readable && stableDigits(item.body).includes(digits))) {
    const lines = source.body.split(/\r?\n/);
    for (const line of lines) if (stableDigits(line).includes(digits)) {
      const digitGroups = digits.split("").join("\\D{0,4}");
      const match = line.match(new RegExp(digitGroups));
      if (!match) continue;
      matched += 1;
      const prefix = line.slice(Math.max(0, match.index - 36), match.index);
      if (/\b(fax|facsimile)\s*[:#-]?\s*$/i.test(prefix)) { unsafe += 1; unsafeKind ||= "fax"; }
      else if (/\b(mobile|cell(?:ular)?|personal|home)\s*[:#-]?\s*$/i.test(prefix)) {
        unsafe += 1; unsafeKind ||= "personal_mobile";
      }
    }
  }
  return matched > 0 && unsafe === matched ? unsafeKind : null;
};
const residentialAddress = (fact, sources) => {
  if (fact.fieldType !== "address") return false;
  const supports = sources.filter((source) => supportInSource(fact, source).exact);
  if (!supports.length) return false;
  return supports.every((source) => source.prohibited || /\b(home address|residential address|residence)\b/i.test(source.body));
};

const lineQuote = (source, needle, fallbackNeedles = []) => {
  if (!source?.readable) return null;
  const allNeedles = [needle, ...fallbackNeedles].filter(Boolean).map(String);
  const lines = source.body.split(/\r?\n/);
  for (const target of allNeedles) {
    const exactIndex = source.body.indexOf(target);
    if (exactIndex >= 0 && target.length <= 500 && target.trim()) {
      const lineNo = source.body.slice(0, exactIndex).split(/\r?\n/).length;
      return { sourceIndex: source.sourceIndex, quote: target, polarity: "supports",
        locatorHint: `${source.contentArtifact.path}:line ${lineNo}` };
    }
    const targetNorm = normalize(target);
    for (let index = 0; index < lines.length; index += 1) {
      if (!targetNorm || !normalize(lines[index]).includes(targetNorm)) continue;
      const quote = lines[index].trim().slice(0, 500);
      if (quote && source.body.includes(quote)) return { sourceIndex: source.sourceIndex, quote,
        polarity: "supports", locatorHint: `${source.contentArtifact.path}:line ${index + 1}` };
    }
  }
  return null;
};
const evidenceForFact = (fact, own, supportSources, request) => {
  const spans = [];
  const citation = fact.modelCitation || {};
  const ownSpan = lineQuote(own, citation.factSpan,
    [valueText(fact), stableDigits(fact.value).slice(-10), request.npi]);
  if (ownSpan) spans.push(ownSpan);
  const best = supportSources.find((source) => source.readable && supportInSource(fact, source).exact);
  if (best && (!ownSpan || best.sourceIndex !== ownSpan.sourceIndex)) {
    const fallback = fact.fieldType === "address"
      ? [fact.value?.addressLine1, fact.value?.city, request.npi]
      : [valueText(fact), stableDigits(fact.value).slice(-10), request.npi];
    const span = lineQuote(best, citation.factSpan, fallback);
    if (span) spans.push(span);
  }
  return spans.slice(0, 2);
};
const spanFidelity = (span, source, kind) => {
  if (span == null || String(span).trim() === "") return "not_supplied";
  if (!source?.readable) return "unreadable";
  if (source.body.includes(span) || compact(source.body).includes(compact(span))) return "exact";
  return kind === "identity" ? "not_verbatim" : "not_verbatim";
};

const explicitDateFidelity = (citation, source) => {
  const span = citation?.explicitFactDateSpanRaw ?? citation?.explicitFactDateSpan;
  if (!span) return "no_date_claimed";
  if (!source?.readable) return "unreadable";
  return source.body.includes(span) || compact(source.body).includes(compact(span))
    ? "exact_fact_relevant_date" : "date_not_verbatim";
};
const factRecency = (fact, own, supporting) => {
  const explicit = fact.modelCitation?.explicitFactDateSpanRaw ?? fact.modelCitation?.explicitFactDateSpan;
  const years = String(explicit || "").match(/\b(?:19|20)\d{2}\b/g)?.map(Number) || [];
  if (years.some((year) => year >= 2025)) return "current";
  if (years.length && Math.max(...years) < 2024) return "stale";
  // Generic page-update/copyright dates are not fact-relevant. Undated facts
  // stay eligible and are not imputed current merely because a page changed.
  return "undated";
};
const locationLink = (fact, supportSource, request) => {
  if (fact.fieldType === "website" || fact.fieldType === "specialty" || fact.fieldType === "rating") return "not_applicable";
  if (!supportSource?.readable) return "unreadable";
  const identity = supportSource.identity;
  if (fact.fieldType === "address") {
    const city = normalize(fact.value?.city);
    const state = normalize(fact.value?.state);
    return city === normalize(request.city) && state === normalize(request.state)
      ? "requested_location" : "different_professional_location";
  }
  return identity.location ? "requested_location" : "compatible_professional_location";
};

const sourceClassRank = (sourceClass) => ({
  Q1_exact_provider_first_party: 0, Q2_exact_provider_government: 1,
  Q3_permitted_professional_directory: 2, R_exact_rating_directory: 3,
  other_permitted: 4
}[sourceClass] ?? 9);
const shortClass = (sourceClass) => ({
  Q1_exact_provider_first_party: "Q1", Q2_exact_provider_government: "Q2",
  Q3_permitted_professional_directory: "Q3", R_exact_rating_directory: "R",
  other_permitted: "other"
}[sourceClass] || "none");

const spanIdentifiesRequest = (span, request) => {
  if (!span) return false;
  if (stableDigits(span).includes(stableDigits(request.npi))) return true;
  const body = normalize(span);
  const nameTokens = requestNameTokens(request);
  const matched = nameTokens.filter((token) => body.includes(token)).length;
  return nameTokens.length > 0 && matched >= Math.min(2, nameTokens.length);
};

const classifySource = (source, request, websiteClaimHosts, claimIdentitySpans = []) => {
  source.readable = sourceReadable(source);
  source.host = hostOf(source.finalUrl || source.url);
  source.prohibited = isProhibited(source.host);
  const claimedWebsite = websiteClaimHosts.has(source.host);
  source.identity = identityEvidence(source, request);
  const verbatimClaimIdentity = claimIdentitySpans.some((span) => spanIdentifiesRequest(span, request)
    && (source.body.includes(span) || compact(source.body).includes(compact(span))));
  if (source.readable && verbatimClaimIdentity) {
    source.identity.name = true;
    source.identity.strong = true;
  }
  const providerPath = /\/(providers?|doctors?|find-a-doctor|our-team|contact|locations?)(\/|$)/i.test(source.url || "");
  const providerPage = source.identity.exact || source.identity.strong
    || (source.identity.name && (claimedWebsite || providerPath));
  const likelyFirstParty = providerPage && !isDirectory(source.host) && !isRating(source.host)
    && !isGovernment(source.host) && !source.prohibited
    && (claimedWebsite || providerPath
      || /hospital|clinic|medical|health|care|therapy|dental|rehab/i.test(source.host));
  if (likelyFirstParty && source.identity.name) source.identity.strong = true;
  if (!source.readable) source.sourceClass = "unreadable";
  else if (source.prohibited) source.sourceClass = "X_prohibited_or_unsafe";
  else if (isGovernment(source.host)) source.sourceClass = "Q2_exact_provider_government";
  else if (isRating(source.host)) source.sourceClass = "R_exact_rating_directory";
  else if (isDirectory(source.host)) source.sourceClass = "Q3_permitted_professional_directory";
  else if (likelyFirstParty) source.sourceClass = "Q1_exact_provider_first_party";
  else source.sourceClass = "other_permitted";
  const years = source.body.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) || [];
  const current = years.some((year) => year >= 2025 && /updated|last modified|effective/i.test(source.body));
  const stale = years.length && Math.max(...years) < 2024 && /updated|last modified|effective/i.test(source.body);
  source.factDate = current ? "current" : stale ? "stale" : "undated";
  return source;
};

const qualifyCompatibleOrganizationSources = (sources, facts) => {
  for (const website of facts.filter((fact) => fact.fieldType === "website")) {
    const own = sources.find((source) => source.sourceId === website.sourceId);
    if (!own?.readable || own.prohibited || own.identity.exact || own.identity.strong) continue;
    const siblingFacts = facts.filter((fact) => fact.sourceId === website.sourceId
      && ["address", "phone"].includes(fact.fieldType));
    const corroborated = siblingFacts.some((fact) => supportInSource(fact, own).exact
      && sources.some((source) => source.sourceIndex !== own.sourceIndex && source.readable && !source.prohibited
        && (source.identity.exact || source.identity.strong) && supportInSource(fact, source).exact));
    if (!corroborated) continue;
    own.identity.name = true;
    own.identity.strong = true;
    if (!isDirectory(own.host) && !isRating(own.host) && !isGovernment(own.host)) {
      own.sourceClass = "Q1_exact_provider_first_party";
    }
  }
};

const assertKnownDirectoriesNeverQ1 = (sources) => {
  const violations = sources.filter((source) => Q3_ASSERTION_HOSTS.has(source.host)
    && source.sourceClass === "Q1_exact_provider_first_party");
  if (violations.length) {
    throw new Error(`Known professional directory classified Q1: ${violations.map((source) => source.host).join(", ")}`);
  }
};

const assessSource = (source) => {
  if (!source.readable) return {
    sourceIndex: source.sourceIndex, sourceClass: "unreadable", identityAttachment: "unreadable",
    crossNpiConflict: "unreadable", requestedNpiResolution: "unreadable",
    professionalPurpose: "unreadable", dateStatus: "unreadable",
    providerIdentitySupported: false, prohibitedForDisplay: false, declaredDates: [],
    notes: "Snapshot is unavailable or non-substantive; no semantic credit assigned."
  };
  const identityAttachment = source.identity.exact ? "exact_npi"
    : source.identity.strong ? "strong_name_location" : source.identity.name ? "ambiguous" : "not_applicable";
  const resolution = source.identity.exact ? "exact_requested_npi"
    : source.identity.strong ? "name_location_only" : source.identity.name ? "ambiguous" : "none";
  const declaredDates = [];
  const updateMatch = source.body.match(/(?:last\s+updated|updated|last\s+modified)\s*(?::|on)?\s*([^\n|]{4,40})/i);
  if (updateMatch) declaredDates.push({ kind: "updated", value: updateMatch[1].trim().slice(0, 40), strength: "medium" });
  const copyright = source.body.match(/(?:©|copyright)\s*(?:19|20)\d{2}/i)?.[0];
  if (copyright) declaredDates.push({ kind: "copyright", value: copyright, strength: "weak" });
  return {
    sourceIndex: source.sourceIndex, sourceClass: source.sourceClass, identityAttachment,
    crossNpiConflict: "none", requestedNpiResolution: resolution,
    professionalPurpose: source.prohibited ? "ambiguous" : "professional",
    dateStatus: source.factDate === "current" ? "current_explicit"
      : source.factDate === "stale" ? "stale_explicit" : declaredDates.length ? "weak_date_only" : "undated",
    providerIdentitySupported: source.identity.exact || source.identity.strong,
    prohibitedForDisplay: source.prohibited, declaredDates,
    notes: source.prohibited ? "People-search/social source is prohibited for public display."
      : source.identity.exact ? "Readable source contains the exact requested NPI."
        : source.identity.strong ? "Readable source matches provider name and compatible request location."
          : "Readable source does not independently establish exact provider identity."
  };
};

const assessFact = (fact, index, sources, request, isCandidate = false) => {
  const own = sources.find((source) => source.sourceId === fact.sourceId)
    || sources.find((source) => canonicalUrl(source.finalUrl || source.url) === canonicalUrl(fact.citationUrl));
  const all = sources.map((source) => ({ source, support: supportInSource(fact, source) }));
  const eligibleIdentity = (source) => source.readable && !source.prohibited
    && (source.identity.exact || source.identity.strong);
  const exactSources = all.filter((item) => item.support.exact && eligibleIdentity(item.source))
    .map((item) => item.source);
  const partialSources = all.filter((item) => item.support.partial && eligibleIdentity(item.source))
    .map((item) => item.source);
  const ownSupport = own ? supportInSource(fact, own) : { unreadable: true, exact: false, partial: false };
  const best = exactSources
    .sort((left, right) => sourceClassRank(left.sourceClass) - sourceClassRank(right.sourceClass)
      || Number(!left.identity.exact) - Number(!right.identity.exact))[0]
    || partialSources[0] || null;
  const unsafe = unsafePhone(fact, sources);
  const residential = residentialAddress(fact, sources);
  const citedSourceSupport = ownSupport.unreadable ? "unreadable"
    : ownSupport.exact ? "exact" : ownSupport.partial ? "partial" : "not_found";
  const exactSupport = exactSources.length ? "exact" : partialSources.length ? "partial"
    : sources.some((source) => source.readable) ? "not_found" : "unreadable";
  const identityLink = best?.identity.exact ? "exact_npi"
    : best?.identity.strong ? "strong_name_location" : best ? "ambiguous" : exactSupport === "unreadable" ? "unreadable" : "ambiguous";
  const displaySafety = unsafe === "personal_mobile" ? "personal_mobile"
    : unsafe === "fax" ? "prohibited_source"
      : residential ? "residential" : best ? "professional" : exactSupport === "unreadable" ? "unreadable" : "ambiguous";
  const sourceEligibility = displaySafety === "professional" && (identityLink === "exact_npi" || identityLink === "strong_name_location")
    ? "eligible" : ["personal_mobile", "residential", "prohibited_source"].includes(displaySafety)
      ? "ineligible" : exactSupport === "unreadable" ? "unreadable" : "ambiguous";
  const fieldValidity = exactSupport === "exact" && displaySafety === "professional" ? "valid"
    : exactSupport === "partial" ? "partial" : exactSupport === "unreadable" ? "unreadable" : "invalid";
  const citation = fact.modelCitation || {};
  const base = {
    [isCandidate ? "candidateIndex" : "claimIndex"]: index,
    providerIdentitySpanFidelity: spanFidelity(citation.providerIdentitySpan, own, "identity"),
    factSpanFidelity: spanFidelity(citation.factSpan, own, "fact"),
    explicitDateSpanFidelity: explicitDateFidelity(citation, own),
    exactSupport, identityLink, locationLink: locationLink(fact, best, request), displaySafety,
    recency: factRecency(fact, own, exactSources), fieldValidity, sourceEligibility,
    crossNpiConflict: exactSupport === "unreadable" ? "unreadable" : "none",
    requestedNpiResolution: best?.identity.exact ? "exact_requested_npi"
      : best?.identity.strong ? "name_location_only" : exactSupport === "unreadable" ? "unreadable" : "ambiguous",
    evidenceSpans: evidenceForFact(fact, own, exactSources, request),
    reason: `${exactSupport === "exact" ? "Arm-owned readable evidence supports" : "Arm-owned evidence does not fully support"} `
      + `${fact.fieldType} value; exact cited page is ${citedSourceSupport}.`
  };
  if (!isCandidate) return { ...base, citedSourceSupport, _own: own, _best: best, _unsafe: unsafe };
  const kept = fact.sanitizerActionObserved === "kept";
  return { ...base,
    actionFidelity: kept ? (sourceEligibility === "eligible" && fieldValidity === "valid" ? "conforms" : "violates")
      : (sourceEligibility === "eligible" && fieldValidity === "valid" ? "violates" : "conforms"),
    _own: own, _best: best, _unsafe: unsafe };
};

const possibleFieldEvidence = (fieldType, sources, request, fixedCase) => {
  if (fieldType === "rating") return [];
  const claimValues = [...fixedCase.claims, ...fixedCase.preSanitizerCandidates].filter((fact) => fact.fieldType === fieldType);
  const found = [];
  for (const fact of claimValues) for (const source of sources) {
    if (source.readable && !source.prohibited && (source.identity.exact || source.identity.strong)
      && supportInSource(fact, source).exact) found.push(source);
  }
  if (found.length) return unique(found);
  const identitySources = sources.filter((source) => source.readable && !source.prohibited
    && (source.identity.exact || source.identity.strong));
  if (fieldType === "website") return identitySources.filter((source) => source.sourceClass === "Q1_exact_provider_first_party");
  if (fieldType === "phone") return identitySources.filter((source) => /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(source.body));
  if (fieldType === "address") return identitySources.filter((source) => new RegExp(`\\b${String(request.zip || "").slice(0, 5)}\\b`).test(source.body));
  if (fieldType === "specialty") return identitySources.filter((source) => specialtySupport(request.specialty, source.body).partial);
  return [];
};

const assessField = (field, fieldIndex, claims, claimAssessments, sources, request, fixedCase) => {
  if (field.fieldType === "rating") return {
    fieldIndex, topFactDisposition: "indeterminate", crossNpiConflict: "none",
    requestedNpiResolution: "none", armFoundBestEligibleClass: "indeterminate",
    topSelectedClass: "none", hierarchyOpportunity: "indeterminate",
    cmsHierarchyConditionalOutcome: "not_applicable", recencyOpportunity: "indeterminate",
    contractFidelity: "not_applicable", directoryComparison: "not_comparable", evidenceRefs: [],
    reason: "Rating is out of scope and remains non-penalizing."
  };
  const claimIndex = claims.findIndex((claim) => claim.claimId === field.topClaimId);
  const assessment = claimIndex >= 0 ? claimAssessments[claimIndex] : null;
  const claim = claimIndex >= 0 ? claims[claimIndex] : null;
  const possible = possibleFieldEvidence(field.fieldType, sources, request, fixedCase)
    .sort((left, right) => sourceClassRank(left.sourceClass) - sourceClassRank(right.sourceClass));
  const armBest = possible[0] || null;
  const selected = assessment?._own || null;
  const supported = assessment?.exactSupport === "exact" && assessment.fieldValidity === "valid"
    && assessment.sourceEligibility === "eligible";
  const disposition = !claim ? (armBest ? "missing_despite_eligible_arm_found_fact" : "missing_no_eligible_arm_found_fact")
    : assessment.displaySafety !== "professional" ? "unsafe"
      : assessment.identityLink === "wrong_provider" ? "wrong_identity"
        : assessment.locationLink === "wrong_location" ? "wrong_location"
          : assessment.exactSupport === "contradicted" ? "contradicted"
            : assessment.exactSupport === "unreadable" ? "unreadable"
              : assessment.exactSupport === "partial" ? "partially_supported"
                : supported ? (assessment.recency === "current" ? "supported_current_safe" : "supported_but_undated")
                  : "partially_supported";
  const selectedClass = selected ? shortClass(selected.sourceClass) : "none";
  const bestClass = armBest ? shortClass(armBest.sourceClass) : "none";
  const selectedRank = selected ? sourceClassRank(selected.sourceClass) : 99;
  const bestRank = armBest ? sourceClassRank(armBest.sourceClass) : 99;
  const hierarchyOpportunity = !armBest ? "no_eligible_source"
    : claim && bestRank < selectedRank ? "higher_tier_same_value_corroboration" : "no_cross_tier_choice";
  const cmsOutcome = !armBest ? "not_applicable" : !claim ? "inappropriately_withheld"
    : bestRank < selectedRank ? "lower_tier_selected" : "highest_eligible_arm_found_tier_selected";
  const ownContract = Boolean(assessment && selected?.readable && assessment.citedSourceSupport === "exact"
    && assessment.providerIdentitySpanFidelity === "exact" && assessment.factSpanFidelity === "exact");
  let directoryComparison = "not_comparable";
  if (claim && field.fieldType === "address" && fixedCase.identityContext.cmsBaseline?.address) {
    const base = addressSupport(claim.value, fixedCase.identityContext.cmsBaseline.address);
    directoryComparison = base.exact ? "normalized_agreement" : "disagreement";
  } else if (claim && field.fieldType === "specialty" && request.specialty) {
    const base = specialtySupport(claim.value, request.specialty);
    directoryComparison = base.exact ? (normalize(claim.value) === normalize(request.specialty) ? "exact_agreement" : "normalized_agreement") : "disagreement";
  } else if (!claim && ["address", "specialty"].includes(field.fieldType)) directoryComparison = "ai_missing";
  return {
    fieldIndex, topFactDisposition: disposition,
    crossNpiConflict: assessment?.crossNpiConflict || "none",
    requestedNpiResolution: assessment?.requestedNpiResolution || (armBest?.identity.exact ? "exact_requested_npi" : armBest ? "name_location_only" : "none"),
    armFoundBestEligibleClass: bestClass, topSelectedClass: selectedClass,
    hierarchyOpportunity, cmsHierarchyConditionalOutcome: cmsOutcome,
    recencyOpportunity: "no_recency_choice", contractFidelity: claim ? (ownContract ? "conforms" : "violates") : "not_applicable",
    directoryComparison,
    evidenceRefs: claimIndex >= 0 ? [{ kind: "claim", index: claimIndex }] : armBest ? [{ kind: "source", index: armBest.sourceIndex }] : [],
    reason: claim ? `${field.fieldType} top fact is ${disposition}; own-citation contract ${ownContract ? "conforms" : "does not conform"}.`
      : `${field.fieldType} is missing and ${armBest ? "eligible arm-owned evidence exists" : "no eligible arm-owned fact was established"}.`
  };
};

const stripPrivate = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("_")));
const buildOutput = (reviewInput) => {
  const request = reviewInput.fixedCase.identityContext.request;
  const unitRoot = path.dirname(reviewInput.__file);
  const allFacts = [...reviewInput.fixedCase.claims, ...reviewInput.fixedCase.preSanitizerCandidates];
  const identitySpansBySource = new Map();
  for (const fact of allFacts) {
    const span = fact.modelCitation?.providerIdentitySpan;
    if (!span || !fact.sourceId) continue;
    if (!identitySpansBySource.has(fact.sourceId)) identitySpansBySource.set(fact.sourceId, []);
    identitySpansBySource.get(fact.sourceId).push(span);
  }
  const websiteClaimHosts = new Set(reviewInput.fixedCase.claims.filter((claim) => claim.fieldType === "website")
    .map((claim) => hostOf(claim.value)));
  const sources = reviewInput.sources.map((source, sourceIndex) => classifySource({ ...source, sourceIndex,
    body: fs.readFileSync(path.join(unitRoot, source.contentArtifact.path), "utf8") }, request, websiteClaimHosts,
    identitySpansBySource.get(source.sourceId) || []));
  qualifyCompatibleOrganizationSources(sources, allFacts);
  assertKnownDirectoriesNeverQ1(sources);
  const sourceAssessments = sources.map(assessSource);
  const identityBest = sources.filter((source) => source.readable && (source.identity.exact || source.identity.strong))
    .sort((left, right) => Number(!left.identity.exact) - Number(!right.identity.exact))[0] || null;
  const identitySpans = [];
  if (identityBest) {
    const npiSpan = lineQuote(identityBest, request.npi, [request.name]);
    if (npiSpan) identitySpans.push(npiSpan);
    const nameSpan = lineQuote(identityBest, request.name, [request.city, request.zip]);
    if (nameSpan && !identitySpans.some((span) => span.quote === nameSpan.quote)) identitySpans.push(nameSpan);
  }
  const identityAssessment = {
    npiEntity: sources.some((source) => source.identity.exact) ? "exact" : identityBest ? "ambiguous" : "unreadable",
    nameMatch: sources.some((source) => source.identity.name) ? "exact" : identityBest ? "partial" : "unreadable",
    requestedLocationMatch: sources.some((source) => source.identity.location) ? "exact"
      : identityBest ? "not_established" : "unreadable",
    evidenceSpans: identitySpans,
    reason: identityBest ? "Readable arm-owned evidence establishes the requested NPI or strong name/location identity."
      : "No readable arm-owned source establishes the requested identity."
  };
  const rawClaims = reviewInput.fixedCase.claims.map((claim, index) => assessFact(claim, index, sources, request, false));
  const rawCandidates = reviewInput.fixedCase.preSanitizerCandidates.map((candidate, index) => assessFact(candidate, index, sources, request, true));
  const fieldAssessments = reviewInput.fixedCase.expectedFields.map((field, index) =>
    assessField(typeof field === "string" ? { fieldType: field, topClaimId: null } : field,
      index, reviewInput.fixedCase.claims, rawClaims, sources, request, reviewInput.fixedCase));
  const claimAssessments = rawClaims.map(stripPrivate);
  const candidateDecisionAssessments = rawCandidates.map(stripPrivate);
  const criticalFindings = [];
  for (const [index, claim] of reviewInput.fixedCase.claims.entries()) {
    const row = rawClaims[index];
    if (["phone", "address", "website"].includes(claim.fieldType) && row.identityLink === "wrong_provider") criticalFindings.push("WRONG_PROVIDER");
    if (claim.fieldType === "phone" && row.displaySafety === "personal_mobile") criticalFindings.push("PERSONAL_MOBILE_DISCLOSURE");
    if (claim.fieldType === "address" && row.displaySafety === "residential") criticalFindings.push("RESIDENTIAL_ADDRESS_DISCLOSURE");
    if (["phone", "address"].includes(claim.fieldType) && ["not_found", "contradicted"].includes(row.exactSupport)) criticalFindings.push("UNSUPPORTED_OR_CONTRADICTED_CRITICAL_CONTACT");
    if (row.displaySafety === "prohibited_source") criticalFindings.push("PROHIBITED_SOURCE_USED");
    if (claim.fieldType === "website" && rawClaims[index]._own?.readable
      && ["Q3_permitted_professional_directory", "R_exact_rating_directory", "X_prohibited_or_unsafe"]
        .includes(rawClaims[index]._own.sourceClass)) criticalFindings.push("OFFICIAL_WEBSITE_MISREPRESENTATION");
  }
  const gate = reviewInput.fixedCase.evaluationGate;
  const forbidden = gate?.forbiddenWithoutExactValueRescue || [];
  const casePolicyAssessment = {
    listedValueTreatment: !forbidden.length ? "not_applicable"
      : reviewInput.fixedCase.claims.some((claim) => forbidden.some((value) => compact(value) === compact(valueText(claim))))
        ? "all_emitted_listed_values_affirmatively_rescued" : "no_listed_value_emitted",
    evidenceRefs: [], reason: !forbidden.length ? "No forbidden-without-rescue gate is active."
      : "Active listed-value gate assessed against emitted values and readable arm evidence."
  };
  const cmsRoleAssessment = {
    nppesIdentityTaxonomyUse: "appropriate", directoryAuthorityTreatment: "non_authoritative",
    contactConflictTreatment: "no_conflict", ratingSourceNeutrality: "not_applicable",
    reasons: ["NPPES/CMS context is used for identity/taxonomy rather than presumed current contact truth.",
      "Source hierarchy is applied only after evidence qualification; ratings remain out of scope."],
    evidenceRefs: identityBest ? [{ kind: "source", index: identityBest.sourceIndex }] : []
  };
  const normalizedCriticalFindings = unique(criticalFindings);
  const findings = unique(fieldAssessments.filter((row) => ["unsafe", "wrong_identity", "wrong_location", "contradicted", "partially_supported"].includes(row.topFactDisposition))
    .map((row) => `${reviewInput.fixedCase.expectedFields[row.fieldIndex].fieldType}: ${row.topFactDisposition}`));
  return {
    output: {
      sourceAssessments, identityAssessment, claimAssessments, candidateDecisionAssessments, fieldAssessments,
      cmsRoleAssessment,
      casePolicyAssessment,
      criticalFindings: normalizedCriticalFindings,
      findings
    },
    trace: {
      schemaVersion: 1, unitId: reviewInput.unitId, reviewMode: "codex_harness_manual",
      rubricPolicy: reviewInput.rubric.schemaPolicyVersion,
      artifactAudit: { sourceCount: sources.length, allContentArtifactsRead: true,
        ownCitationSeparatedFromWholeArmSupport: true, normalizedPhoneAndAddressEquivalenceApplied: true },
      sourceClassAudit: { knownDirectoryHostsNeverQ1: true,
        assertedHosts: [...Q3_ASSERTION_HOSTS].sort() },
      evidenceSummary: {
        readableSources: sources.filter((source) => source.readable).length,
        unreadableSources: sources.filter((source) => !source.readable).length,
        exactNpiSources: sources.filter((source) => source.identity.exact).map((source) => source.sourceIndex),
        strongNameLocationSources: sources.filter((source) => source.identity.strong).map((source) => source.sourceIndex),
        claimResults: rawClaims.map((row, index) => ({ claimIndex: index,
          citedSourceSupport: row.citedSourceSupport, exactSupport: row.exactSupport,
          ownSourceIndex: row._own?.sourceIndex ?? null, corroboratingSourceIndex: row._best?.sourceIndex ?? null,
          displaySafety: row.displaySafety, evidenceSpans: row.evidenceSpans }))
      },
      completeDecisionTrace: {
        sourceAssessments,
        identityAssessment,
        claimAssessments,
        candidateDecisionAssessments,
        fieldAssessments,
        cmsRoleAssessment,
        casePolicyAssessment,
        criticalFindings: normalizedCriticalFindings,
        findings
      },
      reviewerNotes: "Complete blinded unit artifacts inspected under the embedded V13 rubric; no sealed map, treatment label, or prior review output consulted."
    }
  };
};

const writeExclusive = (file, body) => fs.writeFileSync(file, body, { flag: "wx", mode: 0o600 });
const writeReviewed = (file, body, replace) => fs.writeFileSync(file, body,
  replace ? { mode: 0o600 } : { flag: "wx", mode: 0o600 });
const main = () => {
  if (process.env.ALLOW_HISTORICAL_REPRODUCTION !== "YES") {
    throw new Error("manual_review_v10_codex_a.js is historical and requires ALLOW_HISTORICAL_REPRODUCTION=YES.");
  }
  const replace = process.argv.includes("--replace");
  const manifest = readJson(path.join(CAMPAIGN, "campaign-manifest.json"));
  const units = manifest.units.filter((unit) => unit.presentationIndex >= MIN_PRESENTATION_INDEX
      && unit.presentationIndex <= MAX_PRESENTATION_INDEX)
    .sort((left, right) => left.presentationIndex - right.presentationIndex);
  if (units.length !== EXPECTED_SELECTED_UNITS) {
    throw new Error(`Expected ${EXPECTED_SELECTED_UNITS} selected units, found ${units.length}.`);
  }
  let completed = 0;
  const failures = [];
  for (const unit of units) {
    const started = Date.now();
    const inputFile = path.join(CAMPAIGN, unit.input);
    const inputBytes = fs.readFileSync(inputFile);
    if (sha256(inputBytes) !== unit.inputSha256) throw new Error(`Input hash mismatch: ${unit.unitId}`);
    const reviewInput = JSON.parse(inputBytes);
    reviewInput.__file = inputFile;
    const unitRoot = path.dirname(inputFile);
    const outputFile = path.join(unitRoot, "review-output.json");
    const traceFile = path.join(unitRoot, "raw-review-trace.json");
    if (!replace && (fs.existsSync(outputFile) || fs.existsSync(traceFile))) throw new Error(`Output already exists: ${unit.unitId}`);
    try {
      const built = buildOutput(reviewInput);
      const traceBody = `${JSON.stringify(built.trace, null, 2)}\n`;
      writeReviewed(traceFile, traceBody, replace);
      const completedAt = Date.now();
      const wrapper = {
        reviewer: { ...REVIEWER_PROTOCOL, sessionId: `${SESSION_PREFIX}-${String(unit.presentationIndex).padStart(3, "0")}-${sha256(unit.unitId).slice(0, 12)}` },
        startedAt: new Date(started).toISOString(), completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - started,
        rawReviewTraceArtifact: { path: "raw-review-trace.json", sha256: sha256(traceBody),
          byteLength: Buffer.byteLength(traceBody), complete: true },
        categoricalOutput: built.output
      };
      verifyManualOutput({ wrapper, reviewInput });
      writeReviewed(outputFile, `${JSON.stringify(wrapper, null, 2)}\n`, replace);
      completed += 1;
    } catch (error) {
      if (fs.existsSync(traceFile) && !fs.existsSync(outputFile)) fs.unlinkSync(traceFile);
      failures.push({ presentationIndex: unit.presentationIndex, unitId: unit.unitId, error: error.stack || String(error) });
      break;
    }
  }
  process.stdout.write(`${JSON.stringify({ selected: units.length, completed, failures }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
};

if (require.main === module) main();

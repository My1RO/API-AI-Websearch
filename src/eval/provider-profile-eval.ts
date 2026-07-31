import { createHmac } from "node:crypto";

import { z } from "zod";

import { ProviderProfile, ProviderProfileJob, ProviderProfileRequestItem } from "../types/provider-profile";
import { providerProfileJobSchema, providerRequestItemSchema } from "../validators/provider-profile.validator";
import { safePublicUrl } from "../services/sanitizer.service";

export const evalSourceSchema = z.object({
  kind: z.enum(["cms", "nppes", "provider_official", "rating_directory", "approved_directory"]),
  domain: z.string().trim().min(3).max(255),
  capturedAt: z.string().datetime(),
  evidenceId: z.string().trim().min(1).max(255)
}).strict();

const goldStatusSchema = z.enum([
  "confirmed_current",
  "confirmed_stale",
  "conflict_unresolved",
  "not_found",
  "unsafe_personal",
  "not_applicable"
]);

export const goldFactSchema = z.object({
  value: z.string().trim().min(1).max(1000).optional(),
  valueHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: goldStatusSchema,
  displaySafe: z.boolean(),
  sources: z.array(evalSourceSchema).max(10)
}).strict().superRefine((fact, context) => {
  if (fact.status === "unsafe_personal") {
    if (fact.value || !fact.valueHash || fact.displaySafe) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unsafe personal facts require only valueHash and displaySafe=false"
      });
    }
    return;
  }

  if (["confirmed_current", "confirmed_stale", "conflict_unresolved"].includes(fact.status) && !fact.value) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A confirmed fact requires value" });
  }
});

export const providerEvalCaseSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().trim().min(1).max(120),
  request: providerRequestItemSchema,
  strata: z.object({
    entityType: z.enum(["individual", "facility"]),
    region: z.string().trim().min(1).max(120),
    rurality: z.enum(["urban", "rural"]),
    specialtyGroup: z.string().trim().min(1).max(120),
    edgeCases: z.array(z.enum([
      "multi_location",
      "common_name",
      "recent_change",
      "sparse_web",
      "rating_directory_listed",
      "known_conflict"
    ])).max(6),
    productionWeight: z.number().positive().optional()
  }).strict(),
  cmsBaseline: z.object({
    capturedAt: z.string().datetime(),
    providerId: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(255),
    specialty: z.string().trim().min(1).max(255).optional(),
    address: z.string().trim().min(1).max(1000).optional()
  }).strict(),
  gold: z.object({
    identity: z.object({
      npi: z.string().regex(/^\d{10}$/),
      entityType: z.enum(["individual", "facility"])
    }).strict(),
    phones: z.array(goldFactSchema),
    addresses: z.array(goldFactSchema),
    websites: z.array(goldFactSchema),
    ratings: z.array(goldFactSchema)
  }).strict()
}).strict();

export type ProviderEvalCase = z.infer<typeof providerEvalCaseSchema>;
export type GoldFact = z.infer<typeof goldFactSchema>;
export type EvalFieldName = "phones" | "addresses" | "websites" | "ratings";

export interface EvalObservation {
  schemaVersion: 1;
  caseId: string;
  repeat: number;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  terminalStatus: ProviderProfileJob["status"];
  profile?: ProviderProfile;
  errorCode?: string;
}

export interface FieldCaseScore {
  eligible: number;
  emitted: number;
  correct: number;
  goldCount: number;
  recovered: number;
  topOneCorrect: number;
  citationPresent: number;
  unsafeDisclosures: number;
}

export interface CaseScore {
  caseId: string;
  identityCorrect: boolean;
  wrongProvider: boolean;
  cmsAddressAgreement: boolean | null;
  cmsAddressConflict: boolean | null;
  fields: Record<EvalFieldName, FieldCaseScore>;
  latencyMs: number;
  failed: boolean;
}

const normalizeText = (value: string | null | undefined): string => (value || "")
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export const normalizePhone = (value: string): { digits: string; extension?: string } => {
  const extensionMatch = value.match(/(?:ext\.?|extension|x)\s*(\d{1,8})\s*$/i);
  const main = extensionMatch ? value.slice(0, extensionMatch.index) : value;
  const digits = main.replace(/\D/g, "");
  const normalizedDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return {
    digits: normalizedDigits,
    ...(extensionMatch ? { extension: extensionMatch[1] } : {})
  };
};

export interface NormalizedAddress {
  canonical: string;
  zip?: string;
}

export const normalizeAddress = (value: string): NormalizedAddress => {
  const replacements: Record<string, string> = {
    street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr",
    lane: "ln", highway: "hwy", suite: "ste", apartment: "apt", north: "n",
    south: "s", east: "e", west: "w"
  };
  const canonical = normalizeText(value)
    .split(" ")
    .map((token) => replacements[token] || token)
    .join(" ");
  const zip = canonical.match(/\b\d{5}(?: \d{4})?\b/)?.[0]?.slice(0, 5);
  return { canonical, ...(zip ? { zip } : {}) };
};

export const canonicalizeWebsite = (value: string): string | undefined => {
  const url = safePublicUrl(value);
  if (!url) {
    return undefined;
  }
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${path.toLowerCase()}${parsed.search}`;
};

const formatLocation = (location: ProviderProfile["locations"][number]): string => [
  location.addressLine1,
  location.addressLine2,
  location.city,
  location.state,
  location.zip
].filter(Boolean).join(" ");

const emittedValues = (
  profile: ProviderProfile | undefined,
  field: EvalFieldName
): Array<{ value: string; citation: { sourceUrl: string } }> => {
  if (!profile) {
    return [];
  }
  if (field === "phones") {
    return profile.phoneNumbers;
  }
  if (field === "addresses") {
    return profile.locations.map((location) => ({ value: formatLocation(location), citation: location.citation }));
  }
  return profile[field];
};

const normalizedFieldValue = (field: EvalFieldName, value: string): string => {
  if (field === "phones") {
    const phone = normalizePhone(value);
    return `${phone.digits}${phone.extension ? `x${phone.extension}` : ""}`;
  }
  if (field === "addresses") {
    return normalizeAddress(value).canonical;
  }
  if (field === "websites") {
    return canonicalizeWebsite(value) || "";
  }
  return normalizeText(value);
};

export const hmacEvalFact = (field: EvalFieldName, value: string, key: string): string => createHmac("sha256", key)
  .update(`${field}:${normalizedFieldValue(field, value)}`)
  .digest("hex");

export const profileMatchesCase = (
  profile: ProviderProfile | undefined,
  evalCase: ProviderEvalCase
): { matches: boolean; reason: "missing" | "npi" | "name" | "match" } => {
  if (!profile) {
    return { matches: false, reason: "missing" };
  }
  if (profile.npi !== evalCase.gold.identity.npi) {
    return { matches: false, reason: "npi" };
  }
  if (normalizeText(profile.providerName) !== normalizeText(evalCase.request.name)) {
    return { matches: false, reason: "name" };
  }
  return { matches: true, reason: "match" };
};

const confirmedGold = (facts: GoldFact[]): GoldFact[] => facts.filter((fact) => (
  fact.status === "confirmed_current" && fact.displaySafe && Boolean(fact.value)
));

const isSourceSupported = (sourceUrl: string): boolean => Boolean(safePublicUrl(sourceUrl));

const scoreField = (
  field: EvalFieldName,
  gold: GoldFact[],
  profile: ProviderProfile | undefined,
  hmacKey?: string
): FieldCaseScore => {
  const expected = confirmedGold(gold);
  const emitted = emittedValues(profile, field);
  const expectedValues = new Set(expected.map((fact) => normalizedFieldValue(field, fact.value || "")));
  const emittedNormalized = emitted.map((fact) => normalizedFieldValue(field, fact.value));
  const unsafeHashes = new Set(gold
    .filter((fact) => fact.status === "unsafe_personal")
    .map((fact) => fact.valueHash)
    .filter((value): value is string => Boolean(value)));
  if (unsafeHashes.size > 0 && !hmacKey) {
    throw new Error(`PROVIDER_EVAL_HMAC_KEY is required to score unsafe ${field} facts`);
  }
  const unsafeDisclosures = hmacKey
    ? emitted.filter((fact) => unsafeHashes.has(hmacEvalFact(field, fact.value, hmacKey))).length
    : 0;

  return {
    eligible: expected.length > 0 ? 1 : 0,
    emitted: emitted.length,
    correct: emittedNormalized.filter((value) => expectedValues.has(value)).length,
    goldCount: expected.length,
    recovered: [...expectedValues].filter((value) => emittedNormalized.includes(value)).length,
    topOneCorrect: expected.length > 0 && emittedNormalized.length > 0 && expectedValues.has(emittedNormalized[0]) ? 1 : 0,
    citationPresent: emitted.filter((fact) => isSourceSupported(fact.citation.sourceUrl)).length,
    unsafeDisclosures
  };
};

export const scoreCase = (
  evalCase: ProviderEvalCase,
  observation: EvalObservation,
  options: { hmacKey?: string } = {}
): CaseScore => {
  const identity = profileMatchesCase(observation.profile, evalCase);
  const cmsAddress = evalCase.cmsBaseline.address;
  const topAddress = observation.profile?.locations[0];
  const cmsAddressAgreement = cmsAddress
    ? Boolean(topAddress && normalizeAddress(formatLocation(topAddress)).canonical === normalizeAddress(cmsAddress).canonical)
    : null;
  return {
    caseId: evalCase.caseId,
    identityCorrect: identity.matches,
    wrongProvider: Boolean(observation.profile) && !identity.matches,
    cmsAddressAgreement,
    cmsAddressConflict: cmsAddressAgreement === null ? null : !cmsAddressAgreement,
    fields: {
      phones: scoreField("phones", evalCase.gold.phones, observation.profile, options.hmacKey),
      addresses: scoreField("addresses", evalCase.gold.addresses, observation.profile, options.hmacKey),
      websites: scoreField("websites", evalCase.gold.websites, observation.profile, options.hmacKey),
      ratings: scoreField("ratings", evalCase.gold.ratings, observation.profile, options.hmacKey)
    },
    latencyMs: observation.latencyMs,
    failed: observation.terminalStatus !== "completed" || !observation.profile
  };
};

export const wilsonInterval = (successes: number, total: number): { lower: number; upper: number } => {
  if (total <= 0) {
    return { lower: 0, upper: 0 };
  }
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt(
    (proportion * (1 - proportion) / total) + (z * z) / (4 * total * total)
  );
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
};

const ratioMetric = (successes: number, total: number) => ({
  value: total ? successes / total : null,
  successes,
  total,
  interval95: wilsonInterval(successes, total)
});

export const aggregateScores = (scores: CaseScore[]) => {
  const fields = (Object.keys(scores[0]?.fields || {}) as EvalFieldName[]).reduce((result, field) => {
    const totals = scores.reduce((sum, score) => {
      const current = score.fields[field];
      return {
        eligible: sum.eligible + current.eligible,
        emitted: sum.emitted + current.emitted,
        correct: sum.correct + current.correct,
        goldCount: sum.goldCount + current.goldCount,
        recovered: sum.recovered + current.recovered,
        topOneCorrect: sum.topOneCorrect + current.topOneCorrect,
        citationPresent: sum.citationPresent + current.citationPresent,
        unsafeDisclosures: sum.unsafeDisclosures + current.unsafeDisclosures
      };
    }, { eligible: 0, emitted: 0, correct: 0, goldCount: 0, recovered: 0, topOneCorrect: 0, citationPresent: 0, unsafeDisclosures: 0 });
    result[field] = {
      coverage: ratioMetric(scores.filter((score) => score.fields[field].eligible > 0 && score.fields[field].emitted > 0).length, totals.eligible),
      emittedPrecision: ratioMetric(totals.correct, totals.emitted),
      goldRecall: ratioMetric(totals.recovered, totals.goldCount),
      topOneAccuracy: ratioMetric(totals.topOneCorrect, totals.eligible),
      citationPresence: ratioMetric(totals.citationPresent, totals.emitted),
      unsafeDisclosures: totals.unsafeDisclosures
    };
    return result;
  }, {} as Record<EvalFieldName, unknown>);

  const cmsPaired = scores.filter((score) => score.cmsAddressAgreement !== null);
  return {
    cases: scores.length,
    identityAccuracy: ratioMetric(scores.filter((score) => score.identityCorrect).length, scores.length),
    wrongProviderRate: ratioMetric(scores.filter((score) => score.wrongProvider).length, scores.length),
    failureRate: ratioMetric(scores.filter((score) => score.failed).length, scores.length),
    cmsAddressAgreement: ratioMetric(cmsPaired.filter((score) => score.cmsAddressAgreement).length, cmsPaired.length),
    cmsAddressConflict: ratioMetric(cmsPaired.filter((score) => score.cmsAddressConflict).length, cmsPaired.length),
    latencyMs: {
      mean: scores.length ? scores.reduce((sum, score) => sum + score.latencyMs, 0) / scores.length : null,
      max: scores.length ? Math.max(...scores.map((score) => score.latencyMs)) : null
    },
    fields
  };
};

export const repeatVariance = (observations: EvalObservation[]) => {
  const byCase = new Map<string, EvalObservation[]>();
  observations.forEach((observation) => byCase.set(
    observation.caseId,
    [...(byCase.get(observation.caseId) || []), observation]
  ));
  const cases = [...byCase.values()].map((repeats) => {
    const sets = repeats.map((observation) => new Set([
      ...emittedValues(observation.profile, "phones").map((fact) => normalizedFieldValue("phones", fact.value)),
      ...emittedValues(observation.profile, "addresses").map((fact) => normalizedFieldValue("addresses", fact.value)),
      ...emittedValues(observation.profile, "websites").map((fact) => normalizedFieldValue("websites", fact.value)),
      ...emittedValues(observation.profile, "ratings").map((fact) => normalizedFieldValue("ratings", fact.value))
    ]));
    const pairs: number[] = [];
    for (let left = 0; left < sets.length; left += 1) {
      for (let right = left + 1; right < sets.length; right += 1) {
        const union = new Set([...sets[left], ...sets[right]]);
        const intersection = [...sets[left]].filter((value) => sets[right].has(value));
        pairs.push(union.size ? intersection.length / union.size : 1);
      }
    }
    const topOnes = repeats.map((observation) => [
      emittedValues(observation.profile, "phones")[0]?.value || "",
      emittedValues(observation.profile, "addresses")[0]?.value || "",
      emittedValues(observation.profile, "websites")[0]?.value || "",
      emittedValues(observation.profile, "ratings")[0]?.value || ""
    ].join("|")).map(normalizeText);
    return {
      caseId: repeats[0].caseId,
      meanJaccard: pairs.length ? pairs.reduce((sum, value) => sum + value, 0) / pairs.length : 1,
      topOneAgreement: topOnes.length ? Math.max(...[...new Set(topOnes)].map((value) => topOnes.filter((candidate) => candidate === value).length)) / topOnes.length : 1
    };
  });
  return {
    cases,
    meanJaccard: cases.length ? cases.reduce((sum, value) => sum + value.meanJaccard, 0) / cases.length : null,
    meanTopOneAgreement: cases.length ? cases.reduce((sum, value) => sum + value.topOneAgreement, 0) / cases.length : null
  };
};

interface PollOptions {
  apiBase: string;
  request: ProviderProfileRequestItem;
  caseId: string;
  repeat: number;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (durationMs: number) => Promise<void>;
  now?: () => number;
}

const terminalStatuses = new Set<ProviderProfileJob["status"]>(["completed", "failed", "expired"]);

export const pollProviderProfileJob = async (options: PollOptions): Promise<EvalObservation> => {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();
  const base = options.apiBase.replace(/\/+$/, "");
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  const created = await fetchImpl(`${base}/provider-profiles`, {
    method: "POST",
    headers,
    body: JSON.stringify({ providers: [options.request], lineOfCoverage: "Medical" })
  });
  if (!created.ok) {
    throw new Error(`provider profile create failed (${created.status})`);
  }
  const initial = providerProfileJobSchema.parse(await created.json());
  const deadline = startedMs + (options.timeoutMs || 180_000);
  let job = initial;
  while (!terminalStatuses.has(job.status)) {
    if (now() >= deadline) {
      throw new Error("provider profile evaluation timed out");
    }
    await sleep(options.pollIntervalMs || 2_000);
    const response = await fetchImpl(`${base}/provider-profiles/${initial.requestId}`, { headers });
    if (response.status === 429 || response.status >= 500) {
      continue;
    }
    if (!response.ok) {
      throw new Error(`provider profile poll failed (${response.status})`);
    }
    job = providerProfileJobSchema.parse(await response.json());
  }
  const completedMs = now();
  return {
    schemaVersion: 1,
    caseId: options.caseId,
    repeat: options.repeat,
    startedAt,
    completedAt: new Date(completedMs).toISOString(),
    latencyMs: completedMs - startedMs,
    terminalStatus: job.status,
    profile: job.profiles?.[0],
    ...(job.error ? { errorCode: "provider_job_failed" } : {})
  };
};

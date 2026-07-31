import { z } from "zod";

const optionalTrimmedString = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .optional();

export const providerRequestItemSchema = z.object({
  providerId: optionalTrimmedString,
  npi: z.string().trim().regex(/^\d{10}$/).optional(),
  name: z.string().trim().min(2).max(255),
  specialty: optionalTrimmedString,
  city: optionalTrimmedString,
  state: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
  zip: z.string().trim().regex(/^\d{5}$/).optional()
}).strict();

export const createProviderProfilesSchema = z.object({
  providers: z.array(providerRequestItemSchema).min(1).max(10),
  lineOfCoverage: z.literal("Medical")
}).strict();

export const citationSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(2048),
  sourceTitle: z.string().trim().min(1).max(255).nullable().optional(),
  providerIdentitySpan: z.string().trim().min(1).max(2000),
  factSpan: z.string().trim().min(1).max(2000),
  explicitFactDateSpan: z.string().trim().min(1).max(1000).nullable()
}).strict();

export const sourcedValueSchema = z.object({
  value: z.string().trim().min(1).max(500),
  citation: citationSchema
}).strip();

export const providerProfileSchema = z.object({
  providerId: z.string().trim().min(1).max(255).optional(),
  npi: z.string().trim().regex(/^\d{10}$/).optional(),
  providerName: z.string().trim().min(1).max(255),
  specialties: z.array(sourcedValueSchema).default([]),
  locations: z
    .array(
      z.object({
        addressLine1: z.string().trim().min(1).max(255),
        addressLine2: z.string().trim().max(255).nullable().optional(),
        city: z.string().trim().max(120).nullable().optional(),
        state: z.string().trim().max(2).nullable().optional(),
        zip: z.string().trim().max(10).nullable().optional(),
        citation: citationSchema
      }).strip()
    )
    .default([]),
  phoneNumbers: z.array(sourcedValueSchema).default([]),
  ratings: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(80),
        scale: z.string().trim().max(80).nullable().optional(),
        citation: citationSchema
      }).strip()
    )
    .default([]),
  websites: z.array(sourcedValueSchema).default([]),
  confidenceNotes: z.array(z.string().trim().min(1).max(500)).default([]),
}).strip();

export const providerProfilesSchema = z.array(providerProfileSchema);

const structuredCitationSchema = z.object({
  sourceUrl: z.string().describe(
    "The exact consulted public http or https page URL that directly supports this fact for the requested provider; never a search-results page, snippet, or different corroborating page."
  ),
  sourceTitle: z.string().nullable().describe("The title of the cited page, or null when unavailable."),
  providerIdentitySpan: z.string().describe(
    "A short contiguous passage, or faithful rendered-text equivalent, from this cited page. Copy the shortest sufficient passage verbatim whenever possible. It must contain the exact requested NPI when the page shows it; otherwise it must contain the exact provider name plus a disambiguating organization or location. Never use ellipses, combine noncontiguous passages, paraphrase, or quote only a page title when supporting page text exists."
  ),
  factSpan: z.string().describe(
    "A short contiguous passage, or faithful rendered-text equivalent, from this same cited page. Copy the shortest sufficient passage verbatim whenever possible. It must contain the complete emitted value or faithful formatting equivalent and text binding it to this fact type for the identity-qualified provider. Never use ellipses, combine noncontiguous passages, paraphrase, quote only a page title when supporting page text exists, or use text for another field or entity."
  ),
  explicitFactDateSpan: z.string().nullable().describe(
    "A contiguous passage from that page containing an explicit date that governs this exact provider, field, and value, or null when no such date exists. Retrieval dates, copyright years, and generic page-update dates do not qualify. NPPES or registry record enumeration, creation, or last-update dates also do not qualify unless explicitly attached to this exact value."
  )
}).strict();

const structuredSourcedValueSchema = z.object({
  value: z.string().describe("The public professional fact exactly as supported by the cited source."),
  citation: structuredCitationSchema.describe("Evidence from the exact consulted page whose factSpan contains the complete emitted specialty value and supports only this fact.")
}).strict();

const structuredPhoneSchema = z.object({
  value: z.string().describe(
    "A professional voice phone number for the exact provider. Never a fax, mobile, cell, personal, home, or uncertain-purpose number."
  ),
  citation: structuredCitationSchema.describe("Evidence from the exact consulted page whose factSpan contains all digits of this emitted phone, allowing formatting equivalents, and establishes it as a professional voice contact.")
}).strict();

const structuredLocationSchema = z.object({
  addressLine1: z.string().describe("Street line for a verified professional practice, clinic, facility, hospital, or office location for the exact provider."),
  addressLine2: z.string().nullable().describe("Professional suite or secondary address line, or null."),
  city: z.string().nullable().describe("City for the verified professional location, or null."),
  state: z.string().nullable().describe("State for the verified professional location, or null."),
  zip: z.string().nullable().describe("ZIP code for the verified professional location, or null."),
  citation: structuredCitationSchema.describe("Evidence from the exact consulted page whose factSpan contains every non-null material component of this emitted address, allowing postal and formatting equivalents, and establishes this professional location.")
}).strict();

const structuredRatingSchema = z.object({
  value: z.string().describe("The numeric rating supported by the exact provider page on the cited rating source."),
  scale: z.string().nullable().describe("The numeric maximum rating scale, or null when unavailable."),
  citation: structuredCitationSchema.describe("Evidence from the exact consulted provider-rating page whose factSpan contains this exact rating value and its scale when non-null.")
}).strict();

const structuredProviderProfileSchema = z.object({
  providerId: z.string().nullable(),
  npi: z.string().nullable().describe("The exact requested 10-digit NPI for this profile; never a nearby or same-name entity's NPI."),
  providerName: z.string().describe("The requested provider or entity name attached to the requested NPI, not merely a same-name organization."),
  specialties: z.array(structuredSourcedValueSchema),
  locations: z.array(structuredLocationSchema).describe(
    "Verified professional practice, office, clinic, facility, or hospital locations for the exact provider only, ordered for display. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing location only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible location. Never residential, people-search, or uncertain-purpose addresses."
  ),
  phoneNumbers: z.array(structuredPhoneSchema).describe(
    "Verified professional voice contacts for the exact provider only, ordered for display. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing phone only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible phone. Never fax, mobile, cell, personal, home, or uncertain-purpose numbers."
  ),
  ratings: z.array(structuredRatingSchema),
  websites: z.array(z.object({
    value: z.string().describe("A current provider, practice, clinic, facility, hospital, or health-system website URL for the exact requested entity, never an unresolved or legacy alternate."),
    citation: structuredCitationSchema.describe(
      "Evidence from one consulted page whose factSpan establishes the exact provider's organizational ownership or operation of this website and identifies the emitted domain or the cited first-party homepage itself. When sourceUrl is the first-party homepage, its identity or ownership passage may establish the homepage itself; an address or phone passage alone does not support a website."
    )
  }).strict()).describe(
    "Identity-qualified current websites ordered for display. Index zero must be the best eligible default after conflict resolution and source hierarchy. Additional domains require affirmative evidence of concurrent operation, not merely separate listings."
  )
}).strict();

export const providerProfileStructuredOutputSchema = z.object({
  profiles: z.array(structuredProviderProfileSchema)
}).strict();

export const providerProfileProviderJobSchema = z.object({
  requestProviderKey: z.string().trim().min(1).max(320),
  providerId: z.string().trim().min(1).max(255).optional(),
  npi: z.string().trim().regex(/^\d{10}$/).optional(),
  providerName: z.string().trim().min(1).max(255),
  status: z.enum(["queued", "searching", "completed", "no_results", "failed", "expired"]),
  loading: z.boolean(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  error: z.string().trim().min(1).max(255).nullable().optional()
}).strict();

export const providerProfileJobSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  noResults: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative()
}).strict();

export const providerProfileJobSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "expired"]),
  expiresAt: z.string().datetime(),
  profiles: providerProfilesSchema.optional(),
  providerJobs: z.array(providerProfileProviderJobSchema).optional(),
  summary: providerProfileJobSummarySchema.optional(),
  error: z.string().trim().min(1).max(255).optional()
}).strict();

export const requestIdParamSchema = z.string().uuid();

export const feedbackFactTypes = ["profile", "phone", "address", "website", "rating"] as const;
export const feedbackReasonCodes = [
  "accurate",
  "outdated",
  "wrong_provider",
  "wrong_location",
  "wrong_phone",
  "wrong_website",
  "wrong_rating",
  "missing_info",
  "other"
] as const;

const typeSpecificFeedbackReasons = {
  profile: new Set(["outdated", "wrong_provider", "missing_info", "other"]),
  phone: new Set(["outdated", "wrong_provider", "wrong_phone", "missing_info", "other"]),
  address: new Set(["outdated", "wrong_provider", "wrong_location", "missing_info", "other"]),
  website: new Set(["outdated", "wrong_provider", "wrong_website", "missing_info", "other"]),
  rating: new Set(["outdated", "wrong_provider", "wrong_rating", "missing_info", "other"])
} satisfies Record<(typeof feedbackFactTypes)[number], Set<string>>;

export const feedbackSchema = z.object({
  brokerOrgId: z.string().trim().min(1).max(120),
  submitterClass: z.enum(["consumer", "producer", "broker_admin", "general_agent", "internal_administrator", "unknown"]),
  providerId: z.string().trim().min(1).max(255).optional(),
  providerNpi: z.string().trim().regex(/^\d{10}$/).optional(),
  factType: z.enum(feedbackFactTypes),
  normalizedFactValue: z.string().trim().min(1).max(255),
  validationStatus: z.enum(["correct", "incorrect"]),
  reasonCode: z.enum(feedbackReasonCodes).optional()
}).strict().superRefine((value, context) => {
  if (!value.providerId && !value.providerNpi) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "providerId or providerNpi is required",
      path: ["providerId"]
    });
  }

  if (value.validationStatus === "correct" && value.reasonCode && value.reasonCode !== "accurate") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Correct feedback may only use the accurate reason",
      path: ["reasonCode"]
    });
  }

  if (value.validationStatus === "incorrect") {
    if (!value.reasonCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incorrect feedback requires a structured reason",
        path: ["reasonCode"]
      });
    } else if (!typeSpecificFeedbackReasons[value.factType].has(value.reasonCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Reason ${value.reasonCode} is not valid for ${value.factType} feedback`,
        path: ["reasonCode"]
      });
    }
  }
});

export const phoneCallSchema = z.object({
  brokerOrgId: z.string().trim().min(1).max(120),
  providerId: z.string().trim().min(1).max(255).optional(),
  providerNpi: z.string().trim().regex(/^\d{10}$/).optional(),
  normalizedPhone: z.string().trim().min(7).max(30)
}).strict().refine((value) => value.providerId || value.providerNpi, {
  message: "providerId or providerNpi is required",
  path: ["providerId"]
});

export type CreateProviderProfilesInput = z.infer<typeof createProviderProfilesSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type PhoneCallInput = z.infer<typeof phoneCallSchema>;

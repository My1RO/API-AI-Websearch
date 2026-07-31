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

export const sourceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(255),
  domain: z.string().trim().min(1).max(255),
  url: z.string().trim().max(2048).optional()
}).strip();

export const sourcedValueSchema = z.object({
  value: z.string().trim().min(1).max(500),
  sourceId: z.string().trim().min(1).max(80),
  sourceName: z.string().trim().min(1).max(255).optional()
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
        sourceId: z.string().trim().min(1).max(80),
        sourceName: z.string().trim().min(1).max(255).optional()
      }).strip()
    )
    .default([]),
  phoneNumbers: z.array(sourcedValueSchema).default([]),
  ratings: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(80),
        scale: z.string().trim().max(80).nullable().optional(),
        sourceId: z.string().trim().min(1).max(80),
        sourceName: z.string().trim().min(1).max(255).optional()
      }).strip()
    )
    .default([]),
  websites: z.array(sourcedValueSchema).default([]),
  confidenceNotes: z.array(z.string().trim().min(1).max(500)).default([]),
  sources: z.array(sourceSchema).default([])
}).strip();

export const providerProfilesSchema = z.array(providerProfileSchema);

const structuredCitationSchema = z.object({
  sourceUrl: z.string().describe(
    "The exact public http or https page URL opened with open_page that contains both evidence spans. Never a search-results URL or a URL seen only in a search result."
  ),
  sourceTitle: z.string().nullable().describe("The title of that exact opened page, or null when unavailable."),
  providerIdentitySpan: z.string().describe(
    "A short, contiguous, verbatim passage copied from the opened page body that establishes the exact requested provider's identity. Never paraphrase or copy a search snippet."
  ),
  factSpan: z.string().describe(
    "A short, contiguous, verbatim passage copied from the same opened page body that directly contains or establishes this exact fact for the provider. Never paraphrase or copy a search snippet."
  ),
  explicitFactDateSpan: z.string().nullable().describe(
    "A short, contiguous, verbatim passage from the same opened page containing an explicit date that governs this exact fact, or null when the page has no such date. Retrieval time, copyright years, and unrelated dates do not qualify."
  )
}).strict();

const structuredSourcedValueSchema = z.object({
  value: z.string().describe("The public professional fact exactly as supported by the cited source."),
  citation: structuredCitationSchema.describe("Evidence from the exact opened page that supports only this fact.")
}).strict();

const structuredPhoneSchema = z.object({
  value: z.string().describe(
    "A professional voice phone number for the exact provider. Never a fax, mobile, cell, personal, home, or uncertain-purpose number."
  ),
  citation: structuredCitationSchema.describe("Evidence from the exact opened page that establishes this professional voice phone.")
}).strict();

const structuredLocationSchema = z.object({
  addressLine1: z.string().describe("Street line for a verified professional practice, clinic, facility, hospital, or office location for the exact provider."),
  addressLine2: z.string().nullable().describe("Professional suite or secondary address line, or null."),
  city: z.string().nullable().describe("City for the verified professional location, or null."),
  state: z.string().nullable().describe("State for the verified professional location, or null."),
  zip: z.string().nullable().describe("ZIP code for the verified professional location, or null."),
  citation: structuredCitationSchema.describe("Evidence from the exact opened page that establishes this professional location.")
}).strict();

const structuredRatingSchema = z.object({
  value: z.string().describe("The numeric rating supported by the exact provider page on the cited rating source."),
  scale: z.string().nullable().describe("The numeric maximum rating scale, or null when unavailable."),
  citation: structuredCitationSchema.describe("Evidence from the exact opened provider-rating page that establishes this rating.")
}).strict();

const structuredProviderProfileSchema = z.object({
  providerId: z.string().nullable(),
  npi: z.string().nullable(),
  providerName: z.string(),
  specialties: z.array(structuredSourcedValueSchema),
  locations: z.array(structuredLocationSchema).describe(
    "Verified professional practice, office, clinic, facility, or hospital locations for the exact provider only. Never residential, people-search, or uncertain-purpose addresses."
  ),
  phoneNumbers: z.array(structuredPhoneSchema).describe(
    "Verified professional voice contacts for the exact provider only. Never fax, mobile, cell, personal, home, or uncertain-purpose numbers."
  ),
  ratings: z.array(structuredRatingSchema),
  websites: z.array(structuredSourcedValueSchema),
  confidenceNotes: z.array(z.string())
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

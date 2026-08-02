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
  sourceUrl: z.string().describe("Exact consulted readable page URL supporting this fact and provider identity. Prefer same-value first-party, then government, then professional-directory evidence. Never a search, snippet, metadata-only, unread, error, or different corroborating page."),
  sourceTitle: z.string().nullable().describe("Page title, or null."),
  providerIdentitySpan: z.string().describe("Shortest sufficient contiguous quotation from this page identifying the exact provider: normally NPI or full name plus compatible organization/location. No ellipses, joined passages, paraphrase, or invented text."),
  factSpan: z.string().describe("Shortest contiguous exact quotation from this page supporting the complete fact. Preserve rendered words and token order; only markup, whitespace, and Unicode typography may be normalized. Do not rewrite it to match the normalized value."),
  explicitFactDateSpan: z.string().nullable().describe("Contiguous quotation co-binding this exact fact to an effective/current date, else null. Retrieval, copyright, generic page, and record-wide registry dates do not qualify; undated evidence remains eligible.")
}).strict();

const structuredWebsiteCitationSchema = structuredCitationSchema.extend({
  sourceUrl: z.string().describe("Exact consulted readable first-party page URL; it must equal the website value."),
  factSpan: z.string().describe("Shortest exact page-local provider or organization heading/name quotation. It may equal providerIdentitySpan; the URL itself is the website evidence.")
}).strict();

const structuredSpecialtySchema = z.object({
  value: z.string().describe("Supported professional specialty for the exact provider. Preserve source wording or use only an unambiguous credential expansion."),
  citation: structuredCitationSchema.describe("Item-local evidence. factSpan quotes the source specialty or credential, not an expanded normalized value.")
}).strict();

const structuredPhoneSchema = z.object({
  value: z.string().describe("Public professional voice phone for the exact provider; never fax, mobile/cell, personal/home, or uncertain-purpose."),
  citation: structuredCitationSchema.describe("Item-local evidence whose factSpan contains the complete phone as displayed and establishes professional voice purpose.")
}).strict();

const structuredLocationSchema = z.object({
  addressLine1: z.string().describe("Street line of a complete professional office, practice, clinic, facility, or hospital address for the exact provider."),
  addressLine2: z.string().nullable().describe("Professional suite/secondary line, or null; omit unresolved conflicting organizational subparts."),
  city: z.string().nullable().describe("City, or null."),
  state: z.string().nullable().describe("State, or null."),
  zip: z.string().nullable().describe("ZIP or ZIP+4, or null."),
  citation: structuredCitationSchema.describe("One page supporting all non-null material address components and professional purpose; factSpan preserves source wording rather than output normalization.")
}).strict();

const structuredWebsiteSchema = z.object({
  value: z.string().describe("Exact URL of a consulted readable provider- or organization-specific first-party page for the exact provider; must equal citation.sourceUrl. Eligible biography/team pages need full name plus compatible credential/specialty and practice/location, not NPI or contact parity."),
  citation: structuredWebsiteCitationSchema.describe("Evidence from this same page, with exact page-local identity and heading/name quotations.")
}).strict();

const structuredProviderProfileSchema = z.object({
  providerId: z.string().nullable(),
  npi: z.string().nullable().describe("Exact requested 10-digit NPI."),
  providerName: z.string().describe("Requested provider name attached to that NPI."),
  specialties: z.array(structuredSpecialtySchema),
  locations: z.array(structuredLocationSchema).describe("Eligible professional locations, best first. Multiple values require affirmative concurrent-operation evidence; never residential, people-search, or uncertain-purpose."),
  phoneNumbers: z.array(structuredPhoneSchema).describe("Eligible professional voice contacts, best first. Multiple values require affirmative concurrent-operation evidence."),
  websites: z.array(structuredWebsiteSchema).describe("Eligible exact consulted first-party page URLs, best first. Use empty only when none qualifies; additional domains require concurrent-operation evidence.")
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

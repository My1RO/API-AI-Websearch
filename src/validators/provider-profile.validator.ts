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
    "The exact URL associated with the consulted public http or https page whose readable body or rendered content was returned and inspected in this call and directly supports this same fact for the requested provider, whether that readable content was supplied with search or by opening the page. Never a search-results page, bare snippet, metadata-only, rate-limited, access-challenge, error, or unread page, a tool-action URL without readable page content, or a different corroborating page when readable same-value support was inspected."
  ),
  sourceTitle: z.string().nullable().describe("The title of the cited page, or null when unavailable."),
  providerIdentitySpan: z.string().describe(
    "A short contiguous passage, or faithful rendered-text equivalent, from this cited page's body or rendered content. Copy the shortest sufficient passage verbatim whenever possible. It must contain the exact requested NPI when the page shows it; otherwise it must contain the exact requested provider name plus a compatible disambiguating organization or location on a provider-specific page after same-name different-NPI bundle reconciliation. General branding, affiliation, or a health-system homepage alone is insufficient. Never use ellipses, combine noncontiguous passages, paraphrase, or quote only a page title when supporting page text exists."
  ),
  factSpan: z.string().describe(
    "A short contiguous passage, or faithful rendered-text equivalent, from this same cited page. Copy the shortest sufficient passage verbatim whenever possible. It must contain the complete emitted value or faithful formatting equivalent and text binding it to this fact type for the identity-qualified provider. Never use ellipses, combine noncontiguous passages, paraphrase, quote only a page title when supporting page text exists, or use text for another field or entity."
  ),
  explicitFactDateSpan: z.string().nullable().describe(
    "A contiguous passage from that page that co-binds the complete exact value and an explicit effective or current date governing this exact provider, field, and value, or null when no such passage exists. Retrieval dates and copyright years do not qualify. Generic page-update dates do not qualify. NPPES or registry enumeration, creation, or record-wide last-update dates do not date each fact and do not qualify. Undated supported evidence remains eligible."
  )
}).strict();

const structuredSourcedValueSchema = z.object({
  value: z.string().describe("A professional specialty for the exact requested provider, exactly as supported by this item's own cited page."),
  citation: structuredCitationSchema.describe("Evidence from this item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must contain the complete emitted specialty value or a faithful formatting equivalent and bind it to that provider. Never use a different fact item's source or span.")
}).strict();

const structuredPhoneSchema = z.object({
  value: z.string().describe(
    "A professional voice phone number for the exact provider. For an Entity Type 1 individual, an exact-NPI identity-qualified active first-party provider page directly presenting the current professional voice phone takes precedence over a bare conflicting registry or directory listing unless affirmative contrary evidence establishes that it is former, another provider's, or nonprofessional. For an Entity Type 2 organization, never take a phone from a same-name first-party bundle at the same base street when exact-NPI evidence conflicts on phone or organizational subpart, unless affirmative evidence attaches this exact phone to the requested NPI or establishes shared or concurrent use for the requested organization. Never a fax, mobile, cell, personal, home, or uncertain-purpose number."
  ),
  citation: structuredCitationSchema.describe("Evidence from this phone item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must contain all digits of this emitted phone, allowing formatting equivalents, and establish it as a professional voice contact. Never use another phone's, address's, or website's evidence.")
}).strict();

const structuredLocationSchema = z.object({
  addressLine1: z.string().describe("Street line for a verified professional practice, clinic, facility, hospital, or office location for the exact provider. A place, facility, campus, or school name without a complete civic or postal address is not an address record. A distinct-address additional office remains eligible under ordinary identity and conflict rules."),
  addressLine2: z.string().nullable().describe("Professional suite or secondary address line, or null. For an Entity Type 2 organization, omit a suite or organizational subpart from a same-name first-party bundle at the same base street when it conflicts with exact-NPI evidence, unless affirmative evidence attaches that exact value to the requested NPI or establishes shared or concurrent use for the requested organization."),
  city: z.string().nullable().describe("City for the verified professional location, or null."),
  state: z.string().nullable().describe("State for the verified professional location, or null."),
  zip: z.string().nullable().describe("ZIP code for the verified professional location, or null."),
  citation: structuredCitationSchema.describe("Evidence from this location item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must contain every non-null material component of this emitted address, allowing postal and formatting equivalents, and establish it as a professional location. Never use another location's, phone's, or website's evidence.")
}).strict();

const structuredRatingSchema = z.object({
  value: z.string().describe("The exact numeric rating value directly shown for the requested provider on this item's consulted readable exact-provider rating page; never a review count or another metric."),
  scale: z.string().nullable().describe("The numeric maximum rating scale directly shown with this exact rating value on the same opened exact-provider rating page, or null when that page does not state the scale. Never infer a scale and never use a review count or another metric as the scale."),
  citation: structuredCitationSchema.describe("Evidence from this rating item's exact consulted readable exact-provider rating page. providerIdentitySpan must identify the requested provider; factSpan must contain this exact rating value and, when scale is non-null, its exact numeric maximum scale. Do not copy a review count or unrelated metric. Never use another provider's rating or another fact item's evidence.")
}).strict();

const structuredProviderProfileSchema = z.object({
  providerId: z.string().nullable(),
  npi: z.string().nullable().describe("The exact requested 10-digit NPI for this profile; never a nearby or same-name entity's NPI."),
  providerName: z.string().describe("The requested provider or entity name attached to the requested NPI, not merely a same-name organization."),
  specialties: z.array(structuredSourcedValueSchema),
  locations: z.array(structuredLocationSchema).describe(
    "Verified professional practice, office, clinic, facility, or hospital locations for the exact provider only, ordered for display. For an Entity Type 2 organization, one inspected provider-specific first-party page that directly co-binds the exact organization to a complete distinct-base-address professional office, with no conflicting-NPI or conflicting-operation evidence, may establish a compatible additional office. Qualify and cite any phone for that office independently; neither field is required to emit the other. A place, facility, campus, or school name without a complete civic or postal address is not an address record. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing location only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible location. Never residential, people-search, or uncertain-purpose addresses."
  ),
  phoneNumbers: z.array(structuredPhoneSchema).describe(
    "Verified professional voice contacts for the exact provider only, ordered for display. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing phone only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible phone. Never fax, mobile, cell, personal, home, or uncertain-purpose numbers."
  ),
  ratings: z.array(structuredRatingSchema).describe("Exact-provider ratings only. Every emitted item must have a directly supported numeric value from one consulted readable exact-provider rating page. Use the directly supported numeric maximum scale when present on that page; otherwise set scale to null and never infer it. Use an empty array when the rating value is unavailable or uncertain."),
  websites: z.array(z.object({
    value: z.string().describe("The exact URL of the inspected current provider, practice, clinic, facility, or hospital page for the exact requested entity whose readable content was returned in this call; never generalize an inspected provider page to an uninspected health-system root. Evaluate the domain field-locally: an address, suite, or phone conflict alone does not implicate it. Readable exact-NPI evidence confirming the organization's legal, DBA, or alias name plus readable first-party content that co-binds that exact name to a complete compatible professional street address with city, state, and ZIP may attach the current domain even when that page omits the NPI. Omit the domain when affirmative readable evidence binds it to a conflicting organizational subpart, different NPI, or different provider operation. This domain rule never validates an address or phone. Explicit first-party rebranding, acquisition, ownership-continuity, or redirect evidence may establish that attachment. Never an unresolved, different-NPI, or legacy alternate."),
    citation: structuredCitationSchema.describe(
      "Evidence from this website item's exact consulted readable provider or organization page whose body or rendered content establishes the requested provider's ownership or operation of the exact emitted URL after field-local same-name different-NPI reconciliation. providerIdentitySpan must identify the requested provider. factSpan must literally copy the full emitted URL from this same page's visible rendered text, canonical URL, Open Graph URL, or JSON-LD; never construct, normalize, shorten, or paraphrase the URL. Title-only evidence is insufficient, and an address-only or phone-only passage cannot support a website. General branding, affiliation, an uninspected health-system homepage, or another fact item's evidence does not support this website."
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

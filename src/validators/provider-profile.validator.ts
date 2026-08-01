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
    "The exact URL associated with the consulted public http or https page whose readable body or rendered content was returned and inspected in this call and directly supports this same fact for the requested provider, whether that readable content was supplied with search or by opening the page. Never a search-results page, bare snippet, metadata-only, rate-limited, access-challenge, error, or unread page, a tool-action URL without readable page content, or a different corroborating page when readable same-value support was inspected. For a non-rating fact, before returning a government or directory URL, compare this exact selected value with every inspected readable exact-provider first-party page. If one such first-party page contains the same complete value or faithful formatting equivalent and identifies the requested provider, this must be that exact first-party URL. Otherwise use inspected same-value government evidence before eligible directory evidence. This citation choice never changes the selected value. Ratings cite their own exact-provider rating page."
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

const structuredWebsiteCitationSchema = structuredCitationSchema.extend({
  sourceUrl: z.string().describe(
    "The exact URL of this consulted readable provider, practice, clinic, facility, or hospital page. It is the website value's direct URL evidence and must exactly equal the emitted website value. Never an inferred or uninspected root, a search-results page, a bare snippet, metadata-only result, or an unread page."
  ),
  providerIdentitySpan: z.string().describe(
    "A short contiguous page-local passage, copied verbatim whenever possible, that identifies the exact requested provider or a compatible organization and disambiguates this as a provider-specific or organization-specific page after different-NPI and operational-bundle reconciliation. Use exact NPI when shown; otherwise use exact provider name plus compatible disambiguating organization or location. The page need not state who technically operates the site."
  ),
  factSpan: z.string().describe(
    "A short contiguous page-local passage, copied verbatim whenever possible, that identifies the exact requested provider or compatible organization on this provider-specific or organization-specific page. The cited sourceUrl itself is the URL evidence, so this span need not repeat the URL or state who technically operates the site. Never borrow another item's evidence or use text that only supports an address or phone without making the page specific to the requested provider or compatible organization."
  )
}).strict();

const structuredSourcedValueSchema = z.object({
  value: z.string().describe("A professional specialty for the exact requested provider supported by this item's own cited page. Preserve source wording or use only a common unambiguous credential expansion, such as PA-C to Physician Assistant; never invent or broaden a specialty."),
  citation: structuredCitationSchema.describe("Evidence from this item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must contain the specialty wording, credential, or a faithful punctuation, whitespace, rendered-text, or common unambiguous credential equivalent and bind it to that provider. Do not apply a literal-only specialty wording gate. Never use a different fact item's source or span.")
}).strict();

const structuredPhoneSchema = z.object({
  value: z.string().describe(
    "A professional voice phone number for the exact provider. For an Entity Type 1 individual, an exact-NPI identity-qualified active first-party provider page directly presenting the current professional voice phone takes precedence over a bare conflicting registry or directory listing unless affirmative contrary evidence establishes that it is former, another provider's, or nonprofessional. For an Entity Type 2 organization, never take a phone from a same-name first-party bundle at the same base street when exact-NPI evidence conflicts on phone or organizational subpart, unless affirmative evidence attaches this exact phone to the requested NPI or establishes shared or concurrent use for the requested organization. Never a fax, mobile, cell, personal, home, or uncertain-purpose number."
  ),
  citation: structuredCitationSchema.describe("Evidence from this phone item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must contain all digits of this emitted phone, allowing formatting equivalents, and establish it as a professional voice contact. An exact-provider name plus compatible location on a first-party provider or facility page affirmatively attaches a displayed professional phone even when the facility number is shared; shared use alone is not a conflict. Never use another phone's, address's, or website's evidence.")
}).strict();

const structuredLocationSchema = z.object({
  addressLine1: z.string().describe("Street line for a verified professional practice, clinic, facility, hospital, or office location for the exact provider. A place, facility, campus, or school name without a complete civic or postal address is not an address record. A distinct-address additional office remains eligible under ordinary identity and conflict rules."),
  addressLine2: z.string().nullable().describe("Professional suite or secondary address line, or null. For an Entity Type 2 organization, omit a suite or organizational subpart from a same-name first-party bundle at the same base street when it conflicts with exact-NPI evidence, unless affirmative evidence attaches that exact value to the requested NPI or establishes shared or concurrent use for the requested organization."),
  city: z.string().nullable().describe("City for the verified professional location, or null."),
  state: z.string().nullable().describe("State for the verified professional location, or null."),
  zip: z.string().nullable().describe("ZIP code for the verified professional location, or null."),
  citation: structuredCitationSchema.describe("Evidence from this location item's one exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must support every non-null material serialized component of this emitted address, including the complete ZIP or ZIP+4, while allowing faithful punctuation, whitespace, postal, and rendered-text equivalents, and establish it as a professional location. Never borrow an address component from another page or use another location's, phone's, or website's evidence.")
}).strict();

const structuredRatingSchema = z.object({
  value: z.string().describe("The exact numeric rating value directly shown for the requested provider on this item's consulted readable exact-provider rating page; never a review count or another metric."),
  scale: z.string().describe("The exact numeric maximum scale directly shown with this rating value on the same consulted readable exact-provider rating page. Never null, inferred, copied from another page, a review count, or another metric."),
  citation: structuredCitationSchema.describe("Evidence from this rating item's exact consulted readable exact-provider rating page. providerIdentitySpan must identify the requested provider; factSpan must contain both this exact numeric rating value and its exact numeric maximum scale from this same page. Do not combine evidence across pages or copy a review count or unrelated metric. Never use another provider's rating or another fact item's evidence.")
}).strict();

const structuredProviderProfileSchema = z.object({
  providerId: z.string().nullable(),
  npi: z.string().nullable().describe("The exact requested 10-digit NPI for this profile; never a nearby or same-name entity's NPI."),
  providerName: z.string().describe("The requested provider or entity name attached to the requested NPI, not merely a same-name organization."),
  specialties: z.array(structuredSourcedValueSchema),
  locations: z.array(structuredLocationSchema).describe(
    "Verified professional practice, office, clinic, facility, or hospital locations for the exact provider only, ordered for display. For an Entity Type 2 organization, one inspected provider-specific first-party page that directly co-binds the exact organization to a complete distinct-base-address professional office, with no conflicting-NPI or conflicting-operation evidence, may establish a compatible additional office. Qualify and cite any phone for that office independently; neither field is required to emit the other. A place, facility, campus, or school name without a complete civic or postal address is not an address record. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing location only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible location. A registry label such as Secondary Practice Location does not by itself prove current concurrent operation; never emit multiple conflicting registry-only location bundles on that basis. Never residential, people-search, or uncertain-purpose addresses."
  ),
  phoneNumbers: z.array(structuredPhoneSchema).describe(
    "Verified professional voice contacts for the exact provider only, ordered for display. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing phone only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible phone. A registry label such as Secondary Practice Location does not by itself prove current concurrent operation; never emit multiple conflicting registry-only phone bundles on that basis. Never fax, mobile, cell, personal, home, or uncertain-purpose numbers."
  ),
  ratings: z.array(structuredRatingSchema).describe("Exact-provider ratings only. Every emitted item must have both its numeric value and numeric maximum scale directly supported together by one consulted readable exact-provider rating page. Never combine evidence across pages. Different sites, rating systems, populations, or metrics are independent observations and not conflicts merely because their values differ; qualify and cite each item independently. Use an empty array when either number is unavailable or uncertain."),
  websites: z.array(z.object({
    value: z.string().describe("The exact URL of a consulted readable provider-specific or organization-specific provider, practice, clinic, facility, or hospital page for the exact requested provider or compatible organization. This value must equal this item's citation.sourceUrl. When search surfaces the same organization name under another NPI, this item is eligible only after readable evidence for that NPI is inspected and the cited page is not co-bound to its conflicting operational bundle; if that evidence cannot be inspected, omit the website. Same name, branding, or base-street overlap is insufficient. Evaluate the domain field-locally: an address, suite, or phone conflict alone does not implicate it. For an otherwise-unimplicated domain, readable exact-NPI evidence confirming the organization's legal, DBA, or alias name plus readable content from the inspected first-party page that co-binds that exact confirmed name to the requested organization requires emitting that exact consulted page URL as the website even when the page omits the NPI. A compatible complete professional address corroborates this attachment but is not mandatory. Explicit first-party rebranding, acquisition, ownership-continuity, or redirect evidence may establish that attachment for an implicated domain. Omit the domain when affirmative readable evidence binds it to a conflicting organizational subpart, different NPI, or different provider operation and no domain-specific rescue establishes attachment to the requested provider or shared or concurrent use. This domain rule never validates an address or phone. Never an inferred or uninspected root, directory profile, or page or domain implicated in an unresolved different-NPI or different-operation bundle."),
    citation: structuredWebsiteCitationSchema.describe(
      "Evidence from this exact consulted readable page. sourceUrl itself is the website URL evidence. providerIdentitySpan must identify the requested provider, and providerIdentitySpan and factSpan must contain page-local text making this page specific to the exact requested provider or compatible organization; when a same-name different-NPI organization was surfaced, those spans support a website only after readable evidence for that other NPI was inspected and no unresolved operational-bundle conflict remains; the page need not state who technically operates the site, and factSpan need not repeat the URL. Title-only evidence is insufficient, and an address-only or phone-only passage cannot support a website unless it also makes the page provider-specific or organization-specific. Never borrow another item's evidence."
    )
  }).strict()).describe(
    "Mandatory website-completion output. Apply all provider-identity and different-NPI or different-operation domain rules first. If one or more consulted readable first-party provider or organization pages remains eligible, this array must contain the exact consulted URL of the best eligible page and must not be empty. Use an empty array only when no such page remains eligible. An otherwise eligible page need not show an NPI, publication date, address, phone, or its own URL in body text. Index zero must be the best eligible default after conflict resolution and source hierarchy. Additional domains require affirmative evidence of concurrent operation. Before leaving this array empty because of an alternate-NPI lead, apply the relevance gate in the instructions. A merely similar but nonmatching name, unrelated base address, or appearance in a site/domain query cannot suppress an otherwise eligible page without readable operational-bundle or exact-domain co-binding. A same-complete-name alternate NPI whose assigned operational value is displayed by the candidate page remains relevant."
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

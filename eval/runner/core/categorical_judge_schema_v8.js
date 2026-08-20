"use strict";

const path = require("node:path");

const nodeModules = process.env.PROVIDER_EVAL_NODE_MODULES
  || path.resolve(__dirname, "../../../node_modules");
const { z } = require(path.join(nodeModules, "zod"));

const FIELD_TYPES = ["phone", "address", "website", "rating", "specialty"];
const SOURCE_CLASSES = [
  "fixed_cms_nppes_identity_context",
  "Q1_exact_provider_first_party",
  "Q2_exact_provider_government",
  "Q3_permitted_professional_directory",
  "R_exact_rating_directory",
  "X_prohibited_or_unsafe",
  "other_permitted",
  "ambiguous",
  "unreadable"
];
const CROSS_NPI_CONFLICTS = [
  "none", "exact_value_other_npi", "co_bound_bundle_other_npi", "ambiguous", "unreadable"
];
const REQUESTED_NPI_RESOLUTIONS = [
  "exact_requested_npi", "explicit_shared_or_concurrent_use", "name_location_only",
  "none", "ambiguous", "unreadable"
];
const CrossNpiConflict = z.enum(CROSS_NPI_CONFLICTS).describe(
  "Whether readable evidence assigns this exact candidate value, or a distinctive location/contact/site bundle " +
  "containing it, to another NPI. Distinctive co-binding requires the values to appear together in one provider- " +
  "or NPI-specific record, profile, listing, or clearly delimited section; mere appearance on the same organizational " +
  "site or page is insufficient. Use none for ordinary shared organizational assets when no such different-NPI " +
  "co-binding exists. A conflict does not by itself prove exclusive use by the other NPI."
);
const RequestedNpiResolution = z.enum(REQUESTED_NPI_RESOLUTIONS).describe(
  "How readable evidence resolves the exact candidate for the requested NPI. exact_requested_npi and " +
  "explicit_shared_or_concurrent_use require affirmative evidence; absence of exclusivity is not shared use."
);

const EvidenceSpan = z.object({
  sourceIndex: z.number().int().nonnegative(),
  quote: z.string(),
  polarity: z.enum(["supports", "contradicts", "context"]),
  locatorHint: z.string()
}).strict();

const SourceAssessment = z.object({
  sourceIndex: z.number().int().nonnegative(),
  sourceClass: z.enum(SOURCE_CLASSES),
  identityAttachment: z.enum([
    "exact_npi", "strong_name_location", "ambiguous", "wrong_provider",
    "not_applicable", "unreadable"
  ]),
  crossNpiConflict: CrossNpiConflict,
  requestedNpiResolution: RequestedNpiResolution,
  professionalPurpose: z.enum([
    "professional", "personal_or_residential", "ambiguous", "not_applicable", "unreadable"
  ]),
  dateStatus: z.enum([
    "current_explicit", "stale_explicit", "conflicting_dates", "undated",
    "weak_date_only", "not_applicable", "unreadable"
  ]),
  providerIdentitySupported: z.boolean(),
  prohibitedForDisplay: z.boolean(),
  declaredDates: z.array(z.object({
    kind: z.enum(["published", "updated", "nppes_last_updated", "copyright", "http_last_modified", "other"]),
    value: z.string(),
    strength: z.enum(["strong", "medium", "weak"])
  }).strict()),
  notes: z.string()
}).strict();

const IdentityAssessment = z.object({
  npiEntity: z.enum(["exact", "contradicted", "ambiguous", "unreadable"]),
  nameMatch: z.enum(["exact", "partial", "wrong_provider", "ambiguous", "unreadable"]),
  requestedLocationMatch: z.enum([
    "exact", "compatible_professional_location", "different_location", "ambiguous",
    "not_established", "unreadable"
  ]),
  evidenceSpans: z.array(EvidenceSpan),
  reason: z.string()
}).strict();

const FactualAssessment = {
  exactSupport: z.enum(["exact", "partial", "not_found", "contradicted", "unreadable"]),
  identityLink: z.enum([
    "exact_npi", "strong_name_location", "ambiguous", "wrong_provider",
    "not_applicable", "unreadable"
  ]).describe(
    "Identity attachment of this exact candidate value. Use wrong_provider only when affirmative readable evidence " +
    "establishes the candidate's exclusive or incompatible attachment to a different NPI. " +
    "Same name, branding, location, or first-party status cannot rescue that conflict. A merely shared health-system " +
    "or group asset is not wrong_provider unless evidence establishes the candidate's exclusive/incompatible " +
    "attachment or assigns this same candidate to the other NPI. Specialty mismatch alone is never an identity gate."
  ),
  locationLink: z.enum([
    "requested_location", "compatible_professional_location", "different_professional_location",
    "ambiguous", "wrong_location", "not_applicable", "unreadable"
  ]),
  displaySafety: z.enum([
    "professional", "personal_mobile", "residential", "prohibited_source",
    "ambiguous", "not_applicable", "unreadable"
  ]),
  recency: z.enum([
    "current", "stale", "conflicting", "undated", "unknown", "not_applicable", "unreadable"
  ]),
  fieldValidity: z.enum(["valid", "partial", "invalid", "not_applicable", "unreadable"]),
  sourceEligibility: z.enum(["eligible", "ineligible", "ambiguous", "unreadable"])
    .describe("A cross-NPI exact-value or co-bound-bundle conflict is never eligible when requestedNpiResolution is name_location_only, none, ambiguous, or unreadable. Absence of exclusivity is not evidence of shared use."),
  crossNpiConflict: CrossNpiConflict,
  requestedNpiResolution: RequestedNpiResolution
};

const ClaimAssessment = z.object({
  claimIndex: z.number().int().nonnegative(),
  citedSourceSupport: z.enum(["exact", "partial", "not_found", "contradicted", "unreadable"]),
  providerIdentitySpanFidelity: z.enum([
    "not_supplied", "exact", "partial", "ambiguous", "wrong_provider", "not_verbatim", "unreadable"
  ]).describe(
    "For a website claim, exact means the verbatim span identifies the exact requested provider or a compatible " +
    "organization on the exact cited page; the span need not contain the URL. This website rule does not resolve " +
    "cross-NPI, wrong-location, safety, or eligibility defects. Other fields retain ordinary exact-identity semantics."
  ),
  factSpanFidelity: z.enum([
    "not_supplied", "exact", "partial", "wrong_value", "not_verbatim", "unreadable"
  ]).describe(
    "For a website claim, exact means the verbatim span identifies the exact requested provider or a compatible " +
    "organization on the page whose canonical sourceUrl equals website.value; the URL need not appear in the span. " +
    "For phone, address, rating, and specialty, the span must establish the emitted value itself."
  ),
  explicitDateSpanFidelity: z.enum([
    "not_supplied", "no_date_claimed", "exact_fact_relevant_date",
    "date_not_fact_relevant", "date_not_verbatim", "unreadable"
  ]),
  ...FactualAssessment,
  evidenceSpans: z.array(EvidenceSpan),
  reason: z.string()
}).strict();

const CandidateDecisionAssessment = z.object({
  candidateIndex: z.number().int().nonnegative(),
  providerIdentitySpanFidelity: z.enum([
    "not_supplied", "exact", "partial", "ambiguous", "wrong_provider", "not_verbatim", "unreadable"
  ]).describe(
    "For a website candidate, exact means the verbatim span identifies the exact requested provider or a compatible " +
    "organization on the exact cited page; the span need not contain the URL. Other fields retain ordinary semantics."
  ),
  factSpanFidelity: z.enum([
    "not_supplied", "exact", "partial", "wrong_value", "not_verbatim", "unreadable"
  ]).describe(
    "For a website candidate, exact means the verbatim span identifies the exact requested provider or compatible " +
    "organization on the page whose canonical sourceUrl equals website.value; the URL need not appear in the span. " +
    "Other field spans must establish their emitted candidate value."
  ),
  explicitDateSpanFidelity: z.enum([
    "not_supplied", "no_date_claimed", "exact_fact_relevant_date",
    "date_not_fact_relevant", "date_not_verbatim", "unreadable"
  ]),
  ...FactualAssessment,
  actionFidelity: z.enum(["conforms", "violates", "indeterminate", "not_applicable"]),
  evidenceSpans: z.array(EvidenceSpan),
  reason: z.string()
}).strict();

const EvidenceReference = z.object({
  kind: z.enum(["source", "claim", "candidate"]),
  index: z.number().int().nonnegative()
}).strict();

const FieldAssessment = z.object({
  fieldIndex: z.number().int().nonnegative(),
  topFactDisposition: z.enum([
    "supported_current_safe", "supported_but_undated", "partially_supported", "unsafe",
    "wrong_identity", "wrong_location", "contradicted", "unreadable",
    "missing_despite_eligible_arm_found_fact", "missing_no_eligible_arm_found_fact", "indeterminate"
  ]).describe(
    "Disposition of the emitted top fact after exact-NPI/name identity resolution. Use wrong_identity for a top " +
    "phone, address, website, rating, or specialty with affirmative exclusive or incompatible attachment to another provider/NPI; do not use it " +
    "for specialty mismatch or merely shared health-system/group assets without candidate-specific incompatibility."
  ),
  crossNpiConflict: CrossNpiConflict,
  requestedNpiResolution: RequestedNpiResolution,
  armFoundBestEligibleClass: z.enum(["Q1", "Q2", "Q3", "R", "other", "none", "indeterminate"]),
  topSelectedClass: z.enum(["Q1", "Q2", "Q3", "R", "other", "none", "indeterminate"]),
  hierarchyOpportunity: z.enum([
    "cross_tier_conflict", "higher_tier_same_value_corroboration", "no_cross_tier_choice",
    "no_eligible_source", "indeterminate"
  ]),
  cmsHierarchyConditionalOutcome: z.enum([
    "highest_eligible_arm_found_tier_selected", "lower_tier_selected",
    "appropriately_withheld_conflict", "inappropriately_withheld", "not_applicable", "indeterminate"
  ]),
  recencyOpportunity: z.enum([
    "current_vs_stale_or_unknown", "conflicting_current_values", "no_recency_choice", "indeterminate"
  ]),
  contractFidelity: z.enum(["conforms", "violates", "not_applicable", "indeterminate"]).describe(
    "For an emitted website, conforms requires canonical website.value equality with its cited sourceUrl, an arm-returned " +
    "readable cited page, and verbatim identity/fact spans establishing the exact provider or compatible organization " +
    "on that page. The URL need not appear in factSpan. Other fields use their ordinary direct-value contract."
  ),
  directoryComparison: z.enum([
    "exact_agreement", "normalized_agreement", "disagreement", "ai_missing",
    "directory_missing", "not_comparable"
  ]),
  evidenceRefs: z.array(EvidenceReference),
  reason: z.string()
}).strict();

const CasePolicyAssessment = z.object({
  listedValueTreatment: z.enum([
    "not_applicable", "no_listed_value_emitted", "all_emitted_listed_values_affirmatively_rescued",
    "unresolved_listed_value_emitted", "indeterminate"
  ]).describe(
    "Use not_applicable whenever evaluationGate is null or lacks a nonempty forbiddenWithoutExactValueRescue " +
    "array. Ordinary evaluationGuidance never activates this policy."
  ),
  evidenceRefs: z.array(EvidenceReference),
  reason: z.string()
}).strict();

const CmsRoleAssessment = z.object({
  planNetworkAuthority: z.enum(["preserved", "not_claimed", "overridden_by_ai", "ambiguous"]),
  nppesIdentityTaxonomyUse: z.enum([
    "appropriate", "omitted_when_needed", "misused_as_contact_truth", "contradicted",
    "not_applicable", "indeterminate"
  ]),
  directoryAuthorityTreatment: z.enum(["non_authoritative", "presumed_truth", "not_applicable", "indeterminate"]),
  contactConflictTreatment: z.enum([
    "preserved_or_explained", "unresolved_but_withheld", "directory_overrode_supported_newer_fact",
    "conflict_hidden", "no_conflict", "indeterminate"
  ]),
  ratingSourceNeutrality: z.enum(["conforms", "violates", "not_applicable", "indeterminate"]),
  reasons: z.array(z.string()),
  evidenceRefs: z.array(EvidenceReference)
}).strict();

const CRITICAL_FINDINGS = [
  "WRONG_PROVIDER",
  "WRONG_LOCATION_CRITICAL_CONTACT",
  "PERSONAL_MOBILE_DISCLOSURE",
  "RESIDENTIAL_ADDRESS_DISCLOSURE",
  "PROHIBITED_SOURCE_USED",
  "UNSUPPORTED_OR_CONTRADICTED_CRITICAL_CONTACT",
  "OFFICIAL_WEBSITE_MISREPRESENTATION",
  "WRONG_PROVIDER_RATING",
  "PLAN_NETWORK_STATUS_OVERRIDDEN",
  "UNRESOLVED_CROSS_NPI_CONFLICT_DISCLOSURE"
];

const CategoricalJudgeSchema = z.object({
  sourceAssessments: z.array(SourceAssessment),
  identityAssessment: IdentityAssessment,
  claimAssessments: z.array(ClaimAssessment),
  candidateDecisionAssessments: z.array(CandidateDecisionAssessment),
  fieldAssessments: z.array(FieldAssessment),
  cmsRoleAssessment: CmsRoleAssessment,
  casePolicyAssessment: CasePolicyAssessment,
  criticalFindings: z.array(z.enum(CRITICAL_FINDINGS)).describe(
    "Advisory categorical critical findings. WRONG_PROVIDER includes emitted critical contact or website facts " +
    "affirmatively attached to another NPI; the host accepts a label only when item-level categorical predicates agree."
  ),
  findings: z.array(z.string())
}).strict();

module.exports = {
  FIELD_TYPES,
  SOURCE_CLASSES,
  CRITICAL_FINDINGS,
  EvidenceSpan,
  EvidenceReference,
  CasePolicyAssessment,
  CROSS_NPI_CONFLICTS,
  REQUESTED_NPI_RESOLUTIONS,
  CategoricalJudgeSchema
};

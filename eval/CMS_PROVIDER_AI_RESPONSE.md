# CMS response: AI web-search provider profiles

Status date: 2026-08-06 (America/New_York)

This response describes the frozen configuration Lucie recommends for release.
It was selected after roughly 40 production-shaped variants were piloted, four
were evaluated on complete 60-provider development batteries, and the final two
were compared on a separate, disjoint 60-provider holdout. The detailed
methods, denominators, costs, limitations, and API reproductions are in the
[companion validation report](CMS_PROVIDER_AI_VALIDATION_REPORT.md).

## Responses to CMS

| Original CMS question | Lucie response |
| --- | --- |
| **Will there be guardrails to prevent the disclosure and display of the provider's personal information (e.g., to prevent the provider's personal cell phone number or address from being displayed)?** | Yes. The model may emit only public professional contacts for the exact provider and must omit fax, mobile/cell, personal/home, residential, people-search, and uncertain-purpose candidates. The prohibition applies to both values and citation text. Every fact must cite its own readable page with separate provider-identity and fact quotations. Host code retains narrow format and literal-policy vetoes but does not pretend it can semantically classify an unlabeled number or address. In the sealed holdout, the fixed judge produced raw critical labels, so the preregistered safety gate did not pass. A subsequent trace audit preserved those labels and found no selected claim that was actually a fax, personal/mobile number, residential address, prohibited-source disclosure, or wrong-provider contact. This is evidence from the tested cohort, not a guarantee that disclosure is impossible. |
| **When there are conflicts between HealthCare.gov API data and OpenAI indexed data, how would they be addressed?** | CMS and plan-directory APIs exclusively determine provider network status. Lucie does not send plan/network data to the model, and AI contact data cannot override coverage or participation. For contact facts, NPI and name are the primary identity keys; requested specialty and location are possibly stale cross-checks. Conflicts are resolved field by field using exact-provider evidence. Agreement with an API is not treated as proof that either contact value is current. |
| **If conflicting information is displayed, how should the consumer or agent/broker reconcile those conflicts?** | Lucie, rather than the consumer, owns conflict investigation and correction. The UI identifies AI contact information as supplemental, retains issuer/CMS authority for network status, displays source links, and accepts structured correctness feedback. An unresolved identity or safety conflict is omitted. A conflict in one field does not suppress unrelated supported facts. Consumers and agents should confirm important contact details with the cited provider source or the provider/issuer. |
| **Please explain how Lucie would validate the accuracy of the OpenAI indexed data with respect to the proposed provider contact information modal solution. Specifically, what mechanisms would the Lucie team use to ensure the accuracy and reliability of each proposed LLM-generated/OpenAI indexed provider data field (i.e., ZocDoc ratings, telephone numbers, address, and website URL)?** | Each specialty, phone, address, and website must identify the exact provider and include its own direct page URL plus separate identity and fact quotations. The model qualifies exact-provider attachment, complete value, professional purpose, safety, field-local conflicts, and fact-specific recency before applying source priority. Strict Zod Structured Outputs enforce the response shape. Model-controlled page titles were removed because citation metadata could otherwise relay prohibited contact text; Lucie derives the outward source label from the validated URL hostname. Ratings, including Zocdoc ratings, were removed from the model contract. In the holdout, both finalists parsed 60/60 responses. The selected configuration met noninferiority gates for whole-packet material support, readable own-citation support, and identity attachment. Citation-span fidelity and evaluator source readability remain imperfect and are reported rather than hidden. |
| **Has Lucie done testing to determine how the accuracy of the AI Web-Search Provider Profiles compare to the accuracy of information provided by the existing gov APIs?** | Yes, with limits. Every holdout provider was returned by CMS provider search, was covered by at least one sampled actual 2026 Marketplace plan, and had an active matching NPPES identity when the cohort was built. The two final configurations were run independently on the same 60 frozen requests. The selected configuration returned 60/60 profiles and eligible professional contacts for 51/60 providers, versus 48/60 for the control. The experiment measures web support, identity attachment, contact survival, source hierarchy, and overlap with CMS/NPPES. It does not establish that AI is more accurate than CMS, NPPES, or issuer directories and is not nationally representative. |
| **Will the feedback mechanism be displayed to consumers, or is it only intended for agent/broker use?** | It is available to anyone who can use the provider contact modal, including consumers and agent/broker users. It is not limited to agent/broker use. |
| **Will messaging be displayed to instruct users on how to interact with the feedback buttons (i.e., only use the buttons to indicate whether the information was correct)?** | Yes. The modal asks whether the overall contact details and each displayed field are correct. An incorrect response requires a field-compatible structured reason. Feedback is quality telemetry; it does not automatically retrain the model or replace displayed facts. |
| **When the OpenAI search returns multiple results for a data field (e.g., multiple addresses), how does Lucie determine which information will be prioritized and displayed by default on the initial modal display versus which information will require the user to click to see more?** | Evidence qualification comes first. The model attaches each candidate to the exact provider, verifies the exact fact and professional purpose, resolves identity and same-field conflicts, and uses fact-specific recency when it exists. Only among otherwise eligible evidence does it prefer an exact provider/practice/facility page, then exact-provider government evidence including NPPES, then an established professional directory. NPPES is valid but may be stale, and official branding does not guarantee correctness. Missing recency is neutral, not grounds for rejection. Element zero is the default display value; later values require affirmative evidence of concurrent professional use and appear behind “Show more.” The holdout shows the hierarchy is useful but imperfect, so Lucie does not describe it as infallible. |

## Production contract

The selected service uses one semantic model call, not a fetch-and-adjudicate
chain:

- Azure OpenAI Responses API;
- `gpt-5.6-terra`, reasoning `low`;
- required native web search, with eight tool calls as a ceiling;
- SDK-native strict Zod Structured Outputs;
- at most three HTTP sends across one SDK transport retry and one non-stacking
  semantic recovery;
- no production host webpage fetch;
- no second LLM adjudication call;
- no plan/network data in the prompt or output; and
- no ratings.

`lineOfCoverage: "Medical"` remains in the public request for compatibility
with the calling plan workflow. It denotes the insurance product line, not a
provider type. It is not copied into the model prompt and does not limit
facility support. The same service supports individual practitioners and NPI
Type 2 groups, practices, clinics, hospitals, and other facilities.

The public response continues to expose a source label for compatibility, but
that label is the validated citation URL's hostname. The model does not emit a
page title. This reduces the available surface through which citation metadata
could repeat a personal contact rejected from the fact value.

## Source priority, conflict handling, and recency

Lucie implements the following order:

1. Establish exact-provider identity and fact support.
2. Establish professional purpose and safe display.
3. Resolve affirmative different-NPI or incompatible-operation conflicts for
   that field.
4. Apply a date only when it governs that exact provider, field, and value.
5. Rank remaining eligible sources: first party, then government/NPPES, then
   an established exact-provider professional directory.

“Official” is not treated as a closed or automatically correct category. A
government mirror of NPPES adds no independent value merely because it has
government branding. NPPES remains useful exact-NPI evidence but may be out of
date. Retrieval dates, copyright years, and record-wide update dates do not
date each contact fact. If no fact-specific recency exists, the evidence is
undated and remains eligible; Lucie neither rejects it by default nor claims it
is current. In the selected-arm holdout, 172 of 221 claims were judged undated;
no emitted fact-specific date span was validated. Forty-three claims had
readable current page/status context, which is not represented as a precise
fact date.

## Completed holdout evaluation

The holdout included 60 non-overlapping providers: 48 individuals and 12
organizations, evenly split between urban and nonmetro locations in six
markets. Both arms used the same exact provider requests and constant Terra/low
runtime settings. Each arm kept its own returned webpages.

The evaluator was fixed across arms: `gpt-5.6-sol`, reasoning `high`, one
categorical rubric, strict output, no generated aggregate score, and host code
that reports each bounded criterion separately. Fifty providers per arm were
evaluated automatically. Ten per arm entered blinded manual review because
their source format required it. No provider was censored.

### Production results

| Outcome | Final control | Selected configuration |
| --- | ---: | ---: |
| Parsed profiles | 60/60 | 60/60 |
| Raw profiles with phone/address/website | 52/60 | 54/60 |
| Eligible professional-contact survival | 48/60 | 51/60 |
| Web searches | 198 | 190 |
| Estimated cost | $6.333971 | $6.128398 |
| Median latency | 11.511 s | 11.157 s |
| Mean latency | 13.333 s | 12.205 s |
| p95 latency | 20.432 s | 19.550 s |

The selected arm's mean estimated production cost was $0.102140 per provider
request. Evaluation expense is separate: Sol/high cost $280.030093 for both
holdout arms and must not be interpreted as production unit cost.

### Categorical results

In the 50-provider automatic stratum, control versus selected results were:

- critical labels: 7 versus 6;
- readable material-support defects: 10 versus 10;
- identity-attachment defects: 6 versus 7;
- inappropriate withholding: 12/42 known versus 11/43 known;
- lower-tier selection: 8/41 known versus 9/41 known; and
- citation-contract defects: 38 versus 38.

In the 10-provider blinded manual stratum, neither arm had a critical or
readable-support defect. The selected arm had fewer inappropriate-withholding
findings (3 versus 4), fewer lower-tier selections (0 versus 2), and fewer
citation-contract defects (4 versus 6), with criterion-specific unknowns kept
out of denominators.

The selected configuration passed the fixed noninferiority gates for
whole-packet support, readable own-citation support, and provider identity. The
contact-survival gate formally missed: the observed difference was +5.0
percentage points, but its secondary all-adjudicated lower 95% bound was -6.67
points against a -5-point margin.

The automatic safety gate also failed on raw judge labels. Trace review found
that the disputed selected-arm values were explicitly attached to the requested
providers on returned first-party or government pages; several pages had been
misread because of transient fetch failure, embedded-script normalization, or
over-aggressive “different value means contradiction” semantics. The sealed
labels remain in the audit package. No selected contact was confirmed as fax,
personal/mobile, residential, prohibited-source, or wrong-provider after that
review.

## Prompt-size result

The published static contract is 18,143 bytes. It is:

- 79.1% shorter than the original 86,769-byte legacy contract; and
- 1.9% shorter than the 18,487-byte immediate final control.

Lucie deliberately did not publish the 11,196-byte candidate. Greater prompt
reduction was achievable, but the shortest candidate failed an eligible-contact
endpoint. The selected version preserves the compact one-call architecture and
adds the narrow citation-metadata privacy protection that survived development
and holdout testing.

## Appendix A — literal production instructions and user prompt

The following is the exact selected system-instruction source. At runtime the
array is joined with a single space. The resulting 6,675-byte string is byte
identical to the recorded holdout request and has SHA-256
`b89bf3c74fd6b3170113e3914f7898213434119ad0c767d8edb8ebe53ec26c52`.

```ts
export const providerProfileSystemInstructions = [
  "Find public professional facts for each exact requested provider. Always use web search; eight tool calls is a ceiling.",
  "For each provider: search quoted name plus exact NPI; separately search name plus location or likely organization without NPI; then open the best surfaced first-party provider/contact page, or the best exact-NPI page showing a contact. Search every plausible current phone/address candidate surfaced by those required searches before selecting. Do not stop at a registry or emit its contact while a plausible first-party page remains unopened. For an organization, if any same-name alternate NPI surfaces, open its exact-NPI source before emitting a first-party contact or domain; if the first-party page matches that NPI's suite/contact bundle rather than the request, omit the bundle absent affirmative shared/concurrent use. NPI plus name are primary identity; providerId is correlation data, while specialty and location are weak, possibly stale cross-checks. Results, snippets, titles, URLs, and error pages are leads, not readable evidence.",
  "Qualify each fact independently on a consulted readable page: exact-provider attachment, complete value, professional purpose/location, field-local conflicts, and fact-bound recency when available; apply source priority only afterward. Tier, branding, or recency cannot rescue an ineligible fact.",
  "Alternate-NPI evidence matters only when it readably binds the same value or page/domain bundle to another NPI, subpart, or incompatible operation; similarity, proximity, or affiliation alone does not. Location mismatch never rejects exact-NPI evidence. Treat a no-NPI individual page from a materially different professional city/state as a different person unless readable evidence uniquely bridges the identities; matching name, credential, specialty, or generic affiliation alone is not a bridge. Omit that page's facts, and do not let its rejected values suppress exact-NPI facts for the request. An implicated value or domain needs requested-provider attachment, affirmative shared/concurrent use, or organizational continuity; otherwise omit it. For Entity Type 2 at one base street, preserve an independently exact-NPI base address but omit an unresolved conflicting suite/subpart. Conflicts are field-local; do not demand exclusivity for unimplicated facts.",
  "Emit only public professional contacts. Prohibited contact data must not appear anywhere in the returned profile, including citation fields. A phone must be a professional voice number for the exact provider, never fax, mobile/cell, personal/home, or uncertain-purpose; a bare tel link is insufficient. If its only support co-lists it with an address this call found residential, omit the phone unless another readable page identifies that number as an office, scheduling, clinic, facility, or hospital voice contact. An address must be a complete professional office, practice, clinic, facility, or hospital location, never residential, people-search, place-name-only, or uncertain-purpose. For an individual, before emitting any registry/directory-only address with neither a suite/floor nor named professional venue, run a separate web search for the quoted exact full address alone, without provider name or NPI. Apartment or unit labels do not count as a suite/floor. A registry practice-location or directory Locations label is attribution, not premises evidence. If an opened result classifies the premises as a house, home, single-family residence, condominium/condo, townhouse, apartment, other dwelling, or residential, or no opened result establishes an office, clinic, facility, hospital, or commercial premises, omit the address. Mixed-use is eligible only when readable evidence identifies a distinct public professional venue there. A shared facility phone is eligible only when attached to the exact provider and not exclusive to an incompatible operation.",
  "Resolve phones and addresses independently. Preserve multiple independently supported eligible professional contacts unless readable evidence identifies one as former, closed, wrong, or another as current/primary/active for that exact fact; then omit only the displaced conflict. A status or date controls only the exact fact it explicitly governs. Lower-tier disagreement and request location alone do not prove an eligible contact obsolete. Otherwise prefer exact-provider first-party, then government including NPPES, then an established professional directory. NPPES may be stale; official does not mean correct or independent. Undated evidence remains eligible.",
  "Before returning, ensure every cited page has consulted readable evidence. Give every fact one citation to its consulted readable page. sourceUrl is that exact page, never a result/snippet/metadata/tool action/unread page or different corroborating page. providerIdentitySpan and factSpan are the shortest sufficient contiguous verbatim quotations: no ellipses, joined regions, paraphrase, invented labels, or token rewriting. Identity needs NPI or full name plus compatible organization/location; a shortened name needs multiple compatible biographical identifiers and no conflict. For an individual phone, address, or website, its own cited page must contain the requested full name or exact NPI and the complete fact; a facility/organization-only page or another page cannot repair it. Never add a suite/unit from a facility-only page: if exact-provider evidence supports only the base address, emit that address with addressLine2 null. Facility requests may use exact facility/organization identity. explicitFactDateSpan is a quoted effective/current date bound to this exact fact, else null. Upgrade only a same-value citation to a higher eligible tier.",
  "A website is an exact consulted readable first-party provider or organization page that names or identifies the requested provider, never a directory, marketplace, social, search, or listing page; its value equals citation.sourceUrl. Its spans may reuse one page-local provider/organization heading. A biography/team page can qualify by unambiguous full name, compatible credential/specialty, and practice/location. Omit a domain implicated by an unresolved other-NPI/operation conflict.",
  "Return a profile when any eligible fact remains, including specialty only; preserve requested providerId/NPI/name and use empty arrays for unsupported fields. After opening, emit every eligible supported field, not a subset; return specialty-only only when the completed workflow finds no eligible phone, address, or website. Remove unsupported items. Never search for or return insurance, payer, plan/network/coverage/enrollment, ratings, or participation."
].join(" ");
```

The exact user-prompt template is:

```ts
const providers = input.providers.map((provider) => ({
  providerId: provider.providerId,
  npi: provider.npi,
  name: provider.name,
  specialty: provider.specialty,
  city: provider.city,
  state: provider.state,
  zip: provider.zip
}));

return [
  "Find eligible public professional facts for these providers.",
  `Providers: ${JSON.stringify(providers)}`
].join("\n");
```

The semantic-recovery variant uses the same template with only `providerId`,
`npi`, and `name`. `lineOfCoverage` and plan/network evidence are never copied
into either prompt.

## Appendix B — literal strict Zod model-output schema

This is the exact model-facing Zod schema. `sourceTitle` is intentionally
absent and is derived host-side from `sourceUrl` after parsing.

```ts
const structuredCitationSchema = z.object({
  sourceUrl: z.string().describe("Exact consulted readable page supporting this fact."),
  providerIdentitySpan: z.string().describe("Shortest contiguous verbatim passage that literally occurs on sourceUrl and establishes the exact provider under the prompt's identity rules. Never borrow identity from another page; if sourceUrl lacks such a passage, omit the fact."),
  factSpan: z.string().describe("Shortest contiguous verbatim passage supporting the complete value: every phone digit plus voice purpose, every non-null address component, or the website's provider heading."),
  explicitFactDateSpan: z.string().nullable().describe("Verbatim date/status explicitly governing this exact value, never a page, profile, registry, license, retrieval, or copyright date; else null.")
}).strict();

const structuredSourcedValueSchema = z.object({
  value: z.string(),
  citation: structuredCitationSchema
}).strict();

const structuredPhoneSchema = z.object({
  value: z.string().describe("Professional voice number for this exact provider; never fax, mobile/cell, personal/home, or uncertain-purpose. citation.factSpan explicitly labels its phone/main/scheduling purpose; adjacency to an address or another number is insufficient. For an individual, this same cited page contains the complete number and requested full name or exact NPI; facility/organization identity or another page cannot repair it. Preserve independently supported eligible numbers unless fact-bound evidence marks one former, closed, wrong, or another exact number current/primary/active."),
  citation: structuredCitationSchema
}).strict();

const structuredLocationSchema = z.object({
  addressLine1: z.string().describe("Professional street address, never residential or uncertain-purpose."),
  addressLine2: z.string().nullable().describe("Unit, suite, or floor only when this same citation.factSpan contains it and, for an individual, the same cited page contains the requested full name or exact NPI. A facility-only page cannot supply it; use null."),
  city: z.string().nullable(),
  state: z.string().regex(/^[A-Z]{2}$/).nullable(),
  zip: z.string().nullable(),
  citation: structuredCitationSchema
}).strict().describe("Verified professional location; never residential, people-search, place-name-only, or uncertain-purpose. For an individual, this same cited page contains every emitted component and the requested full name or exact NPI; facility/organization identity or another page cannot repair it. Use null rather than infer an absent component.");

const structuredProviderProfileSchema = z.object({
  providerId: z.string().nullable(),
  npi: z.string().nullable(),
  providerName: z.string(),
  specialties: z.array(structuredSourcedValueSchema).describe("Specialties supported for the exact provider."),
  locations: z.array(structuredLocationSchema),
  phoneNumbers: z.array(structuredPhoneSchema).describe("Eligible professional voice numbers ordered best first."),
  websites: z.array(structuredSourcedValueSchema).describe("Exact consulted readable first-party provider or organization pages; each value equals citation.sourceUrl. For an individual, this same page contains the requested full name or exact NPI; a facility-only page is ineligible. Never a directory, marketplace, social, search, or listing page. Omit an unresolved other-NPI or incompatible-operation domain.")
}).strict();

export const providerProfileStructuredOutputSchema = z.object({
  profiles: z.array(structuredProviderProfileSchema)
}).strict();
```

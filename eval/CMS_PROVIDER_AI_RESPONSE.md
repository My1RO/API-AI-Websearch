# CMS response: AI web-search provider profiles

Status: CMS-ready technical draft based on the completed D36 development and
sealed holdout evaluation. D36 is source-validated but is not represented here
as already deployed. The exact evaluated commit is
`d6afd2d2c24983ea2dbbdbdaf064864d17a13186`.

The complete methodology, denominators, costs, limitations, API reproductions,
and raw TSV inventory are in the [D36 final holdout report](../../test-evidence/provider-d-series-2026-07-31/D36_FINAL_HOLDOUT_CMS_REPORT.md).

## Responses to CMS

| Original CMS question | Lucie response |
| --- | --- |
| **Will there be guardrails to prevent the disclosure and display of the provider’s personal information (e.g., to prevent the provider’s personal cell phone number or address from being displayed)?** | Yes. The model is instructed to return only public professional contacts for the exact provider and to omit fax, mobile/cell, personal/home, residential, people-search, and uncertain-purpose candidates. Each fact must include its own provider-identity quotation, fact quotation, and direct page URL. Narrow host checks reject literal self-declared prohibited values and invalid output, but Lucie does not claim that deterministic code can infer whether an unlabeled number or address is personal. The disjoint holdout found zero manually confirmed major safety violations, including personal-contact or residential disclosure, among 59 evaluable cases; one case was evaluator-overflow. This is evidence of performance in the tested battery, not a guarantee that disclosure is impossible. |
| **When there are conflicts between HealthCare.gov API data and OpenAI indexed data, how would they be addressed?** | HealthCare.gov and plan-directory APIs exclusively determine whether a provider is in network. Lucie does not send plan/network information to the AI, and AI contact information cannot override network participation. Contact disagreements are resolved field by field using exact-provider evidence; agreement with an API is not treated as proof that either value is current. NPI and name are the primary identity keys. Specialty and requested location are possibly stale cross-checks. |
| **If conflicting information is displayed, how should the consumer or agent/broker reconcile those conflicts?** | The product identifies AI contact information as supplemental, preserves plan-directory authority for network status, provides source links, and supports structured correctness feedback. Users should confirm important contact details with the cited provider source or the provider/issuer. Lucie—not the consumer—owns investigation and correction. An unresolved same-field identity or safety conflict is omitted; a conflict in one field does not suppress unrelated supported facts. Feedback does not automatically train the model or replace displayed data. |
| **Please explain how Lucie would validate the accuracy of the OpenAI indexed data with respect to the proposed provider contact information modal solution. Specifically, what mechanisms would the Lucie team use to ensure the accuracy and reliability of each proposed LLM-generated/OpenAI indexed provider data field (i.e., ZocDoc ratings, telephone numbers, address, and website URL)?** | D36 requires every specialty, phone, address, and website to identify the exact provider and carry a direct page URL plus separate identity and fact spans. The model verifies professional purpose, resolves different-NPI conflicts, applies fact-specific recency when available, and only then applies source priority. Strict Zod Structured Outputs and narrow host invariants enforce the response contract. Ratings, including Zocdoc ratings, were removed from the shipped model contract. In the sealed holdout, 206 of 218 evaluable claims had exact whole-packet support, one was partial, nine were unreadable, and two raw contradictions were rejected after documented trace review. For 126 claims, the claim's own cited page was host-readable; 125 exactly supported the value and one partially supported it. Unreadable evidence remains unknown rather than being counted as correct. |
| **Has Lucie done testing to determine how the accuracy of the AI Web-Search Provider Profiles compare to the accuracy of information provided by the existing gov APIs?** | Yes, with important limits. Lucie selected D36 on a 60-provider development battery and ran it once on a sealed, disjoint 60-provider holdout. Every holdout provider was returned by CMS provider search, was covered by at least one sampled actual 2026 Marketplace plan, and had an active matching NPPES identity/location at cohort construction. D36 returned 60/60 profiles. Of 59 evaluable address claims, 51 matched the requested CMS location category, six were other professional locations, and two were unreadable. The study evaluates overlap and independent web support; it does not show that AI is more accurate than CMS, NPPES, or plan directories and is not nationally representative. |
| **Will the feedback mechanism be displayed to consumers, or is it only intended for agent/broker use?** | It is available to anyone who can use the provider contact modal, including consumers and agent/broker users. It is not limited to agent/broker use. The application derives only a broad user class for aggregate quality analysis. |
| **Will messaging be displayed to instruct users on how to interact with the feedback buttons (i.e., only use the buttons to indicate whether the information was correct)?** | Yes. The modal asks whether the overall contact details and each displayed field are correct. An incorrect response requires a field-compatible structured reason. Lucie does not collect free-text feedback in this path. |
| **Who will have access to the feedback data?** | Only approved Lucie data analysts will have access to the feedback aggregates. Members, consumers, agent/broker users, and ordinary application users cannot read feedback records or summaries. The application has no feedback read route. Production access must be enforced with a separate read-only analyst role, least privilege, SSO/MFA, audit logging, recertification, retention, and separation from database/platform administration. |
| **How does Lucie intend to use that feedback data?** | Approved analysts will use organization-scoped daily aggregates to identify quality trends, investigate incorrect information, prioritize corrections, and monitor the service. Feedback will not be shown back to users, automatically train the model, change prompting, suppress fields, or replace directory data. Any future automated use requires separate approval and validation. |
| **When the OpenAI search returns multiple results for a data field (e.g., multiple addresses), how does Lucie determine which information will be prioritized and displayed by default on the initial modal display versus which information will require the user to click to see more?** | Evidence qualification comes first. The model attaches each candidate to the exact provider, verifies the exact fact and professional purpose, resolves identity and same-field conflicts, and applies fact-specific recency when it exists. Only among otherwise eligible evidence does it prefer an exact provider/practice/facility page, then exact-provider government evidence including NPPES, then an established professional directory. NPPES is valid but may be stale, and official branding does not guarantee correctness. Missing recency is neutral rather than grounds for rejection. Element zero is the default; later concurrently supported values appear behind “Show more.” The holdout found this behavior useful but imperfect, so Lucie does not describe the ordering as infallible. |

## Implemented production-shaped contract

The selected D36 service path is:

`provider-only request → one Azure Responses call with native web search → strict structured parsing → narrow local invariants → ordered modal facts`

It uses:

- Azure OpenAI Responses API;
- `gpt-5.6-terra`, reasoning `low`;
- required native `web_search`, at most eight tool calls;
- strict SDK-native Zod Structured Outputs, not free-form JSON prompting;
- one LLM call per semantic attempt and at most three HTTP sends;
- direct per-fact `sourceUrl`, `providerIdentitySpan`, `factSpan`, and optional
  exact-fact date span;
- no production host webpage fetch and no second adjudication call;
- no plan/network input or output;
- no rating output; and
- model-owned semantic decisions with only narrow, independently checkable
  host invariants.

The public request retains `lineOfCoverage: "Medical"` for API compatibility,
but it is not copied into the model prompt. The prompt projection is provider
ID/NPI, name, specialty, city, state, and ZIP only
([prompt-builder.service.ts](../src/services/prompt-builder.service.ts),
[provider-profile.validator.ts](../src/validators/provider-profile.validator.ts)).

The host validates public URLs and strings, exact request identity, phone digit
shape, website/citation URL equality, obvious placeholders, literal prohibited
labels, and stable deduplication
([provider-profile-sanitizer.service.ts](../src/services/provider-profile-sanitizer.service.ts)).
It does not fetch pages or semantically classify source quality, currentness,
or an unlabeled contact. Native citation/action mismatches are logged rather
than used as a destructive parser gate
([response-parser.ts](../src/services/ai-provider/response-parser.ts)).

The retry envelope is non-stacking: the initial call has SDK `maxRetries=1`;
at most one semantic retry uses SDK `maxRetries=0`. Native refusal and
completion content filter receive one identical full retry; malformed strict
output receives one identity-focused retry
([responses-provider.client.ts](../src/services/ai-provider/responses-provider.client.ts)).

## Source priority and recency

Lucie applies the following order only after exact-provider and exact-fact
qualification:

1. exact provider, practice, clinic, facility, hospital, or health-system page;
2. exact-provider government evidence, including NPPES; and
3. established exact-provider professional directory.

This is a display preference, not a truth guarantee. A higher tier cannot
rescue a wrong provider, unsupported value, unsafe purpose, incompatible
location, or affirmative different-NPI conflict. Shared use does not establish
contradiction without evidence of exclusivity or incompatibility.

Only a date that governs the exact provider, field, and value counts as fact
recency. Retrieval time, copyright year, and registry enumeration,
certification, or record-wide update dates do not. Undated supported evidence
remains eligible and neutral; Lucie does not call it current.

## Completed evaluation

### Cohort

The holdout contains 60 providers: 48 individuals, 12 organizations, 30 urban,
and 30 nonmetro across six markets. All were in network for at least one sampled
actual 2026 Marketplace plan. It has zero NPI overlap and zero normalized
name+city+state overlap with the development battery. The battery is a
probability sample conditional on the six-market text-query frame, not a
national probability sample.

### Production result

- 60/60 parsed responses and profiles;
- all 60 had at least one phone, address, or website;
- 221 emitted claims: 72 specialty, 60 address, 56 phone, and 33 website;
- 148 web searches, 61 HTTP sends, one semantic retry, and no transport retry;
- production cost `$5.028516` total, `$0.0814885` median, `$0.0838086`
  mean, `$0.1148255` p95, and `$0.156701` maximum;
- Azure latency `9.542 s` median, `9.787 s` mean, `13.881 s` p95, and
  `14.613 s` maximum.

### Fixed evaluation result

The fixed evaluator used `gpt-5.6-sol`, reasoning `high`, concurrency 10, the
same categorical rubric and strict schema for every case, no web search, and no
aggregate score. Each case received only D36's returned webpages. The
evaluation made 59 paid calls; H036 was an honest no-call context overflow.

- whole-packet claim support: 206 exact, 1 partial, 9 unreadable, and 2 raw
  contradicted among 218 evaluated claims;
- readable own-citation support: 125 exact and 1 partial among 126 claim-level
  own-citation assessments; 92 additional assessments were host-unreadable;
- identity spans: 121 exact, 5 nonverbatim, 92 unreadable;
- fact spans: 119 exact, 7 nonverbatim, 92 unreadable;
- recency: 209 undated and 9 unreadable; no qualifying fact-specific date;
- judge cost `$44.153370`; final production plus judge cost `$49.181886`.

The sealed judge emitted raw critical labels for H005 and H008. Additive trace
review preserved those labels but found them to be evaluator overreach or
missing exact-NPI evidence, not confirmed safety failures. The final stopping
result is **zero manually confirmed major safety violations among 59 evaluable
cases; one case was evaluator-overflow**. H014 had one confirmed minor defect:
an unsupported slash in `addressLine2`. Nine claims remained indeterminate
because their exact evidence was unavailable.

The evaluation was model-assisted and received an additive trace audit; it was
not a blinded independent human-adjudication study. Unknown evidence was not
converted into success. The result does not establish complete internet
coverage, perfect citation fidelity, national performance, or superiority over
government/provider-directory APIs.

### Development-to-holdout regression check

Lucie compared the frozen 60-provider D36 development result with the disjoint
60-provider holdout. There was no release-material regression:

- parsed profiles and profiles containing a phone, address, or website remained
  60/60;
- confirmed major-safety violations remained zero (58 paired-eligible
  development cases; 59 evaluable holdout cases);
- readable direct-citation precision was effectively identical: 128/129
  (99.2%) in development and 125/126 (99.2%) in holdout;
- own-citation unreadability was also similar: 89/218 assessments across 35/60
  development cases versus 92/218 across 34/59 evaluable holdout cases;
- lower-tier source selections decreased from 26 to 23 fields, and non-rating
  inappropriate withholding decreased from 14 to nine fields;
- mean production cost decreased 1.1%, from `$0.0847505` to `$0.0838086` per
  provider; and
- median and p95 Azure latency increased from `8.859 s`/`13.190 s` to
  `9.542 s`/`13.881 s`, while the development run's `309.402 s` transport tail
  did not recur (holdout maximum `14.613 s`).

The holdout did expose three adverse differences that remain disclosed: one
minor unsupported `/` address component, one evaluator context-overflow case,
and whole-packet unreadability in six provider cases rather than two. An
exploratory provider-unit Fisher comparison of the latter was `p=0.163`; it did
not establish a cohort regression. Both raw holdout contradictions were traced
to evaluator overreach against frozen exact-NPI evidence, not confirmed unsafe
or wrong-provider output.

This was not a preregistered confirmatory noninferiority test, and the
exploratory comparisons were not adjusted for multiple testing. Lucie therefore
states that no statistically established or operationally material regression
was observed—not that development and holdout performance are proven
equivalent. No prompt was retuned after the holdout was opened.

## Feedback governance

The service stores organization-scoped daily aggregate counts by broad
submitter class, provider, normalized fact, answer, reason, and UTC day. It
stores no raw feedback event, event timestamp, member, user, session, request,
query, quote, prompt, or response identifier. There is no application read
route. Approved analyst access, retention, minimum-cell suppression, access
review, audit evidence, and incident/correction ownership remain organizational
release controls rather than claims established solely by source code.

## Release packaging and remaining evidence

The completed study supports shipping D36. A packaging-only descendant now
provides a digest-pinned multistage production image, compiled entrypoint,
non-root/read-only runtime contract, healthcheck, immutable-image runbook,
rollback procedure, and initial monitoring gates. A local dedicated-Redis
container smoke passed health, non-root/read-only, and missing-Public-API-context
fail-closed checks. These changes do not alter D36's prompt, schema, parser,
sanitizer, Azure client, retry behavior, or runtime defaults.

Local release readiness is not the same as completed production cutover. Before
launch Lucie still must:

1. publish and review the exact evaluated commit plus its
   packaging/documentation-only descendant;
2. build in approved CI and bind an immutable registry digest and actual
   Terra/low deployment values to those commits;
3. run the documented deployed Public-API/Azure and test-tenant feedback/MySQL
   smoke, record the previous healthy digest, and activate the monitoring gates;
4. provide Azure privacy/security, logging, retention, access-control, and
   Grounding with Bing approval evidence; and
5. approve feedback-data ownership, analyst access, retention, access review,
   and correction/incident procedures.

Any confirmed wrong-provider, personal-contact, residential-address, or
materially unsupported contact incident is a release-blocking safety event for
a separately versioned repair. Lesser citation, source-priority, recency, and
formatting defects are reported and monitored rather than hidden or tuned on
the sealed holdout.

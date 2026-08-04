# CMS response: AI web-search provider profiles

Status: corrected technical draft based on the completed development study and
the re-evaluated sealed holdout. The evaluated configuration is not represented
as deployed or ready for release.

Evaluated contract: Lucie retained the original full production prompt and
strict schema for the sealed holdout. The exact
static model-visible contract is 86,769 UTF-8 bytes at treatment commit
`d6afd2d2c24983ea2dbbdbdaf064864d17a13186`; later packaging and documentation
commits did not change the treatment files. A subsequent development-only
prompt-minimization study tested eight shortened contracts, including
reductions from 72.1% through 87.1%. After correcting the fixed evaluator and
reevaluating every arm on the same frozen 60-provider development battery, no
shortened contract passed both required primary evaluation strata. Lucie
therefore did not replace the full prompt, did not use the prior holdout to
select a shorter prompt, and does not present short-contract results as release
evidence. A later corrected holdout reader evaluated all 60 cases and exposed
release-blocking fax/voice and provider-identity failures that the historical
reader missed. The full contract therefore remains the evaluated reference,
not an approved production release.

The complete methodology, denominators, costs, limitations, API reproductions,
and raw TSV inventory are in the
[companion provider-profile validation report](CMS_PROVIDER_AI_VALIDATION_REPORT.md).

The selection process tested **40 distinct production-shaped configurations
with live pilot requests**. Four advanced to complete 60-provider development
evaluations. The selected configuration was frozen before it was evaluated on
a separate 60-provider holdout.

## Responses to CMS

| Original CMS question | Lucie response |
| --- | --- |
| **Will there be guardrails to prevent the disclosure and display of the provider’s personal information (e.g., to prevent the provider’s personal cell phone number or address from being displayed)?** | The evaluated contract contains those guardrails: the model must return only public professional contacts for the exact provider and omit fax, mobile/cell, personal/home, residential, people-search, and uncertain-purpose candidates. Each fact carries a provider-identity quotation, fact quotation, and direct page URL. Narrow host checks reject literal self-declared prohibited values and invalid output, but cannot semantically classify an unlabeled contact. The corrected sealed-holdout review did not confirm a personal-mobile disclosure; it did confirm one emitted phone with arm-owned exact-NPI evidence explicitly labeling that value as a fax, plus two provider-identity/location cases described below. Lucie therefore will not represent this prompt as having passed its release safety gate. |
| **When there are conflicts between HealthCare.gov API data and OpenAI indexed data, how would they be addressed?** | HealthCare.gov and plan-directory APIs exclusively determine whether a provider is in network. Lucie does not send plan/network information to the AI, and AI contact information cannot override network participation. Contact disagreements are resolved field by field using exact-provider evidence; agreement with an API is not treated as proof that either value is current. NPI and name are the primary identity keys. Specialty and requested location are possibly stale cross-checks. |
| **If conflicting information is displayed, how should the consumer or agent/broker reconcile those conflicts?** | The product identifies AI contact information as supplemental, preserves plan-directory authority for network status, provides source links, and supports structured correctness feedback. Users should confirm important contact details with the cited provider source or the provider/issuer. Lucie—not the consumer—owns investigation and correction. An unresolved same-field identity or safety conflict is omitted; a conflict in one field does not suppress unrelated supported facts. Feedback does not automatically train the model or replace displayed data. |
| **Please explain how Lucie would validate the accuracy of the OpenAI indexed data with respect to the proposed provider contact information modal solution. Specifically, what mechanisms would the Lucie team use to ensure the accuracy and reliability of each proposed LLM-generated/OpenAI indexed provider data field (i.e., ZocDoc ratings, telephone numbers, address, and website URL)?** | The evaluated contract requires every specialty, phone, address, and website to identify the exact provider and carry a direct page URL plus separate identity and fact spans. The model is instructed to verify professional purpose, resolve different-NPI conflicts, apply fact-specific recency when available, and only then apply source priority. Strict Zod Structured Outputs and narrow host invariants enforce the response shape. Ratings, including Zocdoc ratings, were removed from the model contract. The corrected evaluator assessed all 221 holdout claims: whole-packet support was 201 exact, one partial, one not found, and 18 contradicted; exact-own-page support was 174 exact, two partial, three not found, and 42 unreadable. Trace review confirmed at least three release-blocking provider/contact cases. Unreadable evidence remains unknown, and raw recency-sensitive labels are separately qualified because the judge sometimes over-weighted directory refresh metadata. |
| **Has Lucie done testing to determine how the accuracy of the AI Web-Search Provider Profiles compare to the accuracy of information provided by the existing gov APIs?** | Yes, with important limits. Lucie tested 40 production-shaped configurations in live pilots, advanced four to complete 60-provider development evaluations, selected a development winner under a fixed safety-first rule, and ran it once on a sealed, disjoint 60-provider holdout. Every holdout provider was returned by CMS provider search, was covered by at least one sampled actual 2026 Marketplace plan, and had an active matching NPPES identity/location at cohort construction. The configuration returned 60/60 profiles, but the corrected evidence reader found an emitted fax/voice conflict, a wrong-NPI contact bundle, and a same-name wrong-location page. The study evaluates overlap and independent web support; it does not show that AI is more accurate than CMS, NPPES, or plan directories and is not nationally representative. |
| **Will the feedback mechanism be displayed to consumers, or is it only intended for agent/broker use?** | It is available to anyone who can use the provider contact modal, including consumers and agent/broker users. It is not limited to agent/broker use. The application derives only a broad user class for aggregate quality analysis. |
| **Will messaging be displayed to instruct users on how to interact with the feedback buttons (i.e., only use the buttons to indicate whether the information was correct)?** | Yes. The modal asks whether the overall contact details and each displayed field are correct. An incorrect response requires a field-compatible structured reason. Lucie does not collect free-text feedback in this path. |
| **Who will have access to the feedback data?** | Only approved Lucie data analysts will have access to the feedback aggregates. Members, consumers, agent/broker users, and ordinary application users cannot read feedback records or summaries. The application has no feedback read route. Production access must be enforced with a separate read-only analyst role, least privilege, SSO/MFA, audit logging, recertification, retention, and separation from database/platform administration. |
| **How does Lucie intend to use that feedback data?** | Approved analysts will use organization-scoped daily aggregates to identify quality trends, investigate incorrect information, prioritize corrections, and monitor the service. Feedback will not be shown back to users, automatically train the model, change prompting, suppress fields, or replace directory data. Any future automated use requires separate approval and validation. |
| **When the OpenAI search returns multiple results for a data field (e.g., multiple addresses), how does Lucie determine which information will be prioritized and displayed by default on the initial modal display versus which information will require the user to click to see more?** | Evidence qualification comes first. The model attaches each candidate to the exact provider, verifies the exact fact and professional purpose, resolves identity and same-field conflicts, and applies fact-specific recency when it exists. Only among otherwise eligible evidence does it prefer an exact provider/practice/facility page, then exact-provider government evidence including NPPES, then an established professional directory. NPPES is valid but may be stale, and official branding does not guarantee correctness. Missing recency is neutral rather than grounds for rejection. Element zero is the default; later concurrently supported values appear behind “Show more.” The holdout found this behavior useful but imperfect, so Lucie does not describe the ordering as infallible. |

## How the production configuration was selected

Baseline and source-policy experiments first exposed over-restrictive host
filtering, weak fact-level citation attribution, source hierarchy applied before
fact qualification, and unnecessary plan context. The controlled evolution
phase then tested **40 distinct production-shaped configurations with live
pilot requests**. Most were exercised on targeted difficult cases; **four
advanced to complete 60-provider development evaluations**. The final two
non-dominated configurations received a paired 60-provider comparison under
the same fixed evaluator. The winner was selected under a preregistered
safety-first rule and frozen before the independent holdout was opened.

The winning configuration differed from its final comparator only through
prompt and schema guidance. It required exact page-local quotations for each
fact, applied source hierarchy only after exact-fact evidence qualification,
preserved government or professional-directory fallback when a first-party
page did not expose the field, treated an unambiguous first-party biography or
team page as eligible website evidence, and stopped searching once identity,
fact support, first-party inspection, and relevant conflict resolution were
complete. Parser, provenance, retry, and narrow deterministic sanitizer
behavior did not change in that final comparison.

Both finalists had zero confirmed major-safety failures and returned usable
profiles throughout the development battery. The winner was selected because
its comparator emitted one readable materially unsupported address component
while it emitted none. The winner had one later partial own-citation detail;
the fixed lexicographic rule did not allow that later tradeoff to override the
earlier material-support result. This is a transparent selection result, not a
claim of universal superiority.

### Post-selection prompt-minimization check

Lucie later evaluated whether the same behavior could be preserved with a
substantially smaller prompt and schema. The comparison included the full
86,769-byte contract and eight shortened artifacts on the same 60-provider
development battery. The corrected evaluator kept 33 providers in the
automatic Sol/high stratum, routed 25 provider-paired cases to a separately
reported Codex-harness manual exception protocol, and censored two
provider-paired operational failures. “Manual” here means blinded structured
exception adjudication in the Codex harness, not an independent human clinical
review. The pooled 58-provider analysis was preregistered as secondary and was
not allowed to replace either primary stratum.

The shortest 11,196-byte artifact reduced the static contract by 87.1% and had
no new confirmed safety finding. It passed the automatic and secondary pooled
gates but failed the primary manual-stratum eligible-contact endpoint: the
candidate-minus-full estimate was -4 percentage points and the paired-bootstrap
lower 95% bound was -12 percentage points, below the frozen -5-point margin.
The difference came from one real provider request in which the full contract
returned a professional address and phone while the shortest contract returned
only specialty. Every other shortened artifact failed at least one additional
primary gate. Under the frozen development rule there was no short-contract
winner. The full contract remained the holdout reference, but the corrected
holdout result below means it is not a releasable production candidate without
another iteration.

## Evaluated production-shaped contract

The evaluated service path is:

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

The profile endpoint is invoked from the medical-plan workflow, so its public
request envelope retains `lineOfCoverage: "Medical"` for API compatibility.
`Medical` identifies the insurance product line only. It is orthogonal to
provider entity type, is not used to exclude facilities, and is not copied into
the model prompt. The search supports NPI Type 1 individual practitioners and
NPI Type 2 entities, including group practices, clinics, hospitals, and other
facilities. The prompt receives only provider ID/NPI, name, specialty, city,
state, and ZIP.

The host validates public URLs and strings, exact request identity, phone digit
shape, website/citation URL equality, obvious placeholders, literal prohibited
labels, and stable deduplication. It does not fetch pages or semantically classify source quality, currentness,
or an unlabeled contact. Native citation/action mismatches are logged rather
than used as a destructive parser gate.

The retry envelope is non-stacking: the initial call has SDK `maxRetries=1`;
at most one semantic retry uses SDK `maxRetries=0`. Native refusal and
completion content filter receive one identical full retry; malformed strict
output receives one identity-focused retry.

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
- production cost `$5.028516` total, `$0.081231` median, `$0.083809`
  mean, `$0.112417` p95, and `$0.156701` maximum;
- Azure latency `9.568 s` median, `9.830 s` mean, `13.591 s` p95, and
  `14.651 s` maximum.

### Corrected fixed-evaluation result

The re-evaluator used `gpt-5.6-sol`, reasoning `high`, concurrency 10, a fixed
categorical rubric and strict schema, no evaluator web search, and no aggregate
score. It preserved the production treatment and its 1,523 exact returned URLs.
Complete HTML was normalized to semantic Markdown; five large workbooks used
deterministic indexes and four predeclared spreadsheet-boundary cases entered a
blinded structured Codex-harness manual stratum. The final result contains 56
automatic cases, four manual cases, and zero censored cases.

- all 60 cases and all 221 claims were evaluated; the historical single-case
  overflow was eliminated;
- whole-packet claim support: 201 exact, one partial, one not found, and 18
  contradicted;
- own-citation support: 174 exact, two partial, three not found, and 42
  unreadable;
- identity spans: 158 exact, two partial, 19 nonverbatim, and 42 unreadable;
- fact spans: 156 exact, 23 nonverbatim, and 42 unreadable;
- raw recency labels: 115 current, 20 stale, 20 conflicting, 37 undated, and 29
  unknown; every explicit fact-date span was absent;
- successful automatic evaluator cost: `$128.052519` across 346 atomic and 56
  synthesis calls; production plus that evaluator was `$133.081035`.

The raw judge emitted advisory critical labels in 16 automatic cases. Detailed
trace review found that some conflict labels over-weighted directory
`dateModified`, `last reviewed`, or dataset-refresh metadata even though those
dates did not govern the exact fact. It also repeated the known overbroad
inference that an apartment label alone proves residential use. Those raw
labels remain disclosed and are not silently converted to success.

Separately, three release-blocking cases do not depend on those evaluator
errors: one output phone had arm-owned exact-NPI evidence explicitly labeling
it as a fax; one address-and-phone bundle was affirmatively assigned to other
NPIs without requested-NPI or shared-use resolution; and one same-name
first-party page supplied a California address for a provider whose readable
exact-NPI evidence identified Ohio. The unsupported slash in one
`addressLine2` remains a confirmed minor defect. The full prompt therefore did
not pass the corrected holdout safety gate.

The evaluation was model-assisted and included a separately reported blinded
exception stratum plus additive trace review; it was not an independent human
clinical-adjudication study. Unknown evidence was not converted into success.
The result does not establish complete internet coverage, perfect citation
fidelity, national performance, or superiority over government/provider-
directory APIs.

### Development-to-holdout regression assessment

Production availability and volume remained stable: both batteries returned
60/60 profiles, and the holdout emitted 221 claims. Production mean cost was
1.1% lower than development (`$0.083809` versus `$0.084751` per provider), and
the development run's extreme transport tail did not recur.

The previous statement of “no release-material regression” is withdrawn. It
was based on the historical evaluator, which judged only 59 cases, left 92 own
citations unreadable, and overflowed on one case. The corrected reader judged all
60 cases, reduced own-citation unreadability to 42/221, and exposed the three
release-blocking cases above. Because the development and holdout source
snapshots were collected at different times and the corrected recency labels
still require qualification, Lucie does not claim a formal development-to-
holdout effect estimate. No production prompt was retuned after the holdout was
opened; instead, the failed holdout gate is reported as observed.

## Feedback governance

The service stores organization-scoped daily aggregate counts by broad
submitter class, provider, normalized fact, answer, reason, and UTC day. It
stores no raw feedback event, event timestamp, member, user, session, request,
query, quote, prompt, or response identifier. There is no application read
route. Approved analyst access, retention, minimum-cell suppression, access
review, audit evidence, and incident/correction ownership remain organizational
release controls rather than claims established solely by source code.

## Release packaging and remaining evidence

The packaging work is complete, but the corrected holdout does not support
shipping this configuration. A packaging-only release provides a digest-pinned
multistage production image, compiled entrypoint,
non-root/read-only runtime contract, healthcheck, immutable-image runbook,
rollback procedure, and initial monitoring gates. A local dedicated-Redis
container smoke passed health, non-root/read-only, and missing-Public-API-context
fail-closed checks. These changes do not alter the evaluated prompt, schema, parser,
sanitizer, Azure client, retry behavior, or runtime defaults.

Packaging readiness is not evidence that the Provider AI treatment passed its
quality gate. Before launch Lucie must first correct and revalidate the three
release-blocking cases described above, and then:

1. publish and review the exact successor source plus its
   packaging/documentation-only release changes;
2. build in approved CI and bind an immutable registry digest and actual
   Terra/low deployment values to that evaluated source and release build;
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

## Appendix A — Literal production prompt

The Responses request sends the following system instruction string verbatim.
This is the retained original full prompt evaluated in the failed corrected
holdout, not a shortened experimental prompt or an approved successor.
The historical headings beginning with `D34` are inert labels retained in the
evaluated runtime string; they do not select a hidden branch. In those quoted
instructions, `Q1`, `Q2`, and `Q3` mean qualified first-party,
qualified government, and qualified professional-directory evidence,
respectively.

```text
You find public professional profile facts for exact requested medical providers. Use web search for every request and stay within the configured maximum of eight web-search tool calls. Mandatory procedure before selecting facts: (1) Search the exact NPI and quoted provider name. If needed, broaden to the exact NPI alone, the legal, DBA, or alias name plus city or street, and a likely first-party page before concluding that no first-party lead exists. (2) Inspect readable exact-NPI evidence sufficient to establish the requested entity before relying on a same-name first-party operational bundle; when the requested provider may be an organization, determine whether that evidence identifies the requested NPI as Entity Type 2. Readable page content returned with search counts, without a separate open-page action, counts as inspected evidence; a bare result URL, title, snippet, source listing, or exact-NPI search metadata does not. After exact-NPI identity, do not answer until this action order is complete: FIRST obtain readable content for the best surfaced plausible exact-provider first-party page, either from returned readable search content or by opening it; SECOND inspect surfaced same-name alternate-NPI evidence relevant to a website conflict. Do not inspect a redundant registry or directory while required first-party or relevant alternate-NPI evidence remains uninspected. (3) If search exposes a plausible first-party provider, practice, clinic, facility, hospital, or health-system page, inspect that exact provider, location, or contact page before answering. Do not stop after inspecting only a registry while a plausible first-party lead remains uninspected. (4) For an organization, reconcile every first-party suite, phone, address, and domain bundle against the requested NPI and any surfaced same-name different-NPI record before emitting it. First determine whether an alternate-NPI lead is relevant to this candidate. Treat it as a same-name or operational-bundle conflict only when readable evidence either (a) shows the same complete legal, DBA, or alias name and assigns an operational value displayed by the candidate page to that alternate NPI or operation, or (b) explicitly attaches that alternate NPI or operation to the exact candidate domain or page bundle. Shared name fragments, a merely similar but nonmatching name, geographic proximity, or appearance in results from a site- or domain-restricted query is not co-binding. An irrelevant alternate-NPI lead cannot implicate or suppress an otherwise eligible website; continue with ordinary exact-name attachment. This relevance gate does not weaken a same-complete-name conflict when the candidate page displays an address, suite, or phone assigned to the alternate NPI. When search exposes the same organization name under another NPI, inspect readable evidence for that NPI before emitting any website; if that other-NPI evidence cannot be inspected, omit only the website and preserve independently qualified facts. Opening a first-party page is evidence collection, not permission to emit. Use the remaining search budget when necessary; the maximum is eight tool calls. If no readable exact-NPI page can be inspected or it does not establish entity type, do not use a same-base first-party bundle that conflicts with exact-NPI address or phone evidence; preserve independently qualified nonconflicting facts. Before omitting a website or choosing a lower-tier or different-value source instead, inspect a surfaced plausible exact-provider first-party page when its search result has not already supplied sufficient readable page evidence. If multiple plausible current and legacy domains appear, inspect the likely current first-party domain before choosing or omitting a website. Attempt one likely provider, practice, clinic, facility, hospital, or health-system page before returning no profile when search results indicate one exists. NPI plus name are primary identity; providerId is correlation data and a fallback only when NPI is absent. Requested city, state, and ZIP may be stale: use them as search seeds and disambiguation hints, not current-truth gates. Outside the explicit Entity Type 2 same-base organizational safeguard below, a location mismatch alone cannot reject an identity-qualified current or additional first-party professional contact. Location scopes contacts but cannot override identity; apply location only after identity and conflict qualification. Specialty is a weak, possibly stale cross-check and never an identity gate. Process each candidate in this order: attach it to the exact requested entity; verify that one consulted page supports both provider identity and the exact value; verify professional purpose, safety, and compatible location; resolve candidate-specific identity and same-field conflicts; apply fact-specific recency when available; then apply source priority and order the output. Source class, apparent recency, or official branding cannot rescue an ineligible fact. Emit an inspected first-party website when its page identifies the exact requested provider or a compatible organization and no affirmative evidence binds that page or domain to a different NPI, organizational subpart, or provider operation. Do not require a website's URL to be printed in its own page body. Do not reject a website merely because an unrelated address or phone conflicts. But when the candidate site displays a suite, complete address, phone, or other operational value that readable evidence assigns to a same-name different-NPI organizational subpart and that conflicts with requested-NPI evidence, the site and domain are implicated rather than merely affected by an unrelated field conflict. For any implicated website, apply only the ordered domain-specific attachment and rescue rules below. Before emitting any field, reconcile all consulted evidence for same-name, different-NPI entities at the candidate and bundle level, and apply every conflict field-locally. A suite, address, or phone conflict does not by itself implicate a website. Treat a domain as implicated only when readable evidence binds that exact domain to the conflicting organizational subpart, different NPI, or different provider operation. If separate readable evidence expressly co-binds a candidate or its operational bundle to another NPI or another provider operation, treat that candidate as implicated even when exclusivity is not proven. Readable evidence that assigns a candidate, or a bundle that exclusively co-binds it, to another NPI or another provider operation is one express co-binding case; omit that candidate before recency or source priority unless it passes the rescue rule. Omit an implicated non-domain candidate unless separate affirmative evidence explicitly attaches the exact same value to the requested NPI and establishes nonexclusive or shared use; exact-NPI evidence about a different value is insufficient. For an implicated domain, use only the domain-specific attachment and rescue rules that follow. For an otherwise-unimplicated domain only, readable exact-NPI evidence that confirms the requested organization's legal, DBA, or alias name plus readable content from the inspected first-party page that co-binds that exact confirmed name to the requested organization is sufficient attachment: emit that exact consulted page URL as the website. A compatible complete professional address corroborates this attachment but is not mandatory. The first-party page need not repeat the NPI. For an implicated domain, only explicit rebranding, acquisition, ownership-continuity, or redirect evidence, or separate affirmative evidence that explicitly attaches the same exact domain to the requested NPI and establishes shared or concurrent use, may rescue it. The ordinary exact-name attachment rule never rescues a domain implicated by a different NPI, organizational subpart, or provider operation. Absent such domain-specific attachment or rescue evidence, omit the domain when affirmative readable evidence binds that domain to a different NPI, organizational subpart, or provider operation; this rule never rescues or validates an address or phone from the page. Same name, branding, base-address overlap, general affiliation, or absence of exclusivity alone is insufficient to rescue an implicated candidate. Apply this additional safeguard only when consulted exact-NPI evidence identifies the requested NPI as an Entity Type 2 organization: if that exact-NPI evidence and a same-name first-party operational bundle share the same base street but conflict on an added, missing, or different suite or organizational subpart, treat the conflicting address and suite candidates as unresolved organizational-identity conflicts. First-party name, branding, apparent currentness, and base-street overlap cannot override those suite or subpart conflicts. Emit a conflicting suite, subpart, or address only when separate affirmative evidence either attaches that exact same value to the requested NPI or attaches it to the requested organization and establishes shared or concurrent use. When exact-NPI evidence establishes the requested organization's exact legal, DBA, or alias name and complete professional location, and a readable first-party page co-binds that same exact name and location to a displayed professional voice phone, that affirmatively attaches the phone to the requested organization. A different undated registry or directory phone alone does not establish another operation and must not suppress the Q1 phone. This does not rescue a page, domain, or phone readably assigned to another NPI, organizational subpart, or incompatible operation. Evaluate the domain separately under the domain-implication and continuity rules above. This same-base organizational safeguard does not apply to an Entity Type 1 individual; when an exact-NPI, identity-qualified, active first-party provider page directly presents the individual's current professional office or voice phone, emit that eligible value and rank it first unless affirmative evidence establishes that the value is former, belongs to another provider or operation, or is not a professional contact. A bare conflicting registry or directory listing does not by itself disqualify that current provider-page contact. An inspected first-party provider or facility page that identifies the exact provider by name plus a compatible location affirmatively attaches its displayed professional phone even when other providers share that facility number. Shared use alone is not a conflict; disqualify that phone only when affirmative evidence makes it exclusive to an incompatible provider or operation, obsolete, or nonprofessional. It also does not reject a distinct-address additional professional office for an organization merely because exact-NPI evidence omits it. An inspected provider-specific first-party page establishes a compatible distinct-address additional office when it directly co-binds the exact requested organization to a complete professional address with no conflicting-NPI or conflicting-operation evidence. Qualify that office's phone independently: emit the phone only when its own cited page directly binds the exact phone to the requested organization and that compatible office. Never require the address and phone to appear on one page or require either field as a precondition for emitting the other. A place, facility, campus, or school name without a complete civic or postal address is not an address record. Except for this Entity Type 2 same-base safeguard, a suite or location mismatch by itself is not express another-NPI or another-operation evidence and cannot implicate a website, specialty, or identity-qualified first-party contact. For an ordinary candidate not expressly co-bound to another NPI or operation, do not demand proof that the asset is exclusive. The shared-asset exception uses separate affirmative evidence that attaches the exact same value to the requested provider—by exact requested NPI, or by exact requested name plus compatible organization or location on a provider-specific page—and establishes nonexclusive or shared use. Same branding, general affiliation, a health-system homepage, or absence of exclusivity is insufficient by itself; this demands affirmative provider attachment, not proof that the ordinary asset is exclusive. Apply this field-locally and preserve unrelated facts. Resolve each field independently. Return multiple values only when consulted evidence affirmatively establishes that they are compatible and concurrently active professional facts. A bare registry or directory listing, including a separate exact-NPI listing, establishes only that the listed value is attributed to the provider on that source; it does not by itself establish that the value remains current, that a conflicting value is obsolete, or that both values operate concurrently. A registry label such as Secondary Practice Location is still only a registry attribution: by itself it never proves current concurrent operation, so never emit multiple conflicting registry-only location or phone bundles on that basis. When an inspected active exact-provider first-party page directly offers one conflicting professional contact, do not emit a bare registry or directory alternate as an additional current value without separate affirmative concurrent-operation evidence. This rule does not make registry or directory evidence invalid when no qualified conflict exists. When competing eligible values lack affirmative concurrent-operation evidence, emit at most one. Select among values using exact-provider attachment, professional purpose and specificity, compatible location, conflict evidence, and then fact-specific recency when available. Only after a candidate has passed exact-provider identity and other-NPI or other-operation reconciliation, apply this rule: when no competing eligible value has a fact-bound date, an inspected active provider-specific first-party page currently offering the exact professional contact or domain is operational-currentness evidence. Presumptively select that eligible value over an undated registry or directory alternate that appears legacy or conflicting, unless affirmative evidence establishes concurrent operation or strongly contradicts the first-party attachment. This presumption cannot make an ineligible or implicated different-NPI or different-operation candidate eligible and cannot rescue one; the earlier rescue rule still controls. This presumption is value-level selection evidence, not an explicit fact date; keep explicitFactDateSpan null. After evidence qualification, an inspected exact-provider first-party direct contact or website beats a conflicting undated lower-tier listing unless affirmative evidence establishes that the first-party value is ineligible, obsolete, or belongs to another provider or operation. Emit any such identity-qualified eligible Q1 direct phone, address, or website as element zero rather than selecting a conflicting undated Q2/Q3 value or leaving the field empty. Use source hierarchy only as the last tie-breaker when eligible values remain otherwise equivalent; never replace a more provider-specific value with a different general value merely because the general value has a higher-priority source. Omit a former, legacy, or unresolved conflicting candidate while preserving unrelated facts. A registry record's enumeration, creation, or last-update date does not date every fact listed in that record. Undated supported evidence remains eligible. For the final source-hierarchy tie-breaker and output order among otherwise-equivalent eligible values, prefer an exact first-party provider or organization page, then an exact-provider government registry including NPPES, then an established exact-provider professional directory. Element zero is the default and later elements are Show more. NPPES is valid but can be stale; official branding is not correctness or independent corroboration. After values are fixed, perform one mandatory citation-only pass. For each selected fact, inspect the readable exact-provider pages already consulted for that same complete value or a faithful formatting equivalent. If any exact-provider first-party page supports that same value, cite the best such Q1 page. Otherwise cite inspected same-value exact-provider government evidence when available; otherwise cite eligible readable exact-provider professional-directory evidence. This pass changes only the citation, never the selected value. Never cite an unread, metadata-only, access-challenge, rate-limit, or error page. Treat NPIProfile and any other page that returns a rate-limit, access-challenge, error, or non-provider body as an unread discovery lead only; never cite it when a readable same-value alternative was inspected. Do not cite metadata-only, error, snippet-only, title-only, unavailable, or unread evidence when another inspected page supports the same value. Do not replace a more provider-specific fact with a different general value merely because the general value's source tier is higher. Citation choice cannot make an ineligible candidate eligible. sourceUrl must be the exact URL associated with that readable fact-supporting page content, not a search-results page, bare snippet, tool-action URL without readable page content, or a different corroborating page. First qualify the cited page for the exact requested provider using all readable page content, including exact-NPI evidence wherever it appears. Then copy two separate item-local excerpts from that same qualified page: providerIdentitySpan for identity and factSpan for the fact. providerIdentitySpan and factSpan must both come from the same page, but the two spans need not be adjacent to each other or to page-level NPI evidence. Each span must itself be one short contiguous passage, or faithful rendered-text equivalent. Copy the shortest sufficient spans verbatim from that page's rendered text whenever possible. Treat faithful rendered-text equivalent narrowly: for providerIdentitySpan it may normalize markup, whitespace, punctuation, capitalization, and standard value formatting while preserving the source token order. For factSpan, only removal of markup or normalization of whitespace and Unicode typography that leaves every visible word and token unchanged qualifies; the exact quotation contract below controls. It never permits invented labels, omitted intervening text, reordered tokens, or concatenation of separate page regions. Prefer one exact copied substring for each span. Never use ellipses, combine noncontiguous passages, paraphrase, or quote only a page title; apply this rule independently within each span whenever supporting page text exists. Do not require providerIdentitySpan to contain NPI merely because the page displays NPI in another region, and do not omit an otherwise eligible fact merely because page-level NPI evidence and the fact appear in separate regions. providerIdentitySpan must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location. A shortened given-name-plus-surname passage without local NPI is insufficient by itself, especially for a common name. It may serve as the item-local identity span only when all readable content on that same provider-specific page semantically reconciles it to the exact requested provider through multiple distinct compatible biographical identifiers beyond the shortened name—for example, training or education together with compatible specialty or location—and there is no conflicting-provider evidence. NPI and full requested name remain primary identity evidence. Specialty alone, location alone, general branding, or affiliation is never sufficient for this exception. For non-website facts, factSpan must contain the complete emitted value or faithful punctuation, whitespace, postal, or rendered-text equivalent in the semantic sense: its exact source words must support every normalized material component and bind it to this fact type, but the quotation must not be rewritten. For an address, one own consulted source must support every material serialized component, including the complete ZIP or ZIP+4; never borrow a component from another page. For a specialty, a common unambiguous credential expansion such as PA-C to Physician Assistant is a faithful semantic equivalent and must not be rejected by a literal-only wording gate, while factSpan still quotes the exact source credential. For a website, follow the field-specific direct-URL rule below. Before returning, verify separately for every emitted item that readable content from its own sourceUrl was inspected in this call, its providerIdentitySpan identifies the requested provider under the item-local identity rule, and its factSpan supports that item's exact value and field type; also verify that page-level evidence qualifies that same page for the exact requested provider. Compare each proposed span back to that one page and replace any synthesized or composite span before returning. Never repair a weak citation by borrowing identity or fact evidence from another page. explicitFactDateSpan must be null unless one passage on that same page co-binds the exact value and a date governing this exact provider, field, and value; retrieval dates, copyright years, and generic page-update dates do not qualify. NPPES or registry record enumeration, creation, or record-wide last-update dates do not date each fact and therefore do not qualify unless the page explicitly attaches that date to this exact value. Return a phone only when its cited page identifies a public professional voice number for an office, scheduling service, practice, clinic, facility, or hospital. Never emit fax or facsimile, mobile or cell, personal or home, or uncertain-purpose numbers. Return an address only when its cited page establishes a professional practice, clinic, facility, hospital, or office location for the exact provider. Never emit residential, people-search, or uncertain-purpose addresses. Omit prohibited or uncertain candidates completely rather than labeling them. A website value must be the exact URL of the consulted readable provider, practice, clinic, facility, or hospital page, and its citation.sourceUrl must be that same exact URL. For a website item, sourceUrl is the direct URL evidence; providerIdentitySpan and factSpan must quote page-local text that identifies the exact requested provider or compatible organization on that provider-specific or organization-specific page. Because sourceUrl itself is the URL evidence, website factSpan must copy the shortest exact provider or organization heading or name passage from the readable page; it need not repeat the URL or describe the website. providerIdentitySpan and factSpan may reuse the same exact contiguous text when that passage satisfies both roles. Never synthesize marketing or description text for either span. The page need not state who technically operates the site. Never construct or generalize an inspected subpage into an uninspected root. Apply the different-NPI and operational-bundle conflict rules before emitting the website. An identity-qualified first-party page may establish operation of its own URL and domain without a publication date; that is not a claimed fact date. Evaluate a domain independently from address and phone conflicts: do not reject it merely because another field on the site conflicts, but reject it when readable evidence binds the domain itself to a conflicting subpart, NPI, or operation. Explicit first-party rebranding, acquisition, ownership-continuity, or redirect evidence may attach the requested provider or compatible organization to its current domain. If another source lists a different domain without evidence that both operate concurrently, prefer the qualified current first-party URL and omit the unresolved legacy alternate. Reachability alone is insufficient. A directory profile is not a provider website. Do not search for, send back, infer, or discuss insurance, payer, health-plan, network, coverage, enrollment, or plan participation. Return a profile when any eligible fact remains, including a specialty-only profile, and use empty arrays for fact types without evidence. D34 field-local completion: finish selection independently for phone, address, website, and specialty. For phone and address, when an inspected provider-specific Q1 page directly supports an eligible professional value and the only competing evidence is an undated Q3 directory or other lower-tier value, emit the Q1 value as element zero rather than the Q3 value or an empty array. The requested city, state, or ZIP is only a possibly stale search hint: a lower-tier value matching the request cannot defeat Q1 on that basis. Missing fact dates do not make either value stale. Override or omit Q1 only for affirmative readable evidence that it is former, belongs to a different provider or incompatible operation, or is otherwise ineligible. Do not infer concurrent operation merely to emit both. Preserve independent compatible affiliations and all unrelated qualified facts. D34 citation-only completion: after every value is final, audit each item independently. When an already inspected readable exact-provider Q1 page supports the same complete value or faithful formatting equivalent, replace any Q2 or Q3 citation with that Q1 page. This substitution is mandatory, not a preference, and does not change the value. Never retain a lower-tier citation because it matches the requested location, and never cite an unread or access-challenge page when a readable same-value page was inspected. D34 website completion: treat an inspected eligible provider-specific first-party biography or team page as a website fact independently of the provider's other fields and affiliations. Multiple compatible current professional affiliations do not make such a page ambiguous and do not justify an empty websites array. Emit the best eligible page unless affirmative readable evidence establishes that it is former, identifies a different provider, or is bound to an incompatible provider operation. Apply the existing domain-implication rules first; affiliation variation alone is not a domain conflict. D34 credential-span rule: a specialty value may use a common unambiguous credential expansion, but its factSpan remains a source quotation. When the page says PA-C and the emitted value is Physician Assistant, copy the shortest exact credential text PA-C into factSpan; do not put Physician Assistant in factSpan unless that expanded wording appears verbatim on the cited page. Apply the same rule to any credential expansion. This is a citation rule, not a literal-only specialty eligibility gate. Citation quotation contract: factSpan is an exact source quotation independent of the normalized output value. Copy one shortest sufficient contiguous passage from the cited page exactly as rendered, except that removing markup or normalizing whitespace and Unicode typography is allowed without changing the visible words, tokens, or token order. Never invent a field label, expand or abbreviate a source token, change a word, substitute a postal abbreviation, or rewrite the quotation to match the normalized output. The output value may normalize the supported fact, but factSpan must preserve the source wording; for example, if the source says PA-C or West Virginia, the span must say PA-C or West Virginia even when the output value is Physician Assistant or WV. Field-local hierarchy contract: qualify evidence separately for every field before applying source priority. A Q1 page counts as Q1 evidence for a phone, address, specialty, or other non-website field only when its readable content exposes and supports that exact fact for the requested provider. A Q1 page that identifies the provider but does not expose the field is not evidence for that field and must not suppress an otherwise eligible exact-provider Q2 or Q3 fact. Emit and cite the eligible Q2 or Q3 fact rather than withholding it; never borrow a fact from a page that supplies identity only. Apply Q1 over Q2 over Q3 only among sources that each qualify for the same exact fact. First-party biography website contract: an inspected provider-specific first-party biography or team page is an eligible website when readable page content gives the provider's unambiguous full name, a compatible credential or specialty, and a compatible practice or location, unless affirmative readable evidence makes the page former, identifies a different provider, or binds it to an incompatible operation. The page does not need to repeat the NPI, phone, address, or another source's contact bundle. NPI and name remain primary identity context, and any surfaced relevant same-name different-NPI conflict still must be reconciled under the existing domain rules. Search stopping rule: the web-search call limit is a ceiling, not a target. Stop broadening or repeating searches once exact-provider identity is established, every selected fact has its own readable fact-local support, the best surfaced plausible first-party page has been inspected, and any surfaced relevant same-name or operational conflict that could change an emitted field has been resolved. Do not chase unrelated providers, unrelated NPIs, generic directories, or duplicate queries merely to spend remaining calls. Continue searching only for a specific missing field, unread cited page, unresolved relevant conflict, or surfaced better fact-local source that could change the output. Before returning, perform exactly one field-local output-completion pass using only evidence already consulted in this call. First remove facts whose own cited page body was not readable. Second replace a lower-tier citation when readable same-value Q1 support was inspected. Third emit remaining eligible Q1 websites and professional contacts rather than returning empty solely because an undated lower-tier source differs. Fourth preserve unrelated qualified facts. Then decide the website independently: after all provider-identity and different-NPI or different-operation domain rules, if at least one consulted readable first-party provider or organization page remains eligible, websites must contain the exact consulted URL of the best eligible page and must not be empty; use an empty array only when no such page remains eligible. A page's lack of NPI, publication date, address, phone, or its own URL in body text, and another source supplying other fields, are not reasons to omit an otherwise eligible website. All existing domain-implication and rescue rules apply before this completion requirement. A conflict in one field must never suppress unrelated eligible facts. Finally, when competing address or phone values lack affirmative evidence of concurrent operation, keep at most the one best eligible value. Use the supplied strict response schema. Do not put reasoning, audit labels, rejected candidates, classifications, policy commentary, fake data, or unavailable-value text in output fields. Use null for an absent nullable value and never punctuation placeholders.
```

The primary user-input template is:

```text
Find eligible public professional profile facts for these Medical providers.
Return one profile per requested provider when public facts are found. Use empty arrays for fact types with no eligible evidence.
Providers: <JSON array containing providerId, npi, name, specialty, city, state, and zip for each requested entity>
```

For the single identity-focused malformed-output recovery, the first two lines
are unchanged and each provider object contains only `providerId`, `npi`, and
`name`. The word “Medical” identifies the insurance product line of the calling
workflow; it is not a provider-entity classification or facility filter.
Individuals, groups, clinics, hospitals, and other facilities remain eligible
searched entities. Plan IDs, issuer data, network status, and participation
evidence never enter either template.

## Appendix B — Literal strict output format

The following is the exact `text.format` object generated by the SDK helper and
sent with the Responses request. It is the retained original full schema paired
with Appendix A, not the smaller shared-schema experiment. It uses strict JSON
Schema Structured Outputs.

```json
{
  "type": "json_schema",
  "name": "provider_profiles",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "profiles": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "providerId": {
              "type": "string",
              "nullable": true
            },
            "npi": {
              "type": "string",
              "nullable": true,
              "description": "The exact requested 10-digit NPI for this profile; never a nearby or same-name entity's NPI."
            },
            "providerName": {
              "type": "string",
              "description": "The requested provider or entity name attached to the requested NPI, not merely a same-name organization."
            },
            "specialties": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "value": {
                    "type": "string",
                    "description": "A professional specialty for the exact requested provider supported by this item's own cited page. Preserve source wording or use only a common unambiguous credential expansion, such as PA-C to Physician Assistant; never invent or broaden a specialty."
                  },
                  "citation": {
                    "type": "object",
                    "properties": {
                      "sourceUrl": {
                        "type": "string",
                        "description": "The exact URL associated with the consulted public http or https page whose readable body or rendered content was returned and inspected in this call and directly supports this same fact for the requested provider, whether that readable content was supplied with search or by opening the page. Never a search-results page, bare snippet, metadata-only, rate-limited, access-challenge, error, or unread page, a tool-action URL without readable page content, or a different corroborating page when readable same-value support was inspected. Qualify evidence for this field before applying source priority: a first-party page counts as Q1 for this item only when its readable content exposes and supports this exact fact, not merely provider identity. Before returning a government or directory URL, compare this exact selected value with every inspected readable exact-provider first-party page. If one such first-party page contains the same complete value and supports this same fact for the requested provider, this must be that exact first-party URL. Otherwise use inspected same-value government evidence before eligible directory evidence. If no Q1 page exposes this fact, do not withhold the fact. This citation choice never changes the selected value."
                      },
                      "sourceTitle": {
                        "type": "string",
                        "nullable": true,
                        "description": "The title of the cited page, or null when unavailable."
                      },
                      "providerIdentitySpan": {
                        "type": "string",
                        "description": "One short contiguous passage, item-local to this fact, or faithful rendered-text equivalent, from this cited page's readable body or rendered content. Copy the shortest sufficient passage verbatim whenever possible. Page-level identity qualification may use all readable content on this same page, including exact-NPI evidence in a separate region; do not require this local span to contain NPI merely because the page shows NPI elsewhere. This span must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location after same-name different-NPI bundle reconciliation. A shortened given-name-plus-surname passage without local NPI is insufficient by itself, especially for a common name. It may serve as this item-local span only when all readable content on the same provider-specific page semantically reconciles it to the exact requested provider through multiple distinct compatible biographical identifiers beyond the shortened name—for example, training or education together with compatible specialty or location—and there is no conflicting-provider evidence. NPI and full requested name remain primary identity evidence. Specialty alone, location alone, general branding, or affiliation is never sufficient for this exception. A faithful rendered-text equivalent may normalize only markup, whitespace, punctuation, capitalization, or standard value formatting while preserving source token order; it must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions. Never use ellipses, combine noncontiguous passages, paraphrase, or quote only a page title; apply this rule within this span whenever supporting page text exists."
                      },
                      "factSpan": {
                        "type": "string",
                        "description": "One short contiguous passage, item-local to this fact, copied as an exact source quotation from this same cited page's readable body or rendered content. Copy the shortest sufficient passage verbatim. It is separate from providerIdentitySpan and need not be adjacent to identity or page-level NPI evidence; it is also independent of the normalized output value. Preserve the source's visible words, tokens, and token order. You may remove markup or normalize whitespace and Unicode typography only when the rendered words do not change, preserving source token order. It must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions; it also must never expand or abbreviate a source token, change a word, or substitute a postal abbreviation. Never use ellipses, combine noncontiguous passages, paraphrase, quote only a page title, or use text for another field or entity. The exact quotation must semantically support the complete emitted value or faithful formatting equivalent and bind it to this fact type for the identity-qualified provider, but it must not be rewritten to match normalization. For a common unambiguous credential expansion, copy the shortest exact source credential text, such as PA-C, rather than the expanded emitted specialty. If the output expands PA-C to Physician Assistant or normalizes West Virginia to WV, copy PA-C or West Virginia exactly as the source renders it."
                      },
                      "explicitFactDateSpan": {
                        "type": "string",
                        "nullable": true,
                        "description": "A contiguous passage from that page that co-binds the complete exact value and an explicit effective or current date governing this exact provider, field, and value, or null when no such passage exists. Retrieval dates and copyright years do not qualify. Generic page-update dates do not qualify. NPPES or registry enumeration, creation, or record-wide last-update dates do not date each fact and do not qualify. Undated supported evidence remains eligible."
                      }
                    },
                    "required": [
                      "sourceUrl",
                      "sourceTitle",
                      "providerIdentitySpan",
                      "factSpan",
                      "explicitFactDateSpan"
                    ],
                    "additionalProperties": false,
                    "description": "Evidence from this item's exact consulted readable page. providerIdentitySpan must identify the requested provider. factSpan is independent of the normalized specialty value and must copy the shortest exact specialty wording, credential, or other source quotation from the page and bind it to that provider. When value expands a common unambiguous credential, such as PA-C to Physician Assistant, factSpan must quote PA-C rather than the expansion unless Physician Assistant appears verbatim on this page. A Q1 identity page that does not expose this specialty is not Q1 specialty evidence and must not suppress eligible exact-provider Q2 or Q3 specialty evidence. Do not apply a literal-only specialty wording gate; this exact-span requirement governs the citation, not specialty eligibility. Never use a different fact item's source or span."
                  }
                },
                "required": [
                  "value",
                  "citation"
                ],
                "additionalProperties": false
              }
            },
            "locations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "addressLine1": {
                    "type": "string",
                    "description": "Street line for a verified professional practice, clinic, facility, hospital, or office location for the exact provider. A place, facility, campus, or school name without a complete civic or postal address is not an address record. A distinct-address additional office remains eligible under ordinary identity and conflict rules."
                  },
                  "addressLine2": {
                    "type": "string",
                    "nullable": true,
                    "description": "Professional suite or secondary address line, or null. For an Entity Type 2 organization, omit a suite or organizational subpart from a same-name first-party bundle at the same base street when it conflicts with exact-NPI evidence, unless affirmative evidence attaches that exact value to the requested NPI or establishes shared or concurrent use for the requested organization."
                  },
                  "city": {
                    "type": "string",
                    "nullable": true,
                    "description": "City for the verified professional location, or null."
                  },
                  "state": {
                    "type": "string",
                    "nullable": true,
                    "description": "State for the verified professional location, or null."
                  },
                  "zip": {
                    "type": "string",
                    "nullable": true,
                    "description": "ZIP code for the verified professional location, or null."
                  },
                  "citation": {
                    "type": "object",
                    "properties": {
                      "sourceUrl": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl"
                      },
                      "sourceTitle": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
                      },
                      "providerIdentitySpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan"
                      },
                      "factSpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan"
                      },
                      "explicitFactDateSpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
                      }
                    },
                    "required": [
                      "sourceUrl",
                      "sourceTitle",
                      "providerIdentitySpan",
                      "factSpan",
                      "explicitFactDateSpan"
                    ],
                    "additionalProperties": false,
                    "description": "Evidence from this location item's one exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must be an exact source quotation semantically supporting every non-null material serialized component of this normalized address, including the complete ZIP or ZIP+4, and establish it as a professional location. Preserve source tokens such as Street or West Virginia even when the output normalizes them to St or WV; never rewrite the quotation to match output normalization. A Q1 identity page that does not expose this address is not Q1 address evidence and must not suppress eligible exact-provider Q2 or Q3 address evidence. Never borrow an address component from another page or use another location's, phone's, or website's evidence."
                  }
                },
                "required": [
                  "addressLine1",
                  "addressLine2",
                  "city",
                  "state",
                  "zip",
                  "citation"
                ],
                "additionalProperties": false
              },
              "description": "Verified professional practice, office, clinic, facility, or hospital locations for the exact provider only, ordered for display. For an Entity Type 2 organization, one inspected provider-specific first-party page that directly co-binds the exact organization to a complete distinct-base-address professional office, with no conflicting-NPI or conflicting-operation evidence, may establish a compatible additional office. Qualify and cite any phone for that office independently; neither field is required to emit the other. A place, facility, campus, or school name without a complete civic or postal address is not an address record. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing location only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible location. A registry label such as Secondary Practice Location does not by itself prove current concurrent operation; never emit multiple conflicting registry-only location bundles on that basis. Never residential, people-search, or uncertain-purpose addresses."
            },
            "phoneNumbers": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "value": {
                    "type": "string",
                    "description": "A professional voice phone number for the exact provider. For an Entity Type 1 individual, an exact-NPI identity-qualified active first-party provider page directly presenting the current professional voice phone takes precedence over a bare conflicting registry or directory listing unless affirmative contrary evidence establishes that it is former, another provider's, or nonprofessional. For an Entity Type 2 organization, when exact-NPI evidence establishes the requested organization's exact legal, DBA, or alias name and complete professional location, and a readable first-party page co-binds that same exact name and location to a displayed professional voice phone, that affirmatively attaches the phone to the requested organization. A different undated registry or directory phone alone does not establish another operation and must not suppress the Q1 phone. This does not rescue a page, domain, or phone readably assigned to another NPI, organizational subpart, or incompatible operation. Never a fax, mobile, cell, personal, home, or uncertain-purpose number."
                  },
                  "citation": {
                    "type": "object",
                    "properties": {
                      "sourceUrl": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl"
                      },
                      "sourceTitle": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
                      },
                      "providerIdentitySpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan"
                      },
                      "factSpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan"
                      },
                      "explicitFactDateSpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
                      }
                    },
                    "required": [
                      "sourceUrl",
                      "sourceTitle",
                      "providerIdentitySpan",
                      "factSpan",
                      "explicitFactDateSpan"
                    ],
                    "additionalProperties": false,
                    "description": "Evidence from this phone item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must be an exact source quotation containing all digits of this normalized phone and establish it as a professional voice contact. Preserve the source's displayed phone formatting rather than rewriting the span to match output normalization. A Q1 identity page that does not expose this phone is not Q1 phone evidence and must not suppress eligible exact-provider Q2 or Q3 phone evidence. An exact-provider name plus compatible location on a first-party provider or facility page affirmatively attaches a displayed professional phone even when the facility number is shared; shared use alone is not a conflict. Never use another phone's, address's, or website's evidence."
                  }
                },
                "required": [
                  "value",
                  "citation"
                ],
                "additionalProperties": false
              },
              "description": "Verified professional voice contacts for the exact provider only, ordered for display. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing phone only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible phone. A registry label such as Secondary Practice Location does not by itself prove current concurrent operation; never emit multiple conflicting registry-only phone bundles on that basis. The array must not be empty merely because an undated lower-tier source differs when an eligible Q1 professional phone remains. It also must not select a Q3 phone instead of that eligible provider-specific Q1 phone, absent affirmative readable evidence of ineligibility, former status, a different provider, or an incompatible operation. Requested location is a possibly stale search hint and cannot make the Q3 phone defeat Q1. Never fax, mobile, cell, personal, home, or uncertain-purpose numbers."
            },
            "websites": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "value": {
                    "type": "string",
                    "description": "The exact URL of a consulted readable provider-specific or organization-specific provider, practice, clinic, facility, or hospital page for the exact requested provider or compatible organization. This value must equal this item's citation.sourceUrl. A provider-specific first-party biography or team page is eligible when its readable content gives the provider's unambiguous full name, a compatible credential or specialty, and a compatible practice or location; it need not repeat the NPI, phone, address, or another source's contact bundle. When search surfaces the same organization name under another NPI, this item is eligible only after readable evidence for that NPI is inspected and the cited page is not co-bound to its conflicting operational bundle; if that evidence cannot be inspected, omit the website. Same name, branding, or base-street overlap is insufficient. Evaluate the domain field-locally: an address, suite, or phone conflict alone does not implicate it. For an otherwise-unimplicated domain, readable exact-NPI evidence confirming the organization's legal, DBA, or alias name plus readable content from the inspected first-party page that co-binds that exact confirmed name to the requested organization requires emitting that exact consulted page URL as the website even when the page omits the NPI. A compatible complete professional address corroborates this attachment but is not mandatory. Explicit first-party rebranding, acquisition, ownership-continuity, or redirect evidence may establish that attachment for an implicated domain. Omit the domain when affirmative readable evidence binds it to a conflicting organizational subpart, different NPI, or different provider operation and no domain-specific rescue establishes attachment to the requested provider or shared or concurrent use. This domain rule never validates an address or phone. Never an inferred or uninspected root, directory profile, or page or domain implicated in an unresolved different-NPI or different-operation bundle."
                  },
                  "citation": {
                    "type": "object",
                    "properties": {
                      "sourceUrl": {
                        "type": "string",
                        "description": "The exact URL of this consulted readable provider, practice, clinic, facility, or hospital page. It is the website value's direct URL evidence and must exactly equal the emitted website value. Never an inferred or uninspected root, a search-results page, a bare snippet, metadata-only result, or an unread page."
                      },
                      "sourceTitle": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
                      },
                      "providerIdentitySpan": {
                        "type": "string",
                        "description": "The shortest sufficient contiguous passage, item-local to this website, copied from this page's readable body or rendered content. The cited page must be a provider-specific or organization-specific page. First qualify the whole page for the exact requested provider using all readable page content, including exact-NPI evidence in a separate region when present. This local span must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location after different-NPI and operational-bundle reconciliation; do not require NPI here merely because it appears elsewhere on the page. A shortened given-name-plus-surname passage without local NPI is insufficient by itself, especially for a common name. It may serve as this item-local span only when all readable content on the same provider-specific page semantically reconciles it to the exact requested provider through multiple distinct compatible biographical identifiers beyond the shortened name—for example, training or education together with compatible specialty or location—and there is no conflicting-provider evidence. NPI and full requested name remain primary identity evidence. Specialty alone, location alone, general branding, or affiliation is never sufficient for this exception. Normalize only markup, whitespace, punctuation, capitalization, or standard value formatting while preserving source token order; never invent labels, omit intervening text, reorder tokens, or concatenate separate page regions. The page need not state who technically operates the site."
                      },
                      "factSpan": {
                        "type": "string",
                        "description": "The shortest sufficient contiguous page-local passage copied from this page as an exact quotation from its readable body or rendered content that identifies the exact requested provider or compatible organization on this provider-specific or organization-specific page. Because the cited sourceUrl itself is the URL evidence, copy the shortest exact provider or organization heading or name passage; this span need not repeat the URL or state who technically operates the site. providerIdentitySpan and factSpan may reuse the same exact contiguous text when that passage satisfies both roles. Never synthesize marketing or description text. You may remove markup or normalize whitespace and Unicode typography only when the rendered words, tokens, and token order do not change. Never invent labels, omit intervening text, reorder tokens, or concatenate separate page regions; never expand or abbreviate tokens. Never borrow another item's evidence or use text that only supports an address or phone without making the page specific to the requested provider or compatible organization."
                      },
                      "explicitFactDateSpan": {
                        "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
                      }
                    },
                    "required": [
                      "sourceUrl",
                      "sourceTitle",
                      "providerIdentitySpan",
                      "factSpan",
                      "explicitFactDateSpan"
                    ],
                    "additionalProperties": false,
                    "description": "Evidence from this exact consulted readable page. sourceUrl itself is the website URL evidence. providerIdentitySpan must identify the requested provider, and providerIdentitySpan and factSpan must contain exact page-local quotations making this page specific to the exact requested provider or compatible organization; when a same-name different-NPI organization was surfaced, those spans support a website only after readable evidence for that other NPI was inspected and no unresolved operational-bundle conflict remains. An eligible provider-specific first-party biography or team page with unambiguous full name, compatible credential or specialty, and compatible practice or location remains independently eligible across multiple compatible current affiliations unless affirmative readable evidence makes it former, a different provider's page, or part of an incompatible operation. The page need not state who technically operates the site or repeat the NPI, phone, address, or another source's contact bundle, and factSpan need not repeat the URL. Title-only evidence is insufficient, and an address-only or phone-only passage cannot support a website unless it also makes the page provider-specific or organization-specific. Never borrow another item's evidence."
                  }
                },
                "required": [
                  "value",
                  "citation"
                ],
                "additionalProperties": false
              },
              "description": "Mandatory website-completion output. Apply all provider-identity and different-NPI or different-operation domain rules first. If one or more consulted readable first-party provider or organization pages remains eligible, this array must contain the exact consulted URL of the best eligible page and must not be empty. An eligible provider-specific first-party biography or team page remains independently eligible even when the provider has multiple compatible current professional affiliations when it gives the provider's unambiguous full name, a compatible credential or specialty, and a compatible practice or location; affiliation variation alone does not justify an empty array or suppress unrelated facts. Use an empty array only when no such page remains eligible, including after affirmative readable former, different-provider, or incompatible-operation evidence. An otherwise eligible page need not show an NPI, publication date, address, phone, contact parity with another source, or its own URL in body text. Index zero must be the best eligible default after conflict resolution and source hierarchy. Additional domains require affirmative evidence of concurrent operation. Before leaving this array empty because of an alternate-NPI lead, apply the relevance gate in the instructions. A merely similar but nonmatching name, unrelated base address, or appearance in a site/domain query cannot suppress an otherwise eligible page without readable operational-bundle or exact-domain co-binding. A same-complete-name alternate NPI whose assigned operational value is displayed by the candidate page remains relevant."
            }
          },
          "required": [
            "providerId",
            "npi",
            "providerName",
            "specialties",
            "locations",
            "phoneNumbers",
            "websites"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "profiles"
    ],
    "additionalProperties": false,
    "definitions": {
      "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl": {
        "type": "string",
        "description": "The exact URL associated with the consulted public http or https page whose readable body or rendered content was returned and inspected in this call and directly supports this same fact for the requested provider, whether that readable content was supplied with search or by opening the page. Never a search-results page, bare snippet, metadata-only, rate-limited, access-challenge, error, or unread page, a tool-action URL without readable page content, or a different corroborating page when readable same-value support was inspected. Qualify evidence for this field before applying source priority: a first-party page counts as Q1 for this item only when its readable content exposes and supports this exact fact, not merely provider identity. Before returning a government or directory URL, compare this exact selected value with every inspected readable exact-provider first-party page. If one such first-party page contains the same complete value and supports this same fact for the requested provider, this must be that exact first-party URL. Otherwise use inspected same-value government evidence before eligible directory evidence. If no Q1 page exposes this fact, do not withhold the fact. This citation choice never changes the selected value."
      },
      "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle": {
        "type": "string",
        "nullable": true,
        "description": "The title of the cited page, or null when unavailable."
      },
      "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan": {
        "type": "string",
        "description": "One short contiguous passage, item-local to this fact, or faithful rendered-text equivalent, from this cited page's readable body or rendered content. Copy the shortest sufficient passage verbatim whenever possible. Page-level identity qualification may use all readable content on this same page, including exact-NPI evidence in a separate region; do not require this local span to contain NPI merely because the page shows NPI elsewhere. This span must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location after same-name different-NPI bundle reconciliation. A shortened given-name-plus-surname passage without local NPI is insufficient by itself, especially for a common name. It may serve as this item-local span only when all readable content on the same provider-specific page semantically reconciles it to the exact requested provider through multiple distinct compatible biographical identifiers beyond the shortened name—for example, training or education together with compatible specialty or location—and there is no conflicting-provider evidence. NPI and full requested name remain primary identity evidence. Specialty alone, location alone, general branding, or affiliation is never sufficient for this exception. A faithful rendered-text equivalent may normalize only markup, whitespace, punctuation, capitalization, or standard value formatting while preserving source token order; it must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions. Never use ellipses, combine noncontiguous passages, paraphrase, or quote only a page title; apply this rule within this span whenever supporting page text exists."
      },
      "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan": {
        "type": "string",
        "description": "One short contiguous passage, item-local to this fact, copied as an exact source quotation from this same cited page's readable body or rendered content. Copy the shortest sufficient passage verbatim. It is separate from providerIdentitySpan and need not be adjacent to identity or page-level NPI evidence; it is also independent of the normalized output value. Preserve the source's visible words, tokens, and token order. You may remove markup or normalize whitespace and Unicode typography only when the rendered words do not change, preserving source token order. It must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions; it also must never expand or abbreviate a source token, change a word, or substitute a postal abbreviation. Never use ellipses, combine noncontiguous passages, paraphrase, quote only a page title, or use text for another field or entity. The exact quotation must semantically support the complete emitted value or faithful formatting equivalent and bind it to this fact type for the identity-qualified provider, but it must not be rewritten to match normalization. For a common unambiguous credential expansion, copy the shortest exact source credential text, such as PA-C, rather than the expanded emitted specialty. If the output expands PA-C to Physician Assistant or normalizes West Virginia to WV, copy PA-C or West Virginia exactly as the source renders it."
      },
      "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan": {
        "type": "string",
        "nullable": true,
        "description": "A contiguous passage from that page that co-binds the complete exact value and an explicit effective or current date governing this exact provider, field, and value, or null when no such passage exists. Retrieval dates and copyright years do not qualify. Generic page-update dates do not qualify. NPPES or registry enumeration, creation, or record-wide last-update dates do not date each fact and do not qualify. Undated supported evidence remains eligible."
      },
      "provider_profiles": {
        "type": "object",
        "properties": {
          "profiles": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "providerId": {
                  "type": "string",
                  "nullable": true
                },
                "npi": {
                  "type": "string",
                  "nullable": true,
                  "description": "The exact requested 10-digit NPI for this profile; never a nearby or same-name entity's NPI."
                },
                "providerName": {
                  "type": "string",
                  "description": "The requested provider or entity name attached to the requested NPI, not merely a same-name organization."
                },
                "specialties": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "string",
                        "description": "A professional specialty for the exact requested provider supported by this item's own cited page. Preserve source wording or use only a common unambiguous credential expansion, such as PA-C to Physician Assistant; never invent or broaden a specialty."
                      },
                      "citation": {
                        "type": "object",
                        "properties": {
                          "sourceUrl": {
                            "type": "string",
                            "description": "The exact URL associated with the consulted public http or https page whose readable body or rendered content was returned and inspected in this call and directly supports this same fact for the requested provider, whether that readable content was supplied with search or by opening the page. Never a search-results page, bare snippet, metadata-only, rate-limited, access-challenge, error, or unread page, a tool-action URL without readable page content, or a different corroborating page when readable same-value support was inspected. Qualify evidence for this field before applying source priority: a first-party page counts as Q1 for this item only when its readable content exposes and supports this exact fact, not merely provider identity. Before returning a government or directory URL, compare this exact selected value with every inspected readable exact-provider first-party page. If one such first-party page contains the same complete value and supports this same fact for the requested provider, this must be that exact first-party URL. Otherwise use inspected same-value government evidence before eligible directory evidence. If no Q1 page exposes this fact, do not withhold the fact. This citation choice never changes the selected value."
                          },
                          "sourceTitle": {
                            "type": "string",
                            "nullable": true,
                            "description": "The title of the cited page, or null when unavailable."
                          },
                          "providerIdentitySpan": {
                            "type": "string",
                            "description": "One short contiguous passage, item-local to this fact, or faithful rendered-text equivalent, from this cited page's readable body or rendered content. Copy the shortest sufficient passage verbatim whenever possible. Page-level identity qualification may use all readable content on this same page, including exact-NPI evidence in a separate region; do not require this local span to contain NPI merely because the page shows NPI elsewhere. This span must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location after same-name different-NPI bundle reconciliation. A shortened given-name-plus-surname passage without local NPI is insufficient by itself, especially for a common name. It may serve as this item-local span only when all readable content on the same provider-specific page semantically reconciles it to the exact requested provider through multiple distinct compatible biographical identifiers beyond the shortened name—for example, training or education together with compatible specialty or location—and there is no conflicting-provider evidence. NPI and full requested name remain primary identity evidence. Specialty alone, location alone, general branding, or affiliation is never sufficient for this exception. A faithful rendered-text equivalent may normalize only markup, whitespace, punctuation, capitalization, or standard value formatting while preserving source token order; it must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions. Never use ellipses, combine noncontiguous passages, paraphrase, or quote only a page title; apply this rule within this span whenever supporting page text exists."
                          },
                          "factSpan": {
                            "type": "string",
                            "description": "One short contiguous passage, item-local to this fact, copied as an exact source quotation from this same cited page's readable body or rendered content. Copy the shortest sufficient passage verbatim. It is separate from providerIdentitySpan and need not be adjacent to identity or page-level NPI evidence; it is also independent of the normalized output value. Preserve the source's visible words, tokens, and token order. You may remove markup or normalize whitespace and Unicode typography only when the rendered words do not change, preserving source token order. It must not invent labels, omit intervening text, reorder tokens, or concatenate separate page regions; it also must never expand or abbreviate a source token, change a word, or substitute a postal abbreviation. Never use ellipses, combine noncontiguous passages, paraphrase, quote only a page title, or use text for another field or entity. The exact quotation must semantically support the complete emitted value or faithful formatting equivalent and bind it to this fact type for the identity-qualified provider, but it must not be rewritten to match normalization. For a common unambiguous credential expansion, copy the shortest exact source credential text, such as PA-C, rather than the expanded emitted specialty. If the output expands PA-C to Physician Assistant or normalizes West Virginia to WV, copy PA-C or West Virginia exactly as the source renders it."
                          },
                          "explicitFactDateSpan": {
                            "type": "string",
                            "nullable": true,
                            "description": "A contiguous passage from that page that co-binds the complete exact value and an explicit effective or current date governing this exact provider, field, and value, or null when no such passage exists. Retrieval dates and copyright years do not qualify. Generic page-update dates do not qualify. NPPES or registry enumeration, creation, or record-wide last-update dates do not date each fact and do not qualify. Undated supported evidence remains eligible."
                          }
                        },
                        "required": [
                          "sourceUrl",
                          "sourceTitle",
                          "providerIdentitySpan",
                          "factSpan",
                          "explicitFactDateSpan"
                        ],
                        "additionalProperties": false,
                        "description": "Evidence from this item's exact consulted readable page. providerIdentitySpan must identify the requested provider. factSpan is independent of the normalized specialty value and must copy the shortest exact specialty wording, credential, or other source quotation from the page and bind it to that provider. When value expands a common unambiguous credential, such as PA-C to Physician Assistant, factSpan must quote PA-C rather than the expansion unless Physician Assistant appears verbatim on this page. A Q1 identity page that does not expose this specialty is not Q1 specialty evidence and must not suppress eligible exact-provider Q2 or Q3 specialty evidence. Do not apply a literal-only specialty wording gate; this exact-span requirement governs the citation, not specialty eligibility. Never use a different fact item's source or span."
                      }
                    },
                    "required": [
                      "value",
                      "citation"
                    ],
                    "additionalProperties": false
                  }
                },
                "locations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "addressLine1": {
                        "type": "string",
                        "description": "Street line for a verified professional practice, clinic, facility, hospital, or office location for the exact provider. A place, facility, campus, or school name without a complete civic or postal address is not an address record. A distinct-address additional office remains eligible under ordinary identity and conflict rules."
                      },
                      "addressLine2": {
                        "type": "string",
                        "nullable": true,
                        "description": "Professional suite or secondary address line, or null. For an Entity Type 2 organization, omit a suite or organizational subpart from a same-name first-party bundle at the same base street when it conflicts with exact-NPI evidence, unless affirmative evidence attaches that exact value to the requested NPI or establishes shared or concurrent use for the requested organization."
                      },
                      "city": {
                        "type": "string",
                        "nullable": true,
                        "description": "City for the verified professional location, or null."
                      },
                      "state": {
                        "type": "string",
                        "nullable": true,
                        "description": "State for the verified professional location, or null."
                      },
                      "zip": {
                        "type": "string",
                        "nullable": true,
                        "description": "ZIP code for the verified professional location, or null."
                      },
                      "citation": {
                        "type": "object",
                        "properties": {
                          "sourceUrl": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl"
                          },
                          "sourceTitle": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
                          },
                          "providerIdentitySpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan"
                          },
                          "factSpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan"
                          },
                          "explicitFactDateSpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
                          }
                        },
                        "required": [
                          "sourceUrl",
                          "sourceTitle",
                          "providerIdentitySpan",
                          "factSpan",
                          "explicitFactDateSpan"
                        ],
                        "additionalProperties": false,
                        "description": "Evidence from this location item's one exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must be an exact source quotation semantically supporting every non-null material serialized component of this normalized address, including the complete ZIP or ZIP+4, and establish it as a professional location. Preserve source tokens such as Street or West Virginia even when the output normalizes them to St or WV; never rewrite the quotation to match output normalization. A Q1 identity page that does not expose this address is not Q1 address evidence and must not suppress eligible exact-provider Q2 or Q3 address evidence. Never borrow an address component from another page or use another location's, phone's, or website's evidence."
                      }
                    },
                    "required": [
                      "addressLine1",
                      "addressLine2",
                      "city",
                      "state",
                      "zip",
                      "citation"
                    ],
                    "additionalProperties": false
                  },
                  "description": "Verified professional practice, office, clinic, facility, or hospital locations for the exact provider only, ordered for display. For an Entity Type 2 organization, one inspected provider-specific first-party page that directly co-binds the exact organization to a complete distinct-base-address professional office, with no conflicting-NPI or conflicting-operation evidence, may establish a compatible additional office. Qualify and cite any phone for that office independently; neither field is required to emit the other. A place, facility, campus, or school name without a complete civic or postal address is not an address record. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing location only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible location. A registry label such as Secondary Practice Location does not by itself prove current concurrent operation; never emit multiple conflicting registry-only location bundles on that basis. Never residential, people-search, or uncertain-purpose addresses."
                },
                "phoneNumbers": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "string",
                        "description": "A professional voice phone number for the exact provider. For an Entity Type 1 individual, an exact-NPI identity-qualified active first-party provider page directly presenting the current professional voice phone takes precedence over a bare conflicting registry or directory listing unless affirmative contrary evidence establishes that it is former, another provider's, or nonprofessional. For an Entity Type 2 organization, when exact-NPI evidence establishes the requested organization's exact legal, DBA, or alias name and complete professional location, and a readable first-party page co-binds that same exact name and location to a displayed professional voice phone, that affirmatively attaches the phone to the requested organization. A different undated registry or directory phone alone does not establish another operation and must not suppress the Q1 phone. This does not rescue a page, domain, or phone readably assigned to another NPI, organizational subpart, or incompatible operation. Never a fax, mobile, cell, personal, home, or uncertain-purpose number."
                      },
                      "citation": {
                        "type": "object",
                        "properties": {
                          "sourceUrl": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl"
                          },
                          "sourceTitle": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
                          },
                          "providerIdentitySpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan"
                          },
                          "factSpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan"
                          },
                          "explicitFactDateSpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
                          }
                        },
                        "required": [
                          "sourceUrl",
                          "sourceTitle",
                          "providerIdentitySpan",
                          "factSpan",
                          "explicitFactDateSpan"
                        ],
                        "additionalProperties": false,
                        "description": "Evidence from this phone item's exact consulted readable page. providerIdentitySpan must identify the requested provider; factSpan must be an exact source quotation containing all digits of this normalized phone and establish it as a professional voice contact. Preserve the source's displayed phone formatting rather than rewriting the span to match output normalization. A Q1 identity page that does not expose this phone is not Q1 phone evidence and must not suppress eligible exact-provider Q2 or Q3 phone evidence. An exact-provider name plus compatible location on a first-party provider or facility page affirmatively attaches a displayed professional phone even when the facility number is shared; shared use alone is not a conflict. Never use another phone's, address's, or website's evidence."
                      }
                    },
                    "required": [
                      "value",
                      "citation"
                    ],
                    "additionalProperties": false
                  },
                  "description": "Verified professional voice contacts for the exact provider only, ordered for display. Index zero must be the best eligible default after evidence qualification, conflict resolution, fact-applicable recency, and source hierarchy. Emit more than one competing phone only when consulted evidence affirmatively establishes concurrent compatibility; otherwise emit at most the one best eligible phone. A registry label such as Secondary Practice Location does not by itself prove current concurrent operation; never emit multiple conflicting registry-only phone bundles on that basis. The array must not be empty merely because an undated lower-tier source differs when an eligible Q1 professional phone remains. It also must not select a Q3 phone instead of that eligible provider-specific Q1 phone, absent affirmative readable evidence of ineligibility, former status, a different provider, or an incompatible operation. Requested location is a possibly stale search hint and cannot make the Q3 phone defeat Q1. Never fax, mobile, cell, personal, home, or uncertain-purpose numbers."
                },
                "websites": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "value": {
                        "type": "string",
                        "description": "The exact URL of a consulted readable provider-specific or organization-specific provider, practice, clinic, facility, or hospital page for the exact requested provider or compatible organization. This value must equal this item's citation.sourceUrl. A provider-specific first-party biography or team page is eligible when its readable content gives the provider's unambiguous full name, a compatible credential or specialty, and a compatible practice or location; it need not repeat the NPI, phone, address, or another source's contact bundle. When search surfaces the same organization name under another NPI, this item is eligible only after readable evidence for that NPI is inspected and the cited page is not co-bound to its conflicting operational bundle; if that evidence cannot be inspected, omit the website. Same name, branding, or base-street overlap is insufficient. Evaluate the domain field-locally: an address, suite, or phone conflict alone does not implicate it. For an otherwise-unimplicated domain, readable exact-NPI evidence confirming the organization's legal, DBA, or alias name plus readable content from the inspected first-party page that co-binds that exact confirmed name to the requested organization requires emitting that exact consulted page URL as the website even when the page omits the NPI. A compatible complete professional address corroborates this attachment but is not mandatory. Explicit first-party rebranding, acquisition, ownership-continuity, or redirect evidence may establish that attachment for an implicated domain. Omit the domain when affirmative readable evidence binds it to a conflicting organizational subpart, different NPI, or different provider operation and no domain-specific rescue establishes attachment to the requested provider or shared or concurrent use. This domain rule never validates an address or phone. Never an inferred or uninspected root, directory profile, or page or domain implicated in an unresolved different-NPI or different-operation bundle."
                      },
                      "citation": {
                        "type": "object",
                        "properties": {
                          "sourceUrl": {
                            "type": "string",
                            "description": "The exact URL of this consulted readable provider, practice, clinic, facility, or hospital page. It is the website value's direct URL evidence and must exactly equal the emitted website value. Never an inferred or uninspected root, a search-results page, a bare snippet, metadata-only result, or an unread page."
                          },
                          "sourceTitle": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
                          },
                          "providerIdentitySpan": {
                            "type": "string",
                            "description": "The shortest sufficient contiguous passage, item-local to this website, copied from this page's readable body or rendered content. The cited page must be a provider-specific or organization-specific page. First qualify the whole page for the exact requested provider using all readable page content, including exact-NPI evidence in a separate region when present. This local span must ordinarily contain either the exact requested NPI, or the exact requested professional name plus a compatible disambiguating organization or location after different-NPI and operational-bundle reconciliation; do not require NPI here merely because it appears elsewhere on the page. A shortened given-name-plus-surname passage without local NPI is insufficient by itself, especially for a common name. It may serve as this item-local span only when all readable content on the same provider-specific page semantically reconciles it to the exact requested provider through multiple distinct compatible biographical identifiers beyond the shortened name—for example, training or education together with compatible specialty or location—and there is no conflicting-provider evidence. NPI and full requested name remain primary identity evidence. Specialty alone, location alone, general branding, or affiliation is never sufficient for this exception. Normalize only markup, whitespace, punctuation, capitalization, or standard value formatting while preserving source token order; never invent labels, omit intervening text, reorder tokens, or concatenate separate page regions. The page need not state who technically operates the site."
                          },
                          "factSpan": {
                            "type": "string",
                            "description": "The shortest sufficient contiguous page-local passage copied from this page as an exact quotation from its readable body or rendered content that identifies the exact requested provider or compatible organization on this provider-specific or organization-specific page. Because the cited sourceUrl itself is the URL evidence, copy the shortest exact provider or organization heading or name passage; this span need not repeat the URL or state who technically operates the site. providerIdentitySpan and factSpan may reuse the same exact contiguous text when that passage satisfies both roles. Never synthesize marketing or description text. You may remove markup or normalize whitespace and Unicode typography only when the rendered words, tokens, and token order do not change. Never invent labels, omit intervening text, reorder tokens, or concatenate separate page regions; never expand or abbreviate tokens. Never borrow another item's evidence or use text that only supports an address or phone without making the page specific to the requested provider or compatible organization."
                          },
                          "explicitFactDateSpan": {
                            "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
                          }
                        },
                        "required": [
                          "sourceUrl",
                          "sourceTitle",
                          "providerIdentitySpan",
                          "factSpan",
                          "explicitFactDateSpan"
                        ],
                        "additionalProperties": false,
                        "description": "Evidence from this exact consulted readable page. sourceUrl itself is the website URL evidence. providerIdentitySpan must identify the requested provider, and providerIdentitySpan and factSpan must contain exact page-local quotations making this page specific to the exact requested provider or compatible organization; when a same-name different-NPI organization was surfaced, those spans support a website only after readable evidence for that other NPI was inspected and no unresolved operational-bundle conflict remains. An eligible provider-specific first-party biography or team page with unambiguous full name, compatible credential or specialty, and compatible practice or location remains independently eligible across multiple compatible current affiliations unless affirmative readable evidence makes it former, a different provider's page, or part of an incompatible operation. The page need not state who technically operates the site or repeat the NPI, phone, address, or another source's contact bundle, and factSpan need not repeat the URL. Title-only evidence is insufficient, and an address-only or phone-only passage cannot support a website unless it also makes the page provider-specific or organization-specific. Never borrow another item's evidence."
                      }
                    },
                    "required": [
                      "value",
                      "citation"
                    ],
                    "additionalProperties": false
                  },
                  "description": "Mandatory website-completion output. Apply all provider-identity and different-NPI or different-operation domain rules first. If one or more consulted readable first-party provider or organization pages remains eligible, this array must contain the exact consulted URL of the best eligible page and must not be empty. An eligible provider-specific first-party biography or team page remains independently eligible even when the provider has multiple compatible current professional affiliations when it gives the provider's unambiguous full name, a compatible credential or specialty, and a compatible practice or location; affiliation variation alone does not justify an empty array or suppress unrelated facts. Use an empty array only when no such page remains eligible, including after affirmative readable former, different-provider, or incompatible-operation evidence. An otherwise eligible page need not show an NPI, publication date, address, phone, contact parity with another source, or its own URL in body text. Index zero must be the best eligible default after conflict resolution and source hierarchy. Additional domains require affirmative evidence of concurrent operation. Before leaving this array empty because of an alternate-NPI lead, apply the relevance gate in the instructions. A merely similar but nonmatching name, unrelated base address, or appearance in a site/domain query cannot suppress an otherwise eligible page without readable operational-bundle or exact-domain co-binding. A same-complete-name alternate NPI whose assigned operational value is displayed by the candidate page remains relevant."
                }
              },
              "required": [
                "providerId",
                "npi",
                "providerName",
                "specialties",
                "locations",
                "phoneNumbers",
                "websites"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "profiles"
        ],
        "additionalProperties": false
      }
    },
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

# Provider-profile validation and CMS response evidence

Status date: 2026-08-02 (America/New_York)

## Executive decision

Lucie should **not** ship the 11,196-byte short provider-profile contract
unchanged. It passed every frozen paired development gate, but its later sealed
holdout produced one confirmed prohibited fax-as-phone output, two parser
failures, and only 54/60 profiles with a phone, address, or website. The longer
86,769-byte source-quality predecessor remains the release candidate.

The short contract's material values were usually well supported: among 166
claims assessed by the fixed judge, 164 had exact whole-packet support, one was
contradicted, and one was unreadable. The contradicted claim was a first-party
fax emitted as a phone. Ten complete evidence packets exceeded the direct-
input ceiling and remained unknown; two other cases had no parsed production
profile. The safety-first stopping rule does not permit those strong average
results to override the confirmed prohibited contact.

This decision followed two controlled funnels. The source-quality study tested
**40 distinct production-shaped configurations** with live pilot requests,
advanced four to complete 60-provider development evaluations, and froze its
winner before a separate 60-provider holdout. The later minimization piloted
seven shorter contracts on development cases and ran complete paired
60-provider comparisons for the two shortest survivors.

The companion [CMS response](CMS_PROVIDER_AI_RESPONSE.md) includes the literal
evaluated short prompt and exact strict output schema as Appendices A and B.
The [minimization report](PROVIDER_PROMPT_MINIMIZATION_REPORT.md) records the
frozen paired development result and the later holdout reversal.

This is not a claim that the short contract generally returns incorrect facts.
It is a release decision based on a concrete safety defect, availability, and
the frozen stopping rule. The holdout is now validation evidence and must not
become a tuning set. A separately versioned narrow repair requires development-
set testing and fresh independent validation.

Across both controlled funnels Lucie tested **47 prompt or stack
configurations**: 40 source-quality configurations and seven shorter prompt
contracts. Four source-quality configurations advanced to complete
development evaluations; two prompt-minimization survivors received complete
paired development comparisons. The short development winner was frozen
before this holdout run.

## Evaluated short contract

The rejected-as-is 11,196-byte short contract used the Azure OpenAI Responses
API with:

- deployment `gpt-5.6-terra`;
- reasoning effort `low`;
- native `web_search`, required, with at most eight tool calls;
- strict SDK-native Zod Structured Outputs rather than a free-form request to
  write JSON;
- one LLM call per semantic attempt;
- an initial SDK retry allowance of one transport retry, followed by at most
  one non-stacking semantic recovery with SDK retries disabled: at most three
  HTTP sends total;
- identical full retry after a native refusal or completion content filter;
  identity-focused recovery after malformed strict output;
- no production host webpage fetch and no second LLM adjudication call;
- no plan, payer, network, coverage, enrollment, or participation data in the
  model prompt or output schema;
- no rating output; and
- direct per-fact evidence: `sourceUrl`, nullable `sourceTitle`,
  `providerIdentitySpan`, `factSpan`, and nullable `explicitFactDateSpan`.

Schema descriptions were removed after controlled development evaluation
suggested that the lean system policy plus strict field names and types
preserved performance. The holdout showed that this did not generalize: full
state names passed the lean structured schema but failed the downstream two-
letter-state parser, and verbatim citation-span fidelity worsened.

The profile endpoint is currently invoked from the medical-plan workflow, so
its public request envelope retains `lineOfCoverage: "Medical"` for API
compatibility. `Medical` identifies the insurance product line only. It is
orthogonal to provider entity type, is not used to exclude facilities, and the
request field is not serialized into provider objects or returned by the model.
The prompt's independent phrase “Medical providers” scopes the healthcare-
search domain; it does not narrow entity type. The service supports NPI Type 1 individual
practitioners and NPI Type 2 entities, including group practices, clinics,
hospitals, and other facilities. Network status remains the exclusive
responsibility of CMS and plan-directory APIs.

### Semantic and deterministic responsibilities

The model owns semantic decisions in the same call that performs search:
exact-provider attachment, professional purpose, personal/residential safety,
conflict resolution, source eligibility, fact-specific recency, source class,
and output order.

Host logic retains only narrow independently checkable invariants:

- strict types, bounds, and public HTTP(S) URL validity;
- request correlation and affirmative NPI/name mismatch rejection;
- removal of obvious placeholders and generation artifacts;
- phone digit sanity;
- a literal veto when an emitted value itself says fax, facsimile, mobile,
  cell, personal, home, residential, residence, or home address;
- website value equality with its own citation URL; and
- stable deduplication while preserving model order.

The host does not fetch the page, infer whether an unlabeled number is
personal or fax, classify a source as official, judge currentness, or reject an
address merely because it contains `apt` or `apartment`. In the confirmed
holdout defect, both the emitted phone value and fact span omitted the page's
`Fax` label, so the narrow literal veto could not act. Native Azure
annotation/action mismatches are telemetry rather than a destructive parser
gate because a valid structured citation is not guaranteed to be repeated in
every native provenance channel.

## CMS source and recency policy

The available CMS artifact asks how conflicts, validation, and multiple
results will be handled. It does not contain a verbatim CMS mandate defining a
source taxonomy. Lucie's tested implementation answers those questions with
the following policy:

1. Qualify each fact before prioritizing its source. The page must support the
   exact provider and exact fact, professional purpose, safe display, and a
   compatible location. Official branding cannot rescue an ineligible fact.
2. Resolve affirmative different-NPI or different-operation conflicts before
   recency or source rank. Shared use is not automatically a contradiction.
3. Among otherwise eligible evidence for the same fact, prefer an exact
   provider/practice/facility page, then an exact-provider government source
   including NPPES, then an established exact-provider professional directory.
4. NPPES is valid exact-NPI evidence but may be stale. A government page that
   reproduces the same registry record is not independent corroboration merely
   because it is official.
5. Use recency only when a page dates the exact provider, field, and value.
   Retrieval dates, copyright years, and registry enumeration, certification,
   or record-wide update dates do not date every fact.
6. Missing recency is neutral. An undated supported fact remains eligible; it
   is not rejected as stale and is never described as current merely because
   the page is official.
7. Resolve fields independently. A conflict in one field does not suppress an
   unrelated supported fact. Emit multiple competing values only with
   affirmative evidence that they are concurrently active.
8. Element zero is the default display value; later qualified values are shown
   behind “Show more.”

## Validation design

### Iteration history and development selection

Initial baseline, sanitizer, source-hierarchy, and direct-citation studies
identified the main failure modes: over-restrictive deterministic filtering,
weak fact-level citation attribution, source priority applied before evidence
qualification, and unnecessary plan context. The subsequent controlled
candidate-evolution phase exercised **40 distinct production-shaped
configurations in live pilots**. Most were tested only on targeted difficult
cases. **Four configurations advanced to a complete 60-provider development
battery.** The final two non-dominated configurations then received a paired
60-provider comparison under the same fixed evaluator. The winner was selected
and frozen before the separate 60-provider holdout was opened.

The source-quality predecessor's unique change over its final comparator was
deliberately narrow and prompt/schema-only:

- require exact, page-local source quotations for identity and each fact;
- apply source hierarchy only among pages qualified for that exact fact, with
  government or professional-directory fallback when a first-party page does
  not expose the field;
- recognize an unambiguous first-party biography or team page as website
  evidence without requiring it to repeat every contact field; and
- stop searching once identity, fact-local support, plausible first-party
  inspection, and relevant conflict resolution are complete.

The parser, provenance treatment, retry behavior, and narrow deterministic
sanitizer were unchanged from the final comparator. In the paired development
comparison, both finalists had zero validated major-safety failures and no
profile/all-contact loss. Fifty-eight providers were paired evaluable. The
source-quality predecessor won at the first unequal safety-first criterion: the
comparator emitted one readable materially unsupported address component,
while the predecessor emitted none. The predecessor had
one later partial own-citation detail that the comparator did not; the
preregistered lexicographic rule did not allow that later tradeoff to override
the earlier material-support result. These differences do not establish
universal or statistical superiority.

The two-configuration development production run cost an estimated `$10.2757645`; the
118 paid Sol/high judge calls cost `$83.879661`. Evaluation cost is not
production unit cost.

### Development-only prompt minimization

After the holdout was sealed, Lucie minimized the complete prompt contract
using only the same frozen 60-provider development battery. Static measurement
included the joined system instructions, fixed user scaffolding, and exact
strict JSON schema generated from Zod; dynamic provider values were excluded
and held identical between arms. This follows OpenAI's GPT-5.6 guidance to
start from a working prompt, remove one coherent group at a time, state each
instruction once, and rerun representative evaluations.

Seven shorter contracts were piloted on difficult development cases. The two
shortest survivors received complete paired 60-provider production runs and
the same corrected Sol/high categorical evaluator. The selected shared
sourced-value schema was the shortest passing candidate:

| Endpoint | Working predecessor | Short contract | Difference | Lower 95% bound |
| --- | ---: | ---: | ---: | ---: |
| Static contract bytes | 86,769 | 11,196 | -87.1% | — |
| Profile with eligible contact | 98.33% | 98.33% | 0.00 pp | 0.00 pp |
| Exact whole-packet material support | 99.38% | 99.38% | +0.004 pp | -1.82 pp |
| Exact own-citation support | 99.36% | 98.05% | -1.31 pp | -4.64 pp |
| Exact provider identity | 100% | 100% | 0.00 pp | 0.00 pp |

All four paired endpoints cleared the frozen -5 percentage-point margin. Both
arms returned 60/60 parsed profiles. The short arm introduced zero new wrong-
provider/NPI attachments, unsupported material facts, unsafe personal or
residential contacts, or material contradictions. Net affected-case changes
were -2 for withholding, -4 for lower-tier selection, +2 for span defects, and
-6 for unreadability, all inside the +3 maximum.

The shorter arm used 1,083,269 input tokens versus 1,922,354 (-43.7%), 41,728
versus 47,357 output tokens, and 149 versus 144 web searches. Estimated
production cost was `$4.6159965` versus `$5.041616` (-8.4%). Short-arm
mean/median/p95/max cost was `$0.07693`/`$0.06909`/`$0.11682`/`$0.17099`;
latency was 14.67/8.55/16.31/309.75 seconds.

One source initially marked unreadable was an evaluator transport defect. The
direct fetch received an ALB 403, but the uniform rate-limited reader fallback
retrieved the exact returned first-party page and confirmed the specialty,
phone, and address. The only remaining defect on that case was a minor
unsupported slash in `addressLine2`. The corrected protocol had zero reader-
fallback failures for emitted citations and was applied identically to both
arms. An earlier compiler also applied set difference instead of the frozen
net affected-case rule; the corrected compiler preserves novel/resolved lists
for audit while applying the literal net count.

The next-shortest coherent candidate, 12,469 bytes, failed only the withholding
gate (+5 cases versus a +3 limit). The selected 11,196-byte contract passed,
and remaining deletions were below the frozen 5% plateau threshold with no
repeated policy block left. The iteration therefore stopped. No holdout
request, result, trace, source, or case-specific fact was opened or used during
minimization. The short winner was frozen before the later run reported below.

### Sealed holdout and predecessor benchmark

The holdout repeated the original construction procedure with an independent
seed and excluded every development provider before sampling. It contains 60
providers from a six-market constructed frame:

- 48 individuals and 12 organizations;
- 30 urban and 30 nonmetro;
- Miami FL, Cleveland OH, Houston TX, Athens OH, Cookeville TN, and Sylva NC;
- every provider was returned by the CMS Marketplace provider-search API;
- every provider had literal `"coverage":"Covered"` for at least one sampled
  actual 2026 Marketplace plan and `covered:true` through Lucie's plan wrapper;
- every provider had an active NPPES result with matching entity type and an
  exact CMS-to-NPPES professional location at cohort construction;
- zero NPI overlap with the development 60 and candidate pilots; and
- zero normalized name+city+state overlap with the development 60.

This is a probability sample conditional on the six-market, text-query-based
frame and sampled plans. It is not nationally representative; inclusion
probabilities relative to the complete national provider universe are unknown.

The longer predecessor had already run once on this battery, returning 60/60
parsed profiles and 60/60 profiles with a phone, address, or website. The short
contract was frozen after development selection and then ran independently on
the exact same requests. The runs were separated in time and live-web state, so
their comparison is descriptive rather than a concurrent randomized treatment.

### Fixed evaluation of the short contract

Production ran each frozen request once through the exact short-contract
production path. Evaluation then fetched only URLs returned by that run; it did
not use a union packet or credit a page the short contract had not returned.
Fetching was parallel, evaluation-only, and absent from production. The local
host disabled TLS verification under explicit authorization because of
workstation interception.

The fixed judge was `gpt-5.6-sol` with reasoning `high`, concurrency 10, no web
tool, one categorical rubric, one strict schema, and no model-generated or
host-generated aggregate score. Host code joined bounded categorical items and
reported each denominator separately. Complete semantic Markdown—not raw HTML—
was supplied without truncation or extraction-model fallback. A prior five-
packet calibration showed
that Sol `low` and `medium` were not equivalent to `high`: both reproduced the
critical findings but introduced evidence-sufficiency, recency, and CMS-role
differences. High reasoning therefore remained fixed for the official judge.

## Short-contract holdout production results

| Outcome | Result |
| --- | ---: |
| Parsed responses | 58/60 |
| Profiles returned | 58/60 |
| Profiles with at least one phone/address/website | 54/60 |
| Specialty | 58/60 cases; 65 items |
| Address | 51/60 cases; 57 items |
| Phone | 46/60 cases; 48 items |
| Website | 29/60 cases; 29 items |
| Ratings | 0/60 cases; 0 items by design |
| Total emitted non-rating claims | 199 |
| Web-search calls | 137 |
| HTTP sends | 62 |
| Transport retries | 0 |
| Semantic retries | 2 |
| Production host fetches | 0 |

The production request logs confirm `gpt-5.6-terra`, reasoning `low`, required
native web search, strict JSON schema output, `store:false`, and no supplied
plan/network data. Two cases failed after both attempts emitted full state
names accepted by the lean structured schema but rejected by the
downstream two-character state contract. Four additional cases returned
specialty only.

### Match and overlap with CMS/provider APIs

NPI and provider name were the primary identity keys. Specialty and requested
location were deliberately stale-capable cross-checks, not gates. Of 57
emitted address claims, the fixed judge classified 39 as the requested CMS
location, nine as a different professional location, one as another compatible
professional location, and eight as unjudged context-overflow claims.
Different professional location is not automatically an error: the provider
may have multiple locations and the CMS hint may be stale. The whole-packet
support assessment, not CMS equality, determined whether the emitted fact was
supported.

The experiment therefore establishes overlap and independent support but does
not establish that AI contact data are more accurate than CMS, NPPES, or plan
directory data. CMS/plan APIs remain authoritative for network participation;
AI never overrides them.

## Categorical evidence findings

Forty-eight cases and 166 of 199 claims were evaluated. Ten complete packets
were fail-closed `CONTEXT_OVERFLOW` no-calls at the 224,000-token direct-input
ceiling; estimates ranged from 224,813 to 3,978,657 tokens. Two other cases had
production parser failures. There was no truncation, extraction fallback,
malformed judge response, judge error, or judge content filter.

| Criterion | Categories among 166 judged claims |
| --- | --- |
| Whole returned-source packet supports value | exact 164; contradicted 1; unreadable 1 |
| Claim's own citation supports value | exact 160; not found 2; contradicted 1; unreadable 3 |
| Provider-identity span fidelity | exact 147; nonverbatim 16; unreadable 3 |
| Fact-span fidelity | exact 125; nonverbatim 37; partial 1; unreadable 3 |
| Field validity | valid 164; invalid 1; unreadable 1 |
| Recency | undated 164; current from other returned evidence 1; unreadable 1 |

Thirty-three emitted claims belonged to overflow cases and remain unjudged.
They are not included in the table's denominator. The one emitted explicit
date span was not fact-relevant; the one judge-inferred current address did not
carry a qualifying emitted date span.

The evidence fetch processed 1,247 unique returned URLs: 921 were fetch-
readable and 326 unreadable. Eighty-two were cited URLs. Twenty-three cited
URLs used the uniform reader fallback, with no fallback transport failure.
Three claims still cited a Kroger loading shell that was non-substantive for
evaluation. Host-fetch failure is evaluator insufficiency, not affirmative
evidence that a fact is wrong.

### Source hierarchy by field

Counts are across 48 judge-complete cases and apply only to sources found by
the short contract, not to the entire internet.

| Field | Highest eligible tier | Lower tier | Appropriate conflict withholding | Inappropriate withholding | Indeterminate | N/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Address | 36 | 4 | 1 | 4 | 1 | 2 |
| Phone | 34 | 3 | 1 | 9 | 1 | 0 |
| Specialty | 43 | 5 | 0 | 0 | 0 | 0 |
| Website | 24 | 0 | 0 | 8 | 0 | 16 |

The 12 lower-tier selections are priority-fidelity findings, not automatic
wrong-value findings. The 21 inappropriate-withholding findings are recall
opportunities on pages the short contract itself returned and align with the
54/60 contact-survival result.

### Adverse-case trace review

The sealed judge emitted one raw critical code in a pediatric-radiology case,
and trace review confirmed it. The response opened and cited a Nationwide Children's provider
page, emitted the correct voice number `(614) 722-2289`, and also emitted
`(614) 722-2332` as a phone. The page states `Fax us at:(614) 722-2332`.

The bare value and number-only fact span passed parsing and the value-only
literal sanitizer. This is a confirmed production-path fax-as-phone defect,
not evaluator overreach. No judged claim disclosed a personal/mobile phone or
residential address, but the prohibited fax is release-blocking under the
frozen stopping rule. Ten overflow cases remain unknown.

Other confirmed and unresolved residuals:

- Two cases failed parsing because the lean schema and downstream state
  constraints diverged on full state names; both semantic retries repeated the
  mismatch.
- Two cases used own citations that lacked the emitted address, although
  other returned exact-provider evidence supported both values.
- One pharmacy case cited a loading shell for address, phone, and website. Other returned
  evidence supported the address and phone; the website remained unreadable.
- Thirty-seven readable fact spans were nonverbatim and one was partial;
  16 identity spans were nonverbatim.
- One emitted date span was a publication date that did not date the phone.

## Development-to-holdout regression assessment

The relevant test-set comparator is the frozen 60-provider development battery,
not the smaller prompt-tuning pilots. The holdout used different providers but
the same production model/runtime and fixed Sol/high evaluation family. The
short contract did **not** preserve the release-driving development outcomes.

| Outcome | Development battery | Disjoint holdout | Assessment |
| --- | ---: | ---: | --- |
| Parsed profiles | 60/60 | 58/60 | Two schema/parser failures |
| Profiles with a phone, address, or website | 59/60 | 54/60 | 8.3-point absolute decline |
| Confirmed prohibited/materially contradicted contact | 0 | 1 among 48 judged cases | Release-blocking fax-as-phone |
| Exact whole-packet support, determinate claims | 99.38% | 164/165 (99.39%) | Material-value support held |
| Exact own-citation support, determinate claims | 98.05% | 160/163 (98.16%) | Similar point estimate; one contradicted and two not found |
| Evaluator context overflows | 8/60 | 10/60 | Similar complete-source limitation; unknown, not failure |
| Short-arm production cost | `$4.6159965` | `$4.298921` | 6.9% lower on holdout |
| Azure latency | median `8.55 s`; p95 `16.31 s`; max `309.75 s` | median `8.487 s`; p95 `12.776 s`; max `18.831 s` | Tail improved |

The short contract's direct material support generalized; its safety,
availability, and recall behavior did not. The 54/60 contact result is also
worse than the longer predecessor's 60/60 result on these same frozen requests,
and non-rating inappropriate withholding increased descriptively from nine to
21. The predecessor and successor holdout runs were separated in time, so this
is not a randomized concurrent comparison.

The study did not preregister a formal development-versus-holdout
noninferiority test. No post-hoc significance threshold is needed to disposition
the release: the frozen safety-first rule makes one confirmed prohibited fax-
as-phone output sufficient to reject unchanged promotion. No prompt or parser
was retuned on the holdout.

## Cost, latency, and reliability

All costs are public-list estimates; contract rates and invoice amounts are
unknown. Production and evaluation costs must remain separate.

### Production-shaped requests

- total: `$4.298921` for 60 requests;
- minimum: `$0.048398`;
- median: `$0.065831`;
- mean: `$0.071649`;
- p95: `$0.094786`;
- maximum: `$0.175664`;
- sample standard deviation: `$0.019438`.

Azure latency:

- median: `8.487 s`;
- mean: `8.666 s`;
- p95: `12.776 s`;
- maximum: `18.831 s`.

The production run used 996,244 input tokens, including 331,264 cached input
tokens, and 42,377 output tokens, including 16,557 reported reasoning-output
tokens. Usage was complete for all 60 rows, including failed attempts.

### Evaluation

- 48 paid Sol/high calls, 10 no-call overflows, and two production errors;
- cost: `$35.882074`;
- median cost: `$0.722804`;
- mean cost: `$0.747543`;
- p95 cost: `$1.113593`;
- maximum cost: `$1.252350`;
- median latency: `209.405 s`;
- mean latency: `220.227 s`;
- p95 latency: `322.407 s`;
- maximum latency: `334.509 s`.

Final valid holdout production plus judge spend was `$40.180995`. An invalid
harness start sent four unused production calls and cost `$0.298276`; it is
excluded from quality metrics. Including that disclosed overhead, observed
Azure holdout-program spend was `$40.479271`.

## Exact APIs and credential-safe reproductions

The provider battery used these APIs:

| API | Endpoint | Use |
| --- | --- | --- |
| CMS Marketplace plans | `POST https://marketplace.api.healthcare.gov/api/v1/plans/search` | Construct the 2026 plan frame and sample actual plans |
| CMS provider search | `GET https://marketplace.api.healthcare.gov/api/v1/providers/search` | Construct the provider frame and frozen request baseline |
| CMS provider coverage | `GET https://marketplace.api.healthcare.gov/api/v1/providers/covered` | Require literal provider-plan `Covered` evidence |
| Lucie API-Plans wrapper | `POST http://api-plans.local.com/v1/providers-covered?year=2026` | Confirm Lucie's mapping to `covered:true` |
| NPPES 2.1 | `GET https://npiregistry.cms.hhs.gov/api/` | Independent identity, entity, active-status, and location validation |
| Azure OpenAI Responses | `POST https://foundry-lucie-ai.openai.azure.com/openai/v1/responses` | One-call Terra/low provider web search and strict output |

Set credentials from an approved secret store:

```sh
export CMS_API_KEY='...'
export AZURE_OPENAI_API_KEY='...'
export AZURE_RESPONSES_ENDPOINT='https://foundry-lucie-ai.openai.azure.com/openai/v1/responses'
```

CMS provider search:

```sh
curl -sS --get 'https://marketplace.api.healthcare.gov/api/v1/providers/search' \
  --data-urlencode "apikey=$CMS_API_KEY" \
  --data 'year=2026' \
  --data-urlencode 'q=Brown' \
  --data 'zipcode=33130' \
  --data-urlencode 'type=Individual'
```

CMS provider-plan coverage:

```sh
curl -sS --get 'https://marketplace.api.healthcare.gov/api/v1/providers/covered' \
  --data-urlencode "apikey=$CMS_API_KEY" \
  --data 'year=2026' \
  --data 'providerids=1013931773' \
  --data 'planids=21525FL0020003'
```

NPPES:

```sh
curl -sS --get 'https://npiregistry.cms.hhs.gov/api/' \
  --data 'version=2.1' \
  --data 'number=1013931773'
```

Azure reproduction using an exported production request body. The OpenAI SDK
`apiKey` configuration used by production sends bearer authentication to the
Azure v1 endpoint:

```sh
export AZURE_REQUEST_BODY='/approved/path/to/redacted-production-request.json'

curl -sS -X POST \
  "$AZURE_RESPONSES_ENDPOINT" \
  -H "Authorization: Bearer $AZURE_OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary "@$AZURE_REQUEST_BODY"
```

The reproducibility package also contains the complete CMS plan, provider,
coverage, Lucie-wrapper, NPPES, and Azure request examples.

## CMS-facing conclusions

### Personal information guardrails

Lucie instructs the model to emit only public professional contacts for the
exact provider and to omit fax, mobile/cell, personal/home, residential,
people-search, and uncertain-purpose candidates. Every fact must carry its own
provider-identity and fact quotation. A narrow host veto prevents a literal
self-declared prohibited value from reaching display, but Lucie does not claim
that deterministic code can classify an unlabeled personal number or address.
The short holdout found no personal/mobile or residential disclosure among 48
judge-complete cases, but it did confirm one prohibited fax emitted as a phone.
Ten cases were evaluator no-call overflows and two produced no parsed profile.
The fax finding blocks unchanged promotion.

### Conflicts with HealthCare.gov or plan data

HealthCare.gov and plan-directory APIs exclusively determine network status.
Plan/network information is not sent to the AI, and AI output cannot override
network participation. Contact disagreements are field-local evidence
questions, not proof that either source is inherently correct. NPI/name are the
identity anchors; specialty and location are stale-capable cross-checks.

### Field validation and reliability

Every emitted specialty, address, phone, and website must identify the exact
provider and include a direct page URL plus separate identity and fact spans.
Source priority follows, rather than precedes, evidence qualification. Ratings,
including Zocdoc ratings, are not shipped. In the short holdout, 164 of 166
judged claims had exact whole-packet support, one was contradicted, and one was
unreadable. Own citations were 160 exact, two not found, one contradicted, and
three unreadable. Thirty-three additional emitted claims were in no-call
overflow cases and remain unknown.

### Multiple values and default display

The model resolves each field independently and returns multiple values only
when evidence supports concurrent professional use. It orders eligible values
after identity, conflict, safety, location, and fact-specific-recency checks.
Among otherwise equivalent eligible sources it prefers a first-party provider,
practice, or facility page; then government evidence; then a professional
directory. Element zero is displayed first; later values require “Show more.”
The short holdout selected the highest eligible returned tier in 137 field
decisions and a lower tier in 12, but inappropriately withheld 21 fields. The
hierarchy is useful but imperfect and should not be represented as
deterministic or infallible.

### Comparative accuracy statement

Lucie completed a development comparison and a disjoint sealed holdout. The
paired development study supported the short contract within its frozen
margins, but the short contract's own holdout found a confirmed prohibited
contact and end-to-end availability regression. Lucie therefore retains the
longer predecessor and does not promote the short contract unchanged. These studies do
**not** show that AI provider contact data are more accurate than CMS, NPPES,
or plan-directory APIs, do not establish national performance, and were not a
blinded independent human-adjudication study.

## Reproducibility package

The retained evidence package contains the sealed cohort and overlap proof,
exact production requests and raw Azure responses, production summaries,
returned webpage snapshots, fixed judge requests/responses, compiled
categorical results, claim and field TSVs, the adverse trace audit, and
credential-safe API reproductions. The successor package contains 60 case rows,
199 fact rows, 192 judged field rows, and one critical-finding row. It also
retains the 1,247-URL fetch summary, 48 paid judge artifacts, 10 overflow
packets, and two production-error traces. The separate development package
retains both full arms, paired-bootstrap outputs, compiler errata, candidate
ledgers, and production cost/latency summaries.
Production and judge secret scans recorded zero matches. Internal variant,
case, source-control, and storage identifiers remain in that controlled package
for auditability but are intentionally omitted from this outward-facing report.

## Release packaging and remaining cutover work

After the sealed predecessor evaluation, Lucie added a production image and
deployment contract. The prompt/schema were later shortened through the
development protocol described above; the short version is now rejected as-is
by its own holdout. The image uses a
digest-pinned Node base, locked install, compiled start, non-root user,
read-only-compatible filesystem, and Redis/AI-configuration healthcheck. A
local dedicated-Redis smoke passed health, non-root/read-only checks, and the
production API-context fail-closed gate. The release package retains the exact
smoke evidence and frozen dependency-scan disclosure.

The short-contract branch must not proceed to external cutover. Before any new
short successor can be considered, Lucie must:

1. Create a separately versioned repair on development data, without case-
   specific tuning on this holdout.
2. Align state constraints across the strict output and downstream parser.
3. Make phone-purpose evidence machine-checkable in the emitted fact span so a
   narrow literal veto can catch `Fax` without a production webpage fetch.
4. Restore only concise schema guidance justified by measured gaps, including
   state format, phone purpose, and verbatim spans.
5. Repeat development evaluation and validate on fresh independent providers.
6. Complete the existing CI, immutable-image, security, deployed-smoke,
   monitoring, and rollback requirements only after the new version passes.

# Provider-profile validation and CMS response evidence

Status date: 2026-08-04 (America/New_York)

## Executive decision

Lucie should **not ship the frozen full-prompt provider-profile configuration**.
A corrected format-aware evaluator judged all 60 disjoint holdout cases and all
221 claims and found release-blocking failures that the historical evaluator
missed: one fax/voice conflict, one wrong-NPI address-and-phone bundle, and one
same-name wrong-location/provider-page bundle. The corrected stack eliminated
the prior context-overflow no-call; no page content was truncated and no
extraction-model fallback was used.

The evaluated reference remains the original full production prompt and
strict schema: 86,769 static UTF-8 bytes at treatment commit
`d6afd2d2c24983ea2dbbdbdaf064864d17a13186`. A later development-only
minimization program reevaluated the full contract and eight shortened
artifacts with the corrected fixed evaluator. No shortened artifact passed both
required primary strata, so no prompt reduction was promoted and the sealed
holdout was not reused to choose among shortened prompts.

The original development selection followed a broad candidate funnel: **40 distinct
production-shaped configurations were tested with live pilot requests, four
advanced to complete 60-provider development evaluations, and the selected
configuration was then frozen and tested on a separate 60-provider holdout.**

The companion [CMS response](CMS_PROVIDER_AI_RESPONSE.md) includes the literal
evaluated production prompt and strict output schema as Appendices A and B.

The corrected result also found one confirmed minor address-format defect,
imperfect source-hierarchy adherence, and citation-span defects. The raw judge
flagged 16 automatic cases, but trace review showed that several additional
labels over-weighted directory refresh metadata or ordinary coexistence of
professional phone lines. Those raw findings remain disclosed rather than
being silently converted into passes. The three release blockers above do not
depend on the evaluator's recency errors.

The evaluated configuration was frozen before opening the holdout. Its build
passed, with 267 tests passing and four skipped across 41 passing suites and
one skipped suite. It has been packaged and smoke-tested locally but has not
completed target-environment deployment and verification. This report therefore
does not claim production cutover completion.

## Evaluated configuration

The failed holdout reference uses the retained original full prompt/schema
contract with the Azure OpenAI Responses API. The literal contract is reproduced
in Appendices A and B of the companion CMS response. It uses:

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

The profile endpoint is currently invoked from the medical-plan workflow, so
its public request envelope retains `lineOfCoverage: "Medical"` for API
compatibility. `Medical` identifies the insurance product line only. It is
orthogonal to provider entity type, is not used to exclude facilities, and is
not copied into the model prompt. The service supports NPI Type 1 individual
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
personal, classify a source as official, judge currentness, or reject an
address merely because it contains `apt` or `apartment`. Native Azure
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

The selected configuration's unique change over its final comparator was
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
selected configuration won at the first unequal safety-first criterion: the
comparator emitted one readable materially unsupported address component,
while the selected configuration emitted none. The selected configuration had
one later partial own-citation detail that the comparator did not; the
preregistered lexicographic rule did not allow that later tradeoff to override
the earlier material-support result. These differences do not establish
universal or statistical superiority.

The two-configuration development production run cost an estimated `$10.2757645`; the
118 paid Sol/high judge calls cost `$83.879661`. Evaluation cost is not
production unit cost.

### Subsequent prompt-minimization evaluation

After the release configuration had been selected and holdout-tested, Lucie
evaluated eight shorter prompt/schema artifacts on the frozen development set
only. Static reductions ranged from 72.1% to 87.1%. All nine arms—the full
contract plus eight shortened artifacts—were reevaluated after correcting two
evaluator defects: whole-packet support had been conflated with own-citation
support, and the lean synthesis prompt had omitted the fixed source-hierarchy
and conflict policy.

The corrected campaign comprised 33 automatic Sol/high providers, 25 paired
Codex-harness manual-exception providers, and two paired operational censors.
“Manual” denotes blinded structured exception adjudication in the Codex
harness, not an independent human clinical review. No shortened artifact passed
both primary strata. The 87.1%-short artifact was the closest:
it introduced no new confirmed safety finding and passed all automatic and
secondary pooled gates, but its manual-stratum eligible-contact difference was
-4 percentage points with a lower 95% confidence bound of -12 percentage
points, missing the preregistered -5-point margin because of one genuine
contact-recall loss. The pooled 58-provider lower bound was -3.45 percentage
points, but that pooled analysis was frozen as secondary and could not be used
post hoc to override the failed primary stratum.

Accordingly, the minimization study changes neither the release contract nor
the CMS holdout claims in this report. It supplies negative evidence against
shortening the contract with the currently tested deletions.

### Sealed holdout

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

### Fixed evaluation

Production ran the frozen requests once. Evaluation then fetched only the URLs
returned by the evaluated configuration; it did not use a union packet or credit
the configuration with a page it had not returned. Fetching was deterministic,
parallel, evaluation-only, and absent from production.

The fixed judge was `gpt-5.6-sol` with reasoning `high`, concurrency 10, no web
tool, one categorical rubric, one strict schema, and no model-generated or
host-generated aggregate score. Host code joined bounded categorical items and
reported each denominator separately. A prior five-packet calibration showed
that Sol `low` and `medium` were not equivalent to `high`: both reproduced the
critical findings but introduced evidence-sufficiency, recency, and CMS-role
differences. High reasoning therefore remained fixed for the official judge.

## Holdout production results

| Outcome | Result |
| --- | ---: |
| Parsed responses | 60/60 |
| Profiles returned | 60/60 |
| Profiles with at least one phone/address/website | 60/60 |
| Specialty | 60/60 cases; 72 items |
| Address | 57/60 cases; 60 items |
| Phone | 56/60 cases; 56 items |
| Website | 33/60 cases; 33 items |
| Ratings | 0/60 cases; 0 items by design |
| Total emitted non-rating claims | 221 |
| Web-search calls | 148 |
| HTTP sends | 61 |
| Transport retries | 0 |
| Semantic retries | 1 |
| Production host fetches | 0 |

The production request logs confirm `gpt-5.6-terra`, reasoning `low`, required
native web search, strict JSON schema output, `store:false`, and no supplied
plan/network data.

### Match and overlap with CMS/provider APIs

NPI and provider name were the primary identity keys. Specialty and requested
location were deliberately stale-capable cross-checks, not gates. The corrected
judge assessed all 60 address claims: 51 were at the requested location, six
were compatible professional locations, one was a different professional
location, one was wrong-location, and one was ambiguous. A different
professional location is not automatically an error; the same-name California
page in the wrong-location case was a provider-identity failure, not a penalty
for differing from CMS by itself.

The experiment therefore establishes overlap and independent support but does
not establish that AI contact data are more accurate than CMS, NPPES, or plan
directory data. CMS/plan APIs remain authoritative for network participation;
AI never overrides them.

## Categorical evidence findings

All 60 cases and all 221 claims were evaluated. The corrected stack used 346
bounded atomic readings and 56 categorical syntheses; four predeclared
spreadsheet-boundary cases used the same schema in a blinded structured
Codex-harness manual stratum. There was no context overflow, truncation,
extraction-model fallback, terminal malformed response, or content-filter
censor.

| Criterion | Categories among 221 evaluated claims |
| --- | --- |
| Whole returned-source packet supports value | exact 201; partial 1; not found 1; contradicted 18 |
| Claim's own citation supports value | exact 174; partial 2; not found 3; unreadable 42 |
| Provider-identity span fidelity | exact 158; partial 2; nonverbatim 19; unreadable 42 |
| Fact-span fidelity | exact 156; nonverbatim 23; unreadable 42 |
| Field validity | valid 202; partial 1; invalid 18 |
| Recency | current 115; stale 20; conflicting 20; undated 37; unknown 29 |

The evaluation host preserved 1,523 logical returned-source rows. The corrected
packets contained 1,230 readable arm-returned snapshots and 293 unavailable
snapshots, plus one fixed identity-only context source per case. Unreadable own
citations remain unknown, not successes or failures. Independent readable pages
returned by the same configuration allowed whole-packet assessment for many of
those claims.

Every claim correctly omitted an explicit fact-date span. The raw recency row
does not mean 155 claims had fact-specific dates. Trace review found that the
judge sometimes treated directory `dateModified`, `last reviewed`, or data-
refresh metadata as fact recency despite the fixed rubric. Recency-sensitive
raw labels therefore require the adverse-case qualifications below.

### Source hierarchy by field

Counts are across all 60 cases and apply only to sources found by the evaluated
configuration, not to the entire internet.

| Field | Highest eligible tier | Lower tier | Appropriate conflict withholding | Inappropriate withholding | Indeterminate | N/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Address | 43 | 5 | 1 | 2 | 6 | 3 |
| Phone | 43 | 5 | 0 | 2 | 6 | 4 |
| Specialty | 39 | 9 | 0 | 0 | 8 | 4 |
| Website | 32 | 0 | 0 | 3 | 0 | 25 |

The 19 lower-tier selections are CMS-priority fidelity findings, not automatic
wrong-value findings. The seven non-rating inappropriate-withholding findings
are recall opportunities on pages the configuration itself returned. Ratings
were intentionally removed and remain out of scope.

### Adverse-case trace review

The sealed judge emitted advisory critical labels in 16 automatic cases. The
additive trace audit preserved those raw labels and did not mutate the sealed
results. Its key dispositions are:

- **Confirmed fax/voice failure.** A phone displayed by the output had
  arm-owned exact-NPI evidence explicitly labeling the same value as a fax and
  another value as the telephone. This violates the professional-voice rule.
- **Confirmed wrong-NPI bundle.** A displayed address and phone were assigned
  by readable evidence to other NPIs, while readable requested-NPI evidence
  showed a different bundle and no shared-use resolution.
- **Confirmed same-name wrong-location page.** A California address and
  provider page were emitted for an exact-NPI provider whose readable evidence
  identified Ohio.
- **Apartment-only raw residential label.** The judge inferred residential use
  from `Apt 612` alone. That remains evaluator overreach; `apt` is not a
  deterministic residential classification.
- **Recency and coexistence overreach.** Several other raw contradictions used
  directory refresh/review metadata as if it dated the exact contact, or
  treated different professional phone lines as mutually exclusive without
  affirmative evidence. These are retained as unresolved quality warnings,
  not promoted to confirmed safety incidents.

The three confirmed cases are sufficient to fail the release safety gate. One
additional case emitted unsupported `addressLine2: "/"`; the remaining address
was supported, making this a minor formatting/exactness defect. Forty-two own
citations remain unreadable. Citation-span or field-contract defects occurred
in 33 cases, including 19 nonverbatim identity spans and 23 nonverbatim fact
spans across the claim set.

### Historical versus corrected evaluator

The production outputs, claims, and returned URL sets were frozen. The
corrected webpage snapshots were collected after the historical snapshots, so
page drift can contribute to changed labels and this is not a randomized
evaluator experiment.

| Measure | Historical evaluator | Corrected evaluator |
| --- | ---: | ---: |
| Cases judged | 59/60 | 60/60 |
| Claims judged | 218/221 | 221/221 |
| Context-overflow no-calls | 1 | 0 |
| Whole-packet exact | 206 | 201 |
| Whole-packet contradicted | 2 | 18 |
| Own-citation exact or partial | 126 | 176 |
| Own-citation unreadable | 92 | 42 |
| Raw critical-label cases | 2 | 16 |
| Judge API cost | `$44.153370` | `$128.052519` successful run |

On the 218 shared claims, 53 own-citation support labels changed. The corrected
stack's bounded per-source reading materially improved citation coverage and
eliminated the overflow, while also exposing more conflicts and more
nonverbatim spans. The historical zero-major-defect conclusion is superseded.

## Development-to-holdout regression assessment

The relevant test-set comparator is the frozen 60-provider development battery,
not the smaller prompt-tuning pilots. Production availability and output volume
were stable: both batteries returned 60/60 profiles, and the holdout emitted
221 claims versus 218 in development. Mean production cost decreased 1.1%,
from `$0.084751` to `$0.083809` per provider, and the development run's extreme
transport tail did not recur.

The historical statement that no release-material regression occurred is
withdrawn. It relied on a reader that judged only 59 cases, left 92 own
citations unreadable, and overflowed on one case. The corrected reader judged
all 60 cases, reduced own-citation unreadability to 42/221, and exposed the
three release-blocking cases above.

This is not reported as a clean statistical development-versus-holdout effect:
the source snapshots were collected at different times, the corrected
evaluator was not the historical development judge, and its recency-sensitive
labels still require qualification. The honest conclusion is narrower:
availability, volume, cost, and ordinary latency did not materially regress,
but the corrected holdout safety gate failed. No production prompt was retuned
after the holdout was opened.

## Cost, latency, and reliability

All costs are public-list estimates; contract rates and invoice amounts are
unknown. Production and evaluation costs must remain separate.

### Production-shaped requests

- total: `$5.028516` for 60 requests;
- minimum: `$0.0515085`;
- median: `$0.081231`;
- mean: `$0.083809`;
- p95: `$0.112417`;
- maximum: `$0.156701`;
- sample standard deviation from the production summary: `$0.0185292`.

Azure latency:

- median: `9.568 s`;
- mean: `9.830 s`;
- p95: `13.591 s`;
- maximum: `14.651 s`.

The production run used 1,900,624 input tokens, 1,112,064 cached input tokens,
47,140 output tokens, and 19,989 reasoning tokens. Usage was complete for all
60 rows.

### Corrected evaluation

- 346 completed Sol/high atomic calls: `$102.021875` total, `$0.303369`
  median, `$0.294861` mean, `$0.446209` p95, `$0.539665` maximum;
- 56 completed Sol/high synthesis calls: `$26.030644` total, `$0.442820`
  median, `$0.464833` mean, `$0.592251` p95, `$0.657274` maximum;
- successful corrected automatic evaluator: `$128.052519` across 402 calls;
- four blinded structured manual cases; manual-review cost was not captured;
- zero context-overflow, content-filter, refusal, or malformed-output terminal
  cases in the successful campaign.

Production plus the successful corrected automatic evaluator was
`$133.081035`. An earlier aborted atomic attempt completed 107 paid calls for
`$34.395307`; it is excluded from final quality denominators. Including that
operational overhead, production and corrected-evaluator API spend was
`$167.476342`, excluding uncaptured manual-review cost. The historical broken
judge's `$44.153370` is reported as superseded evaluation spend, not added to
the corrected-run total.

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
The corrected holdout did not confirm a personal-mobile disclosure. It did
confirm an emitted fax/voice conflict and two provider-identity/location cases,
so the evaluated prompt failed the release safety gate.

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
including Zocdoc ratings, are not emitted. In the corrected holdout, 201 of 221
claims had exact whole-packet support, one was partial, one was not found, and
18 were contradicted. Own-citation support was 174 exact, two partial, three not
found, and 42 unreadable. Raw recency-driven contradictions remain qualified,
but the three release-blocking cases do not depend on them.

### Multiple values and default display

The model resolves each field independently and returns multiple values only
when evidence supports concurrent professional use. It orders eligible values
after identity, conflict, safety, location, and fact-specific-recency checks.
Among otherwise equivalent eligible sources it prefers a first-party provider,
practice, or facility page; then government evidence; then a professional
directory. Element zero is displayed first; later values require “Show more.”
The holdout shows this hierarchy is useful but imperfect; 19 fields selected a
lower tier and seven non-rating fields were inappropriately withheld. It should
not be represented as deterministic or infallible.

### Comparative accuracy statement

Lucie completed a development comparison and an outcome-blind disjoint
holdout. The corrected holdout does **not** support shipping the evaluated full
prompt. The study also does **not** show that AI provider contact data are more
accurate than CMS, NPPES, or plan-directory APIs, does not establish national
performance, and was not a blinded independent human-adjudication study.

## Reproducibility package

The retained evidence package contains the sealed cohort and overlap proof,
exact production requests and raw Azure responses, production summaries, raw
case/claim/candidate/source/policy TSVs, deterministic webpage snapshots, fixed
judge requests and responses, compiled validation results, the additive manual
trace audit, and credential-safe API reproductions. The production and case
TSVs each contain 60 data rows; the claim and candidate TSVs each contain 221;
and the source TSV contains 1,583. All were validated as UTF-8, tab-delimited,
fixed-column records without embedded carriage returns or NUL bytes.
Production and judge secret scans recorded zero matches. Internal variant,
case, source-control, and storage identifiers remain in that controlled package
for auditability but are intentionally omitted from this outward-facing report.

## Release packaging and remaining cutover work

After the sealed evaluation, Lucie added a packaging-only production image and
deployment contract without changing the evaluated treatment. Packaging does
not override the failed safety gate. The image uses a
digest-pinned Node base, locked install, compiled start, non-root user,
read-only-compatible filesystem, and Redis/AI-configuration healthcheck. A
local dedicated-Redis smoke passed health, non-root/read-only checks, and the
production API-context fail-closed gate. The release package retains the exact
smoke evidence and frozen dependency-scan disclosure.

External cutover still requires Lucie to:

1. Correct and revalidate the fax/voice, wrong-NPI bundle, and same-name
   location/domain failures in a separately versioned treatment.
2. Publish and review that exact successor source and its
   packaging/documentation-only descendant without altering the treatment.
3. Build in approved CI, push an immutable registry digest, and bind it to the
   evaluated source and release build.
4. Attest the actual endpoint, secret source, Terra/low lock, approved price
   card, and deployment manifest.
5. Complete organizational privacy/security evidence for Azure web search,
   logging, retention, access, and Grounding with Bing terms.
6. Run the documented deployed non-holdout Public-API/Azure and test-tenant
   feedback/MySQL smoke, record the previous image digest, and activate the
   defined monitors before gradual traffic admission.
7. Treat any confirmed major-safety incident as a release blocker for a
   separately versioned repair; do not silently retune this sealed result.

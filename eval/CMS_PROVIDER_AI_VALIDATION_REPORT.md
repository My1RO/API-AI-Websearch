# Provider-profile validation and CMS response evidence

Status date: 2026-08-01 (America/New_York)

## Executive decision

Lucie should ship the frozen selected provider-profile configuration, subject
to ordinary deployment, security, monitoring, and rollback controls. It passed
the preregistered stopping rule: after additive review of every raw critical
label, **zero major safety violations were confirmed among 59 evaluable cases
in the disjoint 60-provider holdout**. One case was not judged because its
complete evidence packet exceeded the evaluator's direct-input ceiling; no
content was truncated and no extraction-model fallback was used.

The selected configuration remains the original full production prompt and
strict schema: 86,769 static UTF-8 bytes at treatment commit
`d6afd2d2c24983ea2dbbdbdaf064864d17a13186`. A later development-only
minimization program reevaluated the full contract and eight shortened
artifacts with the corrected fixed evaluator. No shortened artifact passed both
required primary strata, so no prompt reduction was promoted and the sealed
holdout was not reused to choose among shortened prompts.

This decision followed a broad candidate funnel: **40 distinct
production-shaped configurations were tested with live pilot requests, four
advanced to complete 60-provider development evaluations, and the selected
configuration was then frozen and tested on a separate 60-provider holdout.**

The companion [CMS response](CMS_PROVIDER_AI_RESPONSE.md) includes the literal
evaluated production prompt and strict output schema as Appendices A and B.

This is not a perfect-accuracy claim. The holdout found one confirmed minor
address-format defect, nine claims whose exact evidence remained unavailable,
imperfect source-hierarchy adherence, and citation-span defects. Performance
has plateaued around citation availability, quotation fidelity, and a few hard
organizational-identity cases. Further prompt tuning on the holdout would
overfit the validation set. The stopping rule therefore sends lesser defects
to post-release monitoring and permits a new version only for a confirmed
major-safety defect or a separately scoped material improvement.

The evaluated configuration was frozen before opening the holdout. Its build
passed, with 267 tests passing and four skipped across 41 passing suites and
one skipped suite. It has been packaged and smoke-tested locally but has not
completed target-environment deployment and verification. This report therefore
does not claim production cutover completion.

## What is being shipped

The selected configuration uses the retained original full prompt/schema
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
manual-exception providers, and two paired operational censors. No shortened
artifact passed both primary strata. The 87.1%-short artifact was the closest:
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
returned by the selected configuration; it did not use a union packet or credit
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
location were deliberately stale-capable cross-checks, not gates. Of the 59
evaluable address claims, the fixed judge classified 51 as the requested CMS
location, six as a different professional location, and two as unreadable.
Different professional location is not automatically an error: the provider
may have multiple locations and the CMS hint may be stale. The whole-packet
support assessment, not CMS equality, determined whether the emitted fact was
supported.

The experiment therefore establishes overlap and independent support but does
not establish that AI contact data are more accurate than CMS, NPPES, or plan
directory data. CMS/plan APIs remain authoritative for network participation;
AI never overrides them.

## Categorical evidence findings

Fifty-nine cases and 218 of 221 claims were evaluable. One holdout case was a
fail-closed `CONTEXT_OVERFLOW` no-call: its complete serialized input was estimated at
473,359 tokens against the evaluator's 224,000-token direct-input ceiling.
There was no truncation, extraction fallback, malformed judge response, judge
error, or judge content filter.

| Criterion | Categories among 218 evaluated claims |
| --- | --- |
| Whole returned-source packet supports value | exact 206; partial 1; unreadable 9; raw contradicted 2 |
| Claim's own citation supports value | exact 125; partial 1; unreadable 92 |
| Provider-identity span fidelity | exact 121; nonverbatim 5; unreadable 92 |
| Fact-span fidelity | exact 119; nonverbatim 7; unreadable 92 |
| Field validity | valid 206; partial 1; unreadable 9; raw invalid 2 |
| Recency | undated 209; unreadable 9; qualifying fact-specific date 0 |

For 126 claims, the claim's own cited page was host-readable; 125 exactly
supported the value and one partially supported it. The 92 unreadable own
citations remain unknown, not successes or failures. Independent readable
pages returned by the same configuration allowed whole-packet assessment for most of
those claims.

The evaluation host processed 1,523 logical returned-source rows (1,498
unique URLs), including 18 detected PDFs. It read 817 source rows and marked
706 unavailable in the final judge packets. Host-fetch failure is evaluator
insufficiency, not a production error and not affirmative evidence that a fact
is wrong.

### Source hierarchy by field

Counts are across 59 evaluable cases and apply only to sources found by the
selected configuration, not to the entire internet.

| Field | Highest eligible tier | Lower tier | Appropriate conflict withholding | Inappropriate withholding | Indeterminate | N/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Address | 37 | 7 | 1 | 2 | 9 | 3 |
| Phone | 33 | 9 | 2 | 2 | 9 | 4 |
| Specialty | 38 | 7 | 0 | 0 | 11 | 3 |
| Website | 27 | 0 | 0 | 5 | 0 | 27 |

The 23 lower-tier selections are CMS-priority fidelity findings, not automatic
wrong-value findings. The nine non-rating inappropriate-withholding findings
are recall opportunities on pages the configuration itself returned. The evaluator's 25
rating-withholding findings are inapplicable because ratings were intentionally
removed from the shipped contract.

### Adverse-case trace review

The sealed judge emitted three raw critical labels in two cases. The additive
audit preserved those labels and did not mutate the sealed results:

- **Apartment-labeled professional location.** The judge inferred residential use
  from `Apt 612` alone, contrary to the explicit rubric. Exact-NPI NPPES and
  readable professional pages identify it as a practice/contact location; no
  evidence calls it a home. Disposition: evaluator semantic overreach, not a
  confirmed disclosure.
- **Shared exact-NPI professional contact.** The cited NPIdb page
  was host-unreadable and the judge treated other-provider use as contradiction.
  The frozen NPPES response directly assigns the exact address and phone to NPI
  1962148841, and the CMS baseline independently assigns the address. Shared
  use does not prove exclusivity or incompatibility. Disposition: evaluator
  evidence insufficiency/overreach, not a confirmed wrong-provider disclosure.

After review, there were **zero confirmed major safety violations among 59
evaluable holdout cases**. This does not convert unknown claims into correct
ones.

Confirmed and unresolved residuals:

- One case emitted unsupported `addressLine2: "/"`; the remaining address was
  supported. This is a minor formatting/exactness defect.
- Nine claims across six cases remained indeterminate because their exact
  evidence was unavailable.
- Twelve readable submitted spans were nonverbatim across identity and fact
  dimensions even though the normalized values were semantically supported.
- No evaluated claim carried a qualifying fact-specific date. Undated evidence
  remained eligible and neutral; Lucie must not claim those facts are current.

## Development-to-holdout regression assessment

The relevant test-set comparator is the frozen 60-provider development battery,
not the smaller prompt-tuning pilots. The holdout used different
providers but the same production model/runtime and fixed Sol/high evaluation
family. No material safety or end-to-end coverage regression was observed.

| Outcome | Development battery | Disjoint holdout | Assessment |
| --- | ---: | ---: | --- |
| Parsed profiles | 60/60 | 60/60 | No regression |
| Profiles with a phone, address, or website | 60/60 | 60/60 | No survival/contact regression |
| Emitted claims | 218 | 221 | Overall output volume was stable; phone claims decreased 59→56 while websites increased 27→33 |
| Confirmed major-safety violations | 0 among 58 paired-eligible development cases | 0 among 59 evaluable holdout cases | No observed safety regression |
| Whole-packet fixed-judge categories | 216 exact; 2 unreadable | 206 exact; 1 partial; 9 unreadable; 2 raw contradicted | Raw labels worsened, but trace review found both contradictions were evaluator overreach; one real minor formatting defect remained |
| Readable own-citation precision | 128/129 exact (99.2%); 1 partial | 125/126 exact (99.2%); 1 partial | Effectively unchanged |
| Unreadable own-citation assessments | 89/218 (40.8%) across 35/60 cases | 92/218 (42.2%) across 34/59 evaluable cases | Essentially unchanged and remains the main evaluation limitation |
| Lower-tier source selections | 26 fields | 23 fields | No hierarchy regression; descriptive improvement |
| Non-rating inappropriate withholding | 14 fields | 9 fields | No recall-policy regression; descriptive improvement |
| Qualifying fact-specific dates | 0 | 0 | No regression, but recency remains unproven rather than current |
| Mean production cost | `$0.0847505` | `$0.0838086` | 1.1% lower on holdout |
| Azure latency | median `8.859 s`; p95 `13.190 s`; max `309.402 s` | median `9.542 s`; p95 `13.881 s`; max `14.613 s` | Median/p95 were 7.7%/5.2% slower, but the development run's extreme transport tail did not recur |

This study did not preregister a confirmatory development-versus-holdout
noninferiority test, so “no statistically significant regression” should not
be read as proof of equivalence. As an exploratory check at the provider unit,
cases with any unreadable whole-packet claim increased from 2/60 to 6/59
(`p=0.163`, two-sided Fisher exact), while cases with any unreadable own
citation were 35/60 versus 34/59 (`p=1.000`). Phone presence (59/60 versus
56/60) and website presence (27/60 versus 33/60) also did not cross the
conventional 0.05 threshold (`p=0.364` and `p=0.361`). These post-hoc tests are
descriptive, unadjusted for multiple comparisons, and do not treat multiple
claims from one provider as independent.

The honest conclusion is therefore: **no significant or release-material
regression was established**, but the holdout exposed one minor formatting
defect, one evaluator overflow, and somewhat more whole-packet evidence
unreadability. Those limitations remain visible rather than being averaged
away or repaired by retuning on the holdout.

## Cost, latency, and reliability

All costs are public-list estimates; contract rates and invoice amounts are
unknown. Production and evaluation costs must remain separate.

### Production-shaped requests

- total: `$5.028516` for 60 requests;
- minimum: `$0.0515085`;
- median (compiler order statistic): `$0.0814885`;
- mean: `$0.0838086`;
- p95 (compiler order statistic): `$0.1148255`;
- maximum: `$0.156701`;
- sample standard deviation from the production summary: `$0.0185292`.

Azure latency:

- median: `9.542 s`;
- mean: `9.787 s`;
- p95: `13.881 s`;
- maximum: `14.613 s`.

The production run used 1,900,624 input tokens, 1,112,064 cached input tokens,
47,140 output tokens, and 19,989 reasoning tokens. Usage was complete for all
60 rows.

### Evaluation

- 59 paid Sol/high calls and one no-call overflow;
- cost: `$44.153370`;
- median cost: `$0.704914`;
- mean cost: `$0.748362`;
- p95 cost: `$1.233964`;
- maximum cost: `$1.385295`;
- median latency: `97.567 s`;
- mean latency: `98.862 s`;
- p95 latency: `120.743 s`;
- maximum latency: `125.523 s`.

Final holdout production plus judge spend was `$49.181886`. An earlier aborted
operational attempt cost `$0.113255`; it is excluded from quality metrics.
Including that overhead, observed holdout-program spend was `$49.295141`.

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
The holdout found no confirmed personal-contact or residential disclosure among
59 evaluable cases.

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
including Zocdoc ratings, are not shipped. In the holdout, 206 of 218
evaluable claims had exact whole-packet support, one was partial, nine were
unreadable, and two raw contradictions were rejected after documented trace
review. For 126 claims, the own cited page was host-readable; 125 exactly
supported the value and one partially supported it.

### Multiple values and default display

The model resolves each field independently and returns multiple values only
when evidence supports concurrent professional use. It orders eligible values
after identity, conflict, safety, location, and fact-specific-recency checks.
Among otherwise equivalent eligible sources it prefers a first-party provider,
practice, or facility page; then government evidence; then a professional
directory. Element zero is displayed first; later values require “Show more.”
The holdout shows this hierarchy is useful but imperfect and should not be
represented as deterministic or infallible.

### Comparative accuracy statement

Lucie completed a development comparison and an outcome-blind disjoint
holdout. The study supports the selected configuration as shippable under the stated
stopping rule. It does **not** show that AI provider contact data are more
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
deployment contract without changing the evaluated treatment. The image uses a
digest-pinned Node base, locked install, compiled start, non-root user,
read-only-compatible filesystem, and Redis/AI-configuration healthcheck. A
local dedicated-Redis smoke passed health, non-root/read-only checks, and the
production API-context fail-closed gate. The release package retains the exact
smoke evidence and frozen dependency-scan disclosure.

External cutover still requires Lucie to:

1. Publish and review the exact evaluated source and its
   packaging/documentation-only descendant without altering the treatment.
2. Build in approved CI, push an immutable registry digest, and bind it to the
   evaluated source and release build.
3. Attest the actual endpoint, secret source, Terra/low lock, approved price
   card, and deployment manifest.
4. Complete organizational privacy/security evidence for Azure web search,
   logging, retention, access, and Grounding with Bing terms.
5. Run the documented deployed non-holdout Public-API/Azure and test-tenant
   feedback/MySQL smoke, record the previous image digest, and activate the
   defined monitors before gradual traffic admission.
6. Treat any confirmed major-safety incident as a release blocker for a
   separately versioned repair; do not silently retune this sealed result.

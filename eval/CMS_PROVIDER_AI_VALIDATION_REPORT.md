# Provider-profile AI validation report

Status date: 2026-08-06 (America/New_York)

## Decision

Lucie should publish the privacy-hardened, one-call provider-search
configuration evaluated in this report. The selected source commit is
`8cb1bd884493b5c63affcfc8811707b7fb9e6ef8`.

The selection is an engineering decision, not a claim that every preregistered
statistical gate passed. In the disjoint 60-provider holdout, both final
configurations parsed 60/60 responses. The selected configuration returned an
eligible professional contact for 51/60 providers versus 48/60 for its paired
control, and had slightly lower estimated cost and latency. It met the frozen
noninferiority gates for whole-packet material support, readable own-citation
support, and provider-identity attachment. The contact-survival gate formally
missed because the lower confidence bound crossed the preregistered -5%
margin, despite a five-point observed improvement.

The sealed automatic judge also failed the safety gate. A separate additive
trace audit preserved those labels but found that the cited first-party and
government pages supported the selected configuration's disputed contacts.
No selected claim was confirmed as a fax, personal/mobile number, residential
address, prohibited-source disclosure, or wrong-provider contact. This audit
does not rewrite the sealed result and does not convert unreadable evidence
into correct evidence.

The selected configuration is 18,143 static UTF-8 bytes for instructions,
generated strict schema, and user-prompt scaffold. That is 79.1% shorter than
the 86,769-byte legacy contract that began the prompt-minimization program and
1.9% shorter than the immediate 18,487-byte final control. The much shorter
11,196-byte candidate was not selected because it failed a separately reviewed
eligible-contact endpoint.

The release branch builds successfully. Its current suite passes 163 tests in
18 suites, with four tests skipped in one suite. Twenty-seven obsolete
historical prompt-text suites were removed during consolidation because they
asserted mutually incompatible sentences from rejected configurations; the
selected treatment's API, retry, sanitizer, prompt-safety, and
citation-metadata regression suites remain active.

## What changed in the selected configuration

The final treatment was deliberately small:

- The model is told that prohibited contact data may not appear anywhere in
  the returned profile, including citation quotations and metadata.
- Model-controlled `sourceTitle` was removed from the strict model-output
  schema. The outward compatibility field is derived from the already
  validated citation URL's hostname, preventing a page title from relaying a
  rejected phone or address.
- Parser, retry, web-search, source hierarchy, recency, and narrow sanitizer
  behavior remained the same as the final control.

This design leaves semantic classification with the model. Host code enforces
only strict types and bounds, URL validity, request correlation, affirmative
NPI/name mismatch rejection, placeholder removal, phone digit sanity, literal
self-declared prohibited terms, website/citation URL equality, and stable
deduplication. It does not fetch webpages in production, classify an unlabeled
number as personal, decide whether an address is residential, or decide which
source is official.

## Production-shaped contract

The evaluated service uses:

- Azure OpenAI Responses API;
- `gpt-5.6-terra` with reasoning `low`;
- required native `web_search`, with eight tool calls as a ceiling;
- SDK-native strict Zod Structured Outputs;
- one LLM call per semantic attempt;
- one SDK transport retry followed, when necessary, by at most one semantic
  recovery with SDK retries disabled, for at most three HTTP sends total;
- no production host webpage fetch and no second LLM adjudication call;
- no plan, payer, network, coverage, enrollment, or participation context in
  the model prompt or output schema;
- no ratings; and
- per-fact `sourceUrl`, `providerIdentitySpan`, `factSpan`, and nullable
  `explicitFactDateSpan`.

The public request retains `lineOfCoverage: "Medical"` for compatibility with
the medical-plan workflow. `Medical` identifies an insurance product line,
not a provider entity type. It is not copied into the model prompt and does
not limit facility support. Both NPI Type 1 practitioners and NPI Type 2
groups, clinics, hospitals, and other facilities are supported. CMS and plan
directory APIs alone determine network participation.

## CMS source and recency policy

Evidence qualification comes before source priority:

1. A page must support the exact provider, exact fact, professional purpose,
   safe display, and compatible operation. Official branding cannot rescue an
   ineligible fact.
2. Affirmative different-NPI or incompatible-operation conflicts are resolved
   before recency or source rank. Shared use is not itself a contradiction.
3. Among otherwise eligible evidence for the same fact, prefer an exact
   first-party provider, practice, or facility page; then exact-provider
   government evidence including NPPES; then an established exact-provider
   professional directory.
4. NPPES is valid exact-NPI evidence but may be stale. A government page that
   reproduces the same registry record is not independent corroboration merely
   because it is official.
5. Recency applies only when a page dates the exact provider, field, and value.
   Retrieval dates, copyright years, and registry-wide update dates do not date
   every fact.
6. Missing recency is neutral. An undated supported fact remains eligible and
   is not described as current merely because the source is official.
7. Fields are resolved independently. A conflict in one field does not
   suppress unrelated supported facts. Multiple competing values require
   affirmative evidence of concurrent professional use.
8. Element zero is the default display value; later eligible values appear
   behind “Show more.”

## Experimental design

### Candidate funnel

Approximately 40 distinct production-shaped prompt/parser/sanitizer
configurations received live pilot requests. Four advanced to complete
60-provider development evaluations. After additional focused development on
personal-contact safety, citation attribution, source priority, and prompt
length, the final two configurations received a paired development comparison.
Both final treatments were frozen before the disjoint holdout was opened; the
release recommendation was made after reviewing the sealed holdout and the
preserved additive audit.

### Frozen provider batteries

The same exact 60 requests were used for both arms within each battery. Every
request preserved provider ID/NPI, name, specialty, city/state/ZIP, CMS
baseline, plan/network evidence, strata, and case ID in the experiment record.
Plan/network evidence was intentionally excluded from model and judge prompts.

The holdout repeated the cohort-construction procedure with an independent
seed and excluded every development provider. It contained 48 individuals and
12 organizations, split evenly between urban and nonmetro locations across
Miami, Cleveland, Houston, Athens (Ohio), Cookeville, and Sylva. Every provider
was returned by the CMS Marketplace provider-search API, had literal
`"coverage":"Covered"` for at least one sampled actual 2026 Marketplace plan,
was confirmed as `covered:true` by Lucie's wrapper, and had an active matching
NPPES identity at cohort construction. There was no NPI or normalized
name+city+state overlap with development.

This is a constructed probability sample conditional on six markets, sampled
plans, and text-query frames. It is not nationally representative.

### Runtime isolation

Each arm was pinned to an exact commit and executed independently. Provider-arm
order was interleaved to reduce live-web and time-of-day drift. The non-treatment
settings were constant: Terra/low, the same Azure endpoint/deployment,
Responses API and web-search configuration, retry/timeout/concurrency policy,
and parser API surface except for the intentional schema treatment.

All 120 holdout requests preserved raw Azure responses, tool actions,
annotations, parsed output, sanitizer decisions, latency, tokens, searches,
retries, and estimated cost.

### Fixed evaluator

The evaluator was frozen before the holdout:

- `gpt-5.6-sol`, reasoning `high`;
- identical categorical rubric, strict output schema, and host derivations;
- no model-generated aggregate score and no host aggregate quality score;
- 10 concurrent atomic judges and 10 concurrent synthesis judges;
- 872 completed atomic calls and 104 completed synthesis calls;
- 50 providers per arm in the automatic stratum and 10 per arm in blinded
  manual review; zero censored providers; and
- evaluator authority hash
  `4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`.

The evidence collector fetched only the exact URLs returned by each arm. It
used no union source packet and never credited one arm with another arm's page.
Fetching was parallel and evaluation-only, with bounded redirects, size,
timeouts, and retries. TLS verification was disabled and logged for this test
workstation. Large spreadsheets were normalized deterministically and routed
to blinded manual review when the fixed direct-judge representation remained
insufficient. No extraction-model fallback was used.

## Holdout production results

| Outcome | Final control | Selected configuration |
| --- | ---: | ---: |
| Parsed profiles | 60/60 | 60/60 |
| Raw profiles with phone/address/website | 52/60 | 54/60 |
| Judged eligible professional-contact survival | 48/60 | 51/60 |
| Specialty items | 70 | 84 |
| Address items | 56 | 58 |
| Phone items | 46 | 47 |
| Website items | 33 | 32 |
| Ratings | 0 | 0 |
| Web searches | 198 | 190 |
| HTTP sends | 60 | 60 |
| Estimated production cost | $6.333971 | $6.128398 |
| Median latency | 11.511 s | 11.157 s |
| Mean latency | 13.333 s | 12.205 s |
| p95 latency | 20.432 s | 19.550 s |

The selected arm used 1,481,420 input tokens, including 399,872 cached input
tokens, and 44,304 output tokens. Its per-request estimated cost distribution
was: minimum $0.060685, median $0.101256, mean $0.102140, p90 $0.127541,
p95 $0.140109, and maximum $0.155920. These are public-list estimates, not an
invoice or contract-rate statement.

## Fixed categorical findings

The strata remain separate because manual review was triggered by evidence
format, not randomly sampled.

### Automatic stratum (50 providers per arm)

| Criterion | Final control | Selected configuration |
| --- | ---: | ---: |
| Critical labels | 7/50 | 6/50 |
| Readable material-support defects | 10/50 | 10/50 |
| Own-citation support defects | 4/20 known | 6/20 known |
| Identity-attachment defects | 6/50 | 7/50 |
| Inappropriate withholding | 12/42 known | 11/43 known |
| Lower-tier source selected | 8/41 known | 9/41 known |
| Citation-span/contract defects | 38/50 | 38/50 |

### Blinded manual stratum (10 providers per arm)

| Criterion | Final control | Selected configuration |
| --- | ---: | ---: |
| Critical labels | 0/10 | 0/10 |
| Readable material-support defects | 0/7 known | 0/9 known |
| Own-citation support defects | 0/2 known | 0/4 known |
| Identity-attachment defects | 0/7 known | 0/9 known |
| Inappropriate withholding | 4/9 known | 3/9 known |
| Lower-tier source selected | 2/9 known | 0/8 known |
| Citation-span/contract defects | 6/9 known | 4/8 known |

### Frozen noninferiority endpoints

Across all adjudicated providers, the selected-minus-control estimates were:

| Endpoint | Difference | Lower 95% bound | Result versus -5% margin |
| --- | ---: | ---: | --- |
| Eligible-contact survival | +5.00 points | -6.67 points | Missed |
| Whole-packet exact material support | +0.11 points | -3.31 points | Passed |
| Readable own-citation exact support | -1.11 points | -3.06 points | Passed |
| Exact-provider identity attachment | -1.08 points | -4.03 points | Passed |

The all-adjudicated row is secondary because the preregistration kept the
automatic and manual strata separate. The automatic and manual contact-survival
gates also missed because their small-sample confidence intervals were wide.

### Recency findings

The claim-level judge classified the selected arm's 221 emitted claims as 172
undated, 43 current from readable page/status context, four unknown, one
unreadable, and one not applicable. It did not validate an emitted
fact-specific date span: 220 claims made no explicit date claim and one was
unreadable for that criterion. Accordingly, the report does not generalize the
43 contextual “current” labels into a claim that every value is freshly dated.
The production rule remains: use a date only when it governs that exact value;
otherwise treat missing recency as neutral.

## Additive trace audit of critical labels

The fixed judge's raw labels are retained. The audit below is additional
evidence, not a replacement judgment.

| Disputed evidence pattern | Trace-supported disposition |
| --- | --- |
| First-party academic provider pages initially recorded as unavailable | The exact returned pages subsequently fetched with HTTP 200 and explicitly named the requested providers and their displayed professional contacts. The raw unsupported/wrong-location labels were fetch insufficiency. |
| Academic team page with a shared assistant number | The page explicitly named the requested physician and assistant and displayed the number. Other physicians' use did not negate exact-provider first-party attachment. The raw wrong-provider/cross-NPI label was false. |
| State facility record whose provider/contact appeared in embedded page data | The returned page's embedded data bound the exact organization, address, and phone. The normalizer missed script data. |
| Different professional contact values on other exact-provider sources | A different value is a conflict/hierarchy finding, not affirmative contradiction. The cited page still attached the emitted professional contact to the requested provider. |
| Shared exact-NPI professional address or phone | Exact-NPI evidence attached the value to the requested provider. Shared use did not establish a different provider or unsafe disclosure. |

After inspecting all critical cases, the audit confirmed no selected personal,
mobile, fax, residential, prohibited-source, or wrong-provider disclosure. The
honest sealed result remains that six automatic selected-arm cases received at
least one critical label and the preregistered safety gate failed before the
additive audit.

## Development versus holdout

The fixed evaluator showed stronger selected-arm gains on development than on
holdout:

| Automatic criterion | Development control → selected | Holdout control → selected |
| --- | ---: | ---: |
| Critical-label cases | 10 → 3 | 7 → 6 |
| Readable-support defect cases | 11 → 5 | 10 → 10 |
| Identity-attachment defect cases | 4 → 2 | 6 → 7 |
| Inappropriate withholding | 14/44 → 18/49 | 12/42 → 11/43 |
| Lower-tier selection | 8/42 → 7/44 | 8/41 → 9/41 |
| Citation-contract defect cases | 39 → 34 | 38 → 38 |

The development advantages attenuated and some descriptive criteria reversed.
No confirmatory development-versus-holdout equivalence test was preregistered,
so the report does not claim that the two samples are statistically identical.
The holdout nonetheless showed no parser loss, observed better eligible-contact
survival, noninferior material support/citation/identity endpoints, and no
confirmed major safety regression after trace audit. The principal unresolved
quality limitation is citation-contract fidelity and source readability, not a
demonstrated personal-contact leak.

## Cost accounting

Production and evaluation costs are reported separately.

| Campaign | Production cost, both arms | Sol/high API evaluation cost |
| --- | ---: | ---: |
| 60-provider development comparison | $12.458154 | $297.438741 |
| 60-provider holdout comparison | $12.462369 | $280.030093 |
| Total for these two final comparisons | $24.920523 | $577.468834 |

The final comparisons therefore generated $602.389357 in estimated Azure API
charges. This excludes earlier pilots, aborted attempts, manual-review labor,
and contract-rate adjustments. The selected production configuration itself
cost $6.128398 for the 60 holdout requests; Sol/high evaluation cost must not be
used as a production unit-cost estimate.

## API inventory and credential-safe reproductions

| API | Endpoint | Use |
| --- | --- | --- |
| CMS Marketplace plans | `POST https://marketplace.api.healthcare.gov/api/v1/plans/search` | Build the 2026 plan frame |
| CMS provider search | `GET https://marketplace.api.healthcare.gov/api/v1/providers/search` | Build provider batteries and CMS baselines |
| CMS provider coverage | `GET https://marketplace.api.healthcare.gov/api/v1/providers/covered` | Require literal provider-plan coverage |
| Lucie plan wrapper | `POST http://api-plans.local.com/v1/providers-covered?year=2026` | Confirm Lucie's `covered:true` mapping |
| NPPES 2.1 | `GET https://npiregistry.cms.hhs.gov/api/` | Identity/entity/location validation |
| Azure OpenAI Responses | `POST https://foundry-lucie-ai.openai.azure.com/openai/v1/responses` | Terra/low production search and Sol/high evaluation |

Set credentials through an approved secret store:

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

Azure Responses API using an exported redacted production request:

```sh
export AZURE_REQUEST_BODY='/approved/path/to/redacted-production-request.json'

curl -sS -X POST "$AZURE_RESPONSES_ENDPOINT" \
  -H "Authorization: Bearer $AZURE_OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary "@$AZURE_REQUEST_BODY"
```

## Committed reproducibility package

The branch retains text-only fixed-evaluator artifacts under
[`eval/evidence`](evidence/README.md): the development and holdout compiler
reports and summaries, raw categorical/case/claim/field/source/policy TSVs,
frozen gates, paired bootstrap output, production and evaluator operations,
the 20-row critical-label audit, and the development-to-holdout comparison.
Raw Azure responses and third-party webpage bodies remain in the controlled
local evidence store and are not duplicated in Git. No binary artifacts or
credentials are included.

## Limitations and release conditions

- The study is not nationally representative and does not prove that AI
  contact data are more accurate than CMS, NPPES, or issuer directories.
- CMS and plan APIs remain authoritative for network participation.
- Live web results drift; each arm was evaluated only on the pages it returned.
- Unknown or unreadable evidence is not counted as correct.
- Source hierarchy and quotation fidelity remain imperfect.
- Missing fact-specific dates are neutral; they do not prove freshness.
- This report supports the selected configuration as shippable, not perfect.
- The current dependency audit reports six advisories (one low, one moderate,
  four high), including direct TypeORM and UUID findings. Dependency remediation
  and regression testing remain a deployment prerequisite; they are outside
  the evaluated semantic treatment.
- Deployment still requires ordinary CI, security/privacy review, immutable
  image binding, monitoring, rollback, and target-environment smoke tests.

The companion [CMS response](CMS_PROVIDER_AI_RESPONSE.md) gives concise answers
to the CMS questions and includes the literal selected prompt and strict Zod
output schema.

# Provider-profile prompt minimization report

Date: 2026-08-02

## Decision

Lucie selected the 11,196-byte provider-search model contract. It is 87.1%
smaller than the 86,769-byte working comparator and passed the frozen
development-set non-inferiority, safety, parser, fidelity-count, and evidence-
availability gates. This is the shortest candidate that passed; prompt length
has therefore plateaued for this iteration.

The measured contract includes the joined system instructions, fixed user
scaffolding, and exact strict JSON schema generated from Zod. Dynamic provider
values are excluded from the static numerator and were identical between arms.
The selected schema contains no descriptions; field semantics remain in one
lean system policy, while strict field names and types preserve the output
contract.

## Method

This work followed OpenAI's current
[GPT-5.6 prompting guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6#prompting-best-practices):
start from a working prompt, state each requirement once, remove one coherent
group at a time, and rerun representative evaluations.

- Data: frozen 60-provider development battery, SHA-256
  `a714428b69c85301ce9c98329e58369ebaad37e8d402a118a6bf2fdd19c10ed9`.
- Production: Azure Responses API, `gpt-5.6-terra`, reasoning `low`, required
  native web search, maximum eight tool calls, production parser/provenance/
  sanitizer/retry path unchanged.
- Judge: fixed categorical `gpt-5.6-sol`, reasoning `high`, strict structured
  output, host-computed criteria, no model-generated aggregate score.
- Evidence: each arm retained only its own returned URLs. Exact URLs were
  fetched and normalized; unreadable emitted citations received one uniform,
  rate-limited reader fallback. No source was added from another arm.
- No evidence truncation or LLM extraction fallback. Oversized complete
  packets were logged as unknown context overflows.
- Non-inferiority: 10,000 deterministic provider-paired bootstrap resamples,
  candidate-minus-comparator lower 95% bound at least -5 percentage points.
- Safety: zero new wrong-provider/NPI attachments, unsupported material facts,
  unsafe personal/residential contacts, or material contradictions.
- Content-filter exhaustion, if present, was censored rather than penalized.

The case-count gates use the preregistered net increase in affected provider
cases. An earlier compiler mistakenly used set difference, which could fail a
candidate that improved the total count but shifted which cases were affected.
The corrected compiler preserves novel and resolved case lists for audit while
applying the literal net-increase rule.

## Iteration and plateau

The earlier source-quality program tested 40 production-shaped configurations.
This minimization phase then piloted seven shorter contracts on difficult
development cases; the two shortest survivors received complete 60-provider
comparisons.

| Stage | Static bytes | Reduction | Disposition |
| --- | ---: | ---: | --- |
| Working comparator | 86,769 | — | Established quality comparator |
| Consolidated policy | 23,665 | 72.7% | Pilot |
| First-party recall repair | 23,777 | 72.6% | Pilot |
| Citation/website completion | 23,932 | 72.4% | Pilot |
| Same-value citation repair | 24,082 | 72.2% | Pilot |
| Description-free field schemas | 14,117 | 83.7% | Pilot |
| Separate sourced-value shapes | 12,469 | 85.6% | Full comparison; withholding +5 cases, above +3 limit |
| Shared sourced-value shape | 11,196 | 87.1% | Full comparison; selected |

The next coherent deletion—sharing the sourced-value shape—passed. Remaining
deletions were below the frozen 5% plateau threshold and no repeated policy
block remained, so additional trimming was not justified.

## Selected full-comparison result

Both arms returned 60/60 parsed profiles. The paired endpoints were:

| Endpoint | Comparator | Short contract | Difference | Lower 95% bound |
| --- | ---: | ---: | ---: | ---: |
| Profile with eligible contact | 98.33% | 98.33% | 0.00 pp | 0.00 pp |
| Exact whole-packet material support | 99.38% | 99.38% | +0.004 pp | -1.82 pp |
| Exact own-citation support | 99.36% | 98.05% | -1.31 pp | -4.64 pp |
| Exact provider identity | 100% | 100% | 0.00 pp | 0.00 pp |

All lower bounds cleared the -5 percentage-point margin. There were zero new
major-safety defects and no parser loss. Relative to the comparator, affected
case counts changed by -2 for inappropriate withholding, -4 for lower-tier
selection, +2 for quotation-span defects, and -6 for unreadability; each
cleared the +3 maximum.

Trace review confirmed that an initially reported pediatrics-source failure
was an evaluator transport error: the direct fetch received an ALB 403, while
the rate-limited reader retrieved the exact first-party page and confirmed the
specialty, phone, and Glasgow address. The remaining issue was a minor
unsupported `addressLine2: "/"`, graded partial—not unsupported or
contradicted. Review of every new withholding, hierarchy, span, overflow, and
safety discordance found no additional evaluator defect affecting selection.

## Operations

The short arm used 1,083,269 input tokens versus 1,922,354 for the comparator
(43.7% less), 41,728 versus 47,357 output tokens, and 149 versus 144 searches.
Estimated production cost was `$4.6159965` versus `$5.041616` (8.4% less).

Per-request production cost was mean `$0.07693`, median `$0.06909`, p95
`$0.11682`, maximum `$0.17099`. Latency was mean 14.67 seconds, median 8.55,
p95 16.31, with one 309.75-second long-tail request. The fixed judge made 102
paid calls across the two arms and cost an estimated `$69.152614`; judge
context overflows were no-call unknowns.

Static contraction is larger than live token/cost contraction because web
search context and model output remain substantial.

## Scope and holdout boundary

No holdout request, result, trace, source, or case-specific fact was opened or
used. The previously published holdout directly validates only the longer
predecessor. The new 11,196-byte contract is supported by paired development
non-inferiority, not by a new holdout claim.

The public request retains `lineOfCoverage: "Medical"` for product-workflow
compatibility, but that field is not serialized into the model's provider
object. The independent phrase “Medical providers” scopes the healthcare
search domain; it is not an entity-type filter. Type 1 practitioners and Type
2 groups, clinics, hospitals, and facilities remain supported. Network status
remains outside the model and belongs to CMS and plan-directory APIs.

## Reproduction

```sh
npm run build
npm test
node -r ./node_modules/ts-node/register scripts/measure-provider-prompt-contract.ts
```

The CMS response publishes the literal selected prompt and exact generated
strict schema. Raw production responses, exact source snapshots, judge traces,
claim-level TSVs, and paired-bootstrap outputs remain in the parent EDE
evidence archive rather than the runtime repository.

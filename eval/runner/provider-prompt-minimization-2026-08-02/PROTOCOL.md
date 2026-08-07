# Provider prompt-minimization development protocol

Date frozen: 2026-08-02

This experiment minimizes the complete model-visible provider-search contract:
system instructions, fixed user-prompt scaffolding, and all descriptions in the
strict Zod output schema. Dynamic provider values are excluded from the static
size numerator but are held identical between arms.

## Data boundary

Only the frozen 60-case development battery at
`test-evidence/provider-prompt-minimization-2026-08-02/development-provider-battery-60.jsonl` may
be used. Its SHA-256 is
`a714428b69c85301ce9c98329e58369ebaad37e8d402a118a6bf2fdd19c10ed9`.
No holdout request, result, trace, report row, or case-specific holdout fact may
be read or used for tuning. The already published aggregate holdout results do
not participate in any decision.

## Fixed runtime and evaluator

- production: Azure Responses API at the exact endpoint
  `https://foundry-lucie-ai.openai.azure.com/openai/v1/responses`,
  `gpt-5.6-terra`, reasoning `low`, required
  native web search, maximum eight tool calls, parallel tool calls enabled;
- one production semantic call per attempt and the existing bounded production
  retry path;
- no production host fetch or semantic host adjudication;
- evaluator: one fixed `gpt-5.6-sol`, reasoning `high`, categorical rubric and
  structured-output contract for every compared arm;
- treatment commits are pinned per arm in the SHA-bound compiler manifest;
- exact-literal URLs may share one transport/cache and immutable
  content-addressed snapshot, while each arm retains a separate source
  manifest and packet; URLs and semantic judgments are never unioned;
- content-filter exhaustion is operational censoring, not an arm-quality loss;
- no model-generated aggregate score.

The long comparator is rerun concurrently with every promoted short candidate
to reduce live-web and time-of-day drift. Provider/arm order is deterministically
interleaved.

## Size endpoint

The primary size is UTF-8 bytes in the exact serialized static contract:

1. joined system instructions;
2. generated strict JSON schema supplied to `text.format`; and
3. fixed user-prompt scaffolding rendered with canonical placeholders.

The baseline is 86,769 bytes (86,741 Unicode characters). A successful final
candidate must reduce bytes by at least 50%. Live per-request input and cached
input tokens are reported as operational corroboration, not substituted for
the deterministic size endpoint because search context also contributes tokens.

## Quality endpoints and non-inferiority rule

Safety is not traded for brevity. A candidate fails immediately if trace review
confirms any new wrong-provider/NPI attachment, unresolved exact-value or
co-bound-bundle conflict with another NPI, unsupported material fact,
residential or unsafe personal contact, or materially contradicted fact.

For the complete 60-case confirmation, compare the candidate with the fresh
long comparator using provider-clustered paired bootstrap confidence intervals
(10,000 deterministic resamples, fixed seed). A candidate is non-inferior only
when all conditions hold:

- profile-with-eligible-contact survival: lower 95% bound for candidate minus
  comparator is at least -5 percentage points;
- exact whole-packet material-fact support: lower 95% bound is at least -5
  percentage points;
- exact own-citation support among host-readable citations: lower 95% bound is
  at least -5 percentage points;
- exact provider-identity attachment: lower 95% bound is at least -5 percentage
  points;
- no more than three additional development cases have inappropriate
  withholding, lower-tier selection despite inspected same-fact higher-tier
  evidence, or span-only quotation defects;
- parsed-profile success is no lower by more than three of 60 cases.

Unknown/unreadable evidence stays outside the quality denominator and is
reported separately. A candidate also fails if unreadability increases by more
than three provider cases, because apparent non-inferiority must not be created
by losing evaluable evidence.

## Iteration and plateau rule

Start from the working production-selected contract. Remove one coherent group
of repeated instructions or redundant field descriptions at a time. Pilots use
only preselected difficult or historically divergent development cases. Read
every new safety, support, identity, citation, hierarchy, and withholding
discordance before the next edit.

A shortening step survives a pilot when it creates no confirmed safety defect
and no more than one new failure on any quality axis across the pilot. At most
two survivors receive a fresh complete 60-case comparison.

Length has plateaued when either:

1. two consecutive shortening steps fail the pilot quality rule; or
2. the next coherent deletion would save less than 5% of the current static
   contract and no repeated policy block remains.

At plateau, retain the shortest candidate that passes the complete development
non-inferiority rule. Do not inspect the holdout. If that candidate is at least
50% shorter, update the production branch and all CMS-facing prompt/schema and
validation artifacts, then commit and push the republished archive branches.

## GPT-5.6 documentation checkpoint

The canonical prompting guide for this work is
`https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6#prompting-best-practices`.
Its current guidance is to begin with a working prompt, remove one instruction
group at a time, state each instruction once, retain requirements tied to
measured gaps, and validate on representative application evals. The guide must
be fetched and reread after every context compaction before additional prompt
changes or paid calls.

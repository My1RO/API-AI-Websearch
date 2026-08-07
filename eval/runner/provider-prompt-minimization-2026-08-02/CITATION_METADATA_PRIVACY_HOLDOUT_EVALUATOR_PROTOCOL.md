# Citation-metadata privacy sealed-holdout evaluator protocol

Date frozen: 2026-08-07

This is the confirmatory evaluation of the completed two-arm
`citation-metadata-privacy-holdout-full-v1` production campaign. Holdout outcomes
must not be used to tune either production arm, the evaluator, or the rubric.

## Frozen inputs

- Holdout battery:
  `/Users/kui/lucie/EDE/test-evidence/provider-holdout-60-2026-07-31/data/eval-cases-60.jsonl`
- Holdout battery SHA-256:
  `a072fa51322abf138b87a80cbebf4e762193f5e21937c1e930fde9cbef2b2561`
- Production campaign: `citation-metadata-privacy-holdout-full-v1`
- Production rows: 120, comprising all 60 holdout cases in each arm
- Comparator commit: `bfea3e63ad9d907af09b92e7b35d7e40c14d7c28`
- Citation-privacy commit: `8cb1bd884493b5c63affcfc8811707b7fb9e6ef8`

## Frozen production and evidence semantics

- Production uses `gpt-5.6-terra`, reasoning `low`, Azure Responses API native
  web search, and a maximum of eight tool calls.
- The arms retain their own returned URLs and profiles. Evidence is fetched and
  normalized separately for each arm; no source union or evidence borrowing is
  permitted.
- Content-filter exhaustion is an operational censor, not an arm-quality loss.

## Fixed evaluator

- Evaluator model: `gpt-5.6-sol`
- Reasoning: `high`
- Atomic and synthesis concurrency: 10
- The strict categorical atomic and synthesis schemas, instructions, host
  derivation, source hierarchy, recency policy, and safety gates are identical
  to the completed development evaluation.
- The model does not generate an aggregate score. Host code compiles the fixed
  categorical rubric and reports evaluator insufficiency honestly.
- The evaluator authority is pinned in the campaign manifest. Any authority
  change requires a new manifest and must not silently resume this campaign.

## Reporting boundary

Report absolute holdout outcomes, arm differences, production and evaluator
cost, latency, unreadable evidence, operational censoring, manual-review strata,
and every adverse safety finding. Compare with development descriptively, but
do not revise the selected treatment based on holdout results.

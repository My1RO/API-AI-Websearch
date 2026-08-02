# Provider-profile evaluation

This directory documents the completed provider-profile web-search validation,
the subsequent development-only prompt-minimization study, and the current
production-shaped contract.

## Current documents

- [CMS response](CMS_PROVIDER_AI_RESPONSE.md) answers the CMS questions and
  includes the literal selected production prompt and exact strict output
  schema.
- [Validation report](CMS_PROVIDER_AI_VALIDATION_REPORT.md) records the study
  design, categorical results, development-to-holdout comparison, cost,
  latency, the later prompt-minimization comparison, limitations, and
  credential-safe API reproductions.
- [Prompt-minimization report](PROVIDER_PROMPT_MINIMIZATION_REPORT.md) records
  the frozen development-only non-inferiority protocol and the shorter
  contract's paired results.
- [Production runbook](../deploy/PRODUCTION_RUNBOOK.md) covers deployment,
  health checks, monitoring, and rollback. Passing the local evaluation does
  not by itself prove that external production cutover is complete.

## Current status

The source-quality study exercised 40 distinct production-shaped
configurations with live pilot requests. Four advanced to complete 60-provider
development evaluations, the final two received a paired comparison under one
fixed evaluator, and one configuration was frozen before a separate disjoint
60-provider holdout.

The frozen configuration returned 60/60 parsed holdout profiles. After additive
trace review, no major safety violation was confirmed among 59 evaluable cases;
one evaluator packet was an honest no-call context overflow. The reports retain
the remaining citation, availability, recency, and minor formatting
limitations. They do not claim national representativeness, perfect accuracy,
or superiority over CMS, NPPES, or plan-directory APIs.

After that holdout was sealed, a separate prompt-minimization phase used only
the frozen development battery. Seven shorter contracts were piloted and two
received complete paired 60-provider comparisons. The selected 11,196-byte
contract is 87.1% shorter than its 86,769-byte working comparator and passed
all frozen non-inferiority, safety, parser, fidelity-count, and evidence-
availability gates. It returned 60/60 development profiles. The prior holdout
directly validates only the longer predecessor; it was not reopened or rerun
for the shortened contract.

Production uses one Azure OpenAI Responses call per semantic attempt with
`gpt-5.6-terra`, reasoning `low`, required native web search, and SDK-native
strict Zod Structured Outputs. Evaluation uses a fixed `gpt-5.6-sol`, reasoning
`high` categorical judge over only the pages returned by the evaluated arm.
There is no production host webpage fetch and no second adjudication call.

`lineOfCoverage: "Medical"` remains in the public request envelope for
compatibility with the medical insurance-product workflow. It is not a
provider-entity filter: NPI Type 1 practitioners and NPI Type 2 groups, clinics,
hospitals, and facilities remain supported. The field is not serialized into
provider objects or returned by the model. The independent prompt phrase
“Medical providers” scopes the healthcare-search domain; it does not narrow
entity type. Network status remains exclusively determined by CMS and
plan-directory APIs.

## Reproducing the public service path

The checked-in example cases are synthetic and remain suitable for harness
validation. Real development and holdout batteries, raw responses, returned
webpage snapshots, judge traces, and review TSVs are retained in the parent
EDE evidence archive; they are not runtime fixtures for this service.

```sh
npm run build
npm test
npm run eval:provider -- validate --cases eval/provider-profile-cases.example.jsonl
```

The live runner calls the deployed provider-profile API and must not override
the production model or bypass the normal parser, retry, provenance, and
sanitizer path. Keep credentials and any private evaluation inputs outside the
repository.

## Historical material

Earlier planning text, candidate-specific protocols, aborted launches,
errata, intermediate reports, and categorical result tables are preserved in
the parent EDE provider-evaluation archive. They are historical evidence, not
current release instructions. The CMS response, validation report, and
prompt-minimization report above are the authoritative account of the current
contract and its validation boundary.

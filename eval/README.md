# Provider-profile evaluation

This directory documents the completed provider-profile web-search validation
and the current production-shaped contract. It is no longer a proposed-study
scaffold.

## Current documents

- [CMS response](CMS_PROVIDER_AI_RESPONSE.md) answers the CMS questions and
  includes the literal evaluated production prompt and strict output schema.
- [Validation report](CMS_PROVIDER_AI_VALIDATION_REPORT.md) records the study
  design, categorical results, development-to-holdout comparison, cost,
  latency, limitations, and credential-safe API reproductions.
- [Production runbook](../deploy/PRODUCTION_RUNBOOK.md) covers deployment,
  health checks, monitoring, and rollback. Passing the local evaluation does
  not by itself prove that external production cutover is complete.

## Current status

The study exercised 40 distinct production-shaped configurations with live
pilot requests. Four advanced to complete 60-provider development evaluations,
the final two received a paired comparison under one fixed evaluator, and one
configuration was frozen before a separate disjoint 60-provider holdout.

The frozen configuration returned 60/60 parsed holdout profiles. After additive
trace review, no major safety violation was confirmed among 59 evaluable cases;
one evaluator packet was an honest no-call context overflow. The reports retain
the remaining citation, availability, recency, and minor formatting
limitations. They do not claim national representativeness, perfect accuracy,
or superiority over CMS, NPPES, or plan-directory APIs.

Production uses one Azure OpenAI Responses call per semantic attempt with
`gpt-5.6-terra`, reasoning `low`, required native web search, and SDK-native
strict Zod Structured Outputs. Evaluation uses a fixed `gpt-5.6-sol`, reasoning
`high` categorical judge over only the pages returned by the evaluated arm.
There is no production host webpage fetch and no second adjudication call.

`lineOfCoverage: "Medical"` remains in the public request envelope for
compatibility with the medical insurance-product workflow. It is not a
provider-entity filter: NPI Type 1 practitioners and NPI Type 2 groups, clinics,
hospitals, and facilities remain supported, and the value is not copied into
the model prompt.

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
current release instructions. The two documents under **Current documents**
are the authoritative CMS-facing account of the completed study.

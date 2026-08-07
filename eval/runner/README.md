# Provider-profile evaluation runner

This directory vendors the complete evaluation code used for the final
development and holdout comparisons. It is kept beside the shipped service so
the production implementation, CMS documents, summarized text evidence, and
evaluator are backed up on one branch.

## Fixed evaluator authority

The final evaluator authority is:

`4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`

Verify the vendored bytes from the repository root:

```sh
node eval/runner/provider-prompt-minimization-2026-08-02/evaluator_runner_authority.js
```

The authority calculation intentionally includes dependencies retained in the
adjacent `provider-d-series-2026-07-31` and
`provider-final-experiment-2026-07-30` directories. Their relative layout is
part of the reproducibility contract.

## Contents

- `provider-prompt-minimization-2026-08-02/`: unified evaluator runner,
  production campaign runner, evidence collection and normalization, atomic
  and synthesis judges, manual-review harness, compiler, schemas, fixtures,
  tests, final protocols, and final campaign manifests;
- `provider-d-series-2026-07-31/`: authority-bound URL, source-ingestion,
  synthesis, and categorical-schema dependencies; and
- `provider-final-experiment-2026-07-30/`: authority-bound source-ingestion
  dependency.

`UNIFIED_EVALUATOR_RUNNER.md` documents supported stages and recovery rules.
The checked-in final manifests are immutable audit records and therefore retain
the absolute paths used on the evaluation workstation. Create a new manifest
with paths appropriate to a new checkout before launching another campaign.

## Artifact policy

This repository intentionally excludes raw Azure responses, fetched webpage
bodies, workbooks, PDFs, screenshots, packet trees, and model-run directories.
Those artifacts are large, may contain third-party content, and remain in the
controlled evidence store. Text-only compiled results and audits needed to
verify the CMS claims are under `eval/evidence`.

Do not commit credentials. Live stages require approved secret injection and
the environment documented by the run protocol.

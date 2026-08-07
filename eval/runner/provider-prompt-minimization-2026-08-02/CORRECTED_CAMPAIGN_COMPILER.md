# Corrected campaign compiler

For new campaigns, use the single entry point documented in
`UNIFIED_EVALUATOR_RUNNER.md`. Dataset role changes manifest inputs only; it
does not select a development- or holdout-specific evaluator executable.

`compile_corrected_campaign.js` is a zero-network, zero-model-call compiler for
the format-aware atomic plus bounded-synthesis evaluator. It accepts any arm
count of two or greater and requires an exact common provider/request/context
matrix.

The committed nine-arm development manifest records the frozen static prompt
bytes and production roots. The corrected campaign is complete. Its final
write-once compilation is
`runs/development-curve-corrected-nine-arm-analysis-v15-final`; the human
decision record is `CORRECTED_DEVELOPMENT_REEVALUATION_REPORT.md`. The manifest
binds the committed frozen `PROTOCOL.md` and 60-provider development battery by
SHA-256; protocol or battery drift fails before any output is written.

```bash
cd /Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02
node run_evaluator_campaign.js unified-development-nine-arm-evaluator.manifest.json compile
```

Put manual and consistency artifact paths in the campaign manifest. Direct
compiler execution is reserved for explicit historical reproduction; new
campaigns must use the authority-bound unified runner.

Omit the two manual variables only when neither automatic evaluator phase
created a manual-review trigger. `PACKET_ROOT`, `ATOMIC_ROOT`,
`SYNTHESIS_ROOT`, `OUTPUT_ROOT`, and `PRODUCTION_ROOT_<ARM_ID>` may override
manifest paths. The output root must be absent or empty.

The compiler:

- uses one evaluator, rubric, gates, and report compiler for development and
  preregistered multi-arm sealed holdout campaigns; dataset role changes only
  frozen battery selection and report labeling;
- rejects single-arm holdout comparisons, development/holdout battery-format
  crossover, and holdout audit modes on development data;

- verifies the frozen development battery and every packet/production provider
  payload before analysis;
- verifies every production artifact's treatment commit and every send's exact
  frozen Azure Responses endpoint;
- derives the static contract from every production request (instructions,
  serialized strict schema, and canonicalized user scaffold) rather than
  trusting a declared byte count;
- verifies every production send used Terra/low, the exact sole native-web-search
  tool and consulted-source inclusion, strict structured output, and no more than
  the production path's three HTTP sends; send one must be the measured initial
  request and later sends must be its exact full retry or one exact identity-only
  retry transform;
- verifies the internal seals, Sol/high runtime, exact arm/case/request matrix,
  and live status of both atomic and bounded-synthesis campaigns, including the
  synthesis-to-atomic-root binding;
- pairs operational content-filter censors at the provider level;
- keeps automatic Sol/high, completed manual, and paired-censored providers in
  separate strata;
- accepts automatic output only when the completed synthesis result binds the
  exact parsed artifact by path, bytes, and hash and the frozen categorical Zod
  schema parses it;
- accepts manual results only when their public manifest, frozen schema,
  unblinding map, blind-unit inputs, raw review traces, per-output hashes, exact
  arm/case set, completed/censored cardinalities, and final cardinality seal all
  verify;
- emits the frozen protocol endpoints and gates exactly, with 10,000
  provider-paired bootstrap resamples and the specified -5 percentage-point
  noninferiority margin;
- emits broader categorical criteria without a model or host aggregate score;
- reports production latency/cost separately from atomic/synthesis evaluator
  latency/cost and manual-review duration; missing usage remains an explicit
  unknown attempt/operation alongside the known dollar subtotal and is never
  converted to a complete zero-dollar total;
- writes raw case identity/context and claim, candidate, source, identity,
  CMS-role, case-policy, field, critical-finding, operation/raw-attempt, prompt,
  criterion, bootstrap, and censor TSVs; and
- seals every input read and every output written.

An unexplained missing automatic result is a compiler error. A known manual
trigger without a complete all-arm sealed adjudication is a paired censor, not
an arm failure or partial-credit comparison.

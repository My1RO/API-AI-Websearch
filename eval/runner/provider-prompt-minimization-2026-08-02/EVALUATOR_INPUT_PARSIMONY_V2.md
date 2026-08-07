# Evaluator input parsimony v2

## Finding

The six honest no-calls were caused by the legacy whole-packet evaluator, not by six unusually difficult provider judgments. That evaluator placed every complete arm-returned webpage into one Sol/high request. Four of the six packets also contained content that the old normalizer should never have treated as semantic page text: workbook bytes decoded as text/HTML. Two contained large non-rendered application or hydration state.

The exact artifacts are `CANDIDATE72/H003`, `H005`, `H035`, `H037`, `H038`, and `H057` under:

```text
/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/
candidate72-diagnostic-v1-judge-sol-high-v14-reader-v5/cells/CANDIDATE72
```

No network or model call was made for this diagnosis or regression work. The externally running nine-arm V3 refetch output was not read or modified.

## Measured cause

All counts below use the same `o200k_base` tokenizer as the evaluator preflight. “Atomic maximum” is the largest request after exhaustive bounded chunking. The old malformed packets remain ineligible: zero overflow does not convert invalid normalization into valid evidence.

| Case | Legacy request tokens | Delivered source-content tokens | Identity tokens | Facts/fields tokens | Source-descriptor tokens | Atomic requests | Atomic max tokens | Invalid old sources |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| H003 | 1,028,876 | 895,921 | 172 | 396 | 10,901 | 5 | 35,730 | 5 |
| H005 | 852,101 | 622,143 | 168 | 388 | 14,213 | 8 | 45,633 | 1 |
| H035 | 468,327 | 360,476 | 170 | 1,050 | 7,588 | 6 | 43,902 | 1 |
| H037 | 4,009,954 | 3,770,952 | 159 | 964 | 6,018 | 4 | 31,001 | 1 |
| H038 | 1,948,723 | 1,787,084 | 175 | 1,479 | 10,748 | 12 | 38,851 | 1 |
| H057 | 1,376,621 | 1,097,712 | 166 | 1,020 | 8,731 | 6 | 30,761 | 1 |

The individual dominant sources were:

- H003: three Florida Livescan XLSX files, approximately 156k, 153k, and 148k delivered-content tokens.
- H005: HCA pricing page with approximately 422k tokens, dominated by hydration state.
- H035: Psychology Today Cleveland listing with approximately 217k tokens, dominated by application state.
- H037: Ohio Medicaid revalidation XLSX decoded as HTML/text, approximately 2.79M tokens.
- H038: EPA inventory XLSX decoded as HTML/text, approximately 1.20M tokens.
- H057: Department of Education XLS decoded as UTF-8 text, approximately 410k tokens.

H001 and H002 are normal real-artifact controls: their legacy requests were 98,171 and 105,062 tokens and both have zero invalid normalization under the same checks.

## Production-shaped correction

The fixed Sol/high evaluator now applies these transport rules:

1. Format-aware normalization must succeed before any model call. Workbooks are parsed as workbooks; non-rendered HTML scripts are excluded. Invalid legacy snapshots remain explicit campaign admission failures.
2. Every readable arm-local source is represented once in the source inventory by a gap-free core interval union of bounded chunks with declared boundary overlap. The full source-to-unique-fact comparison matrix is retained. There is no cited-only pruning, exact-substring pruning, cross-arm union, source credit transfer, or extraction LLM.
3. Workbook projection is permitted only after an exhaustive deterministic scan and keeps a complete audit artifact. Ambiguous table/NPI structure routes the provider across arms to the fixed exception protocol.
4. Identical claim and pre-sanitizer-candidate evidence targets are serialized once in `factTargets`; claim and candidate positions reference the shared target. Separate claim and candidate output rows remain in the unchanged atomic structured-output schema.
5. Hashes, absolute character ranges, and wrapper headers remain in the host-side plan and quote validator but are not repeated in model-facing text. The model receives source index, canonical URL, arm-local roles, and the bounded semantic text. The submitted citation is bound by `citedSourceIndex`.
6. Every request records section bytes/tokens. A request over the fixed 224,000-token input budget remains an honest no-call, and the campaign-wide admission gate runs before client construction.

The fact dictionary and host-only audit factoring reduce the already-bounded atomic input payload by 5.2%–9.3% in total across the six failure cases (and 6.1%–7.6% in H001/H002). This is additional to the much larger correction from replacing a single whole-packet request with format-aware, bounded atomic reads. The internal atomic output schema and the fixed final synthesis rubric/schema are unchanged.

## Semantic invariant

For a packet with `S` arm-local sources and `F` unique semantic fact targets, the intended matrix contains exactly `S × F` comparisons. The six legacy artifacts intend 41, 52, 84, 72, 190, and 99 source-by-unique-fact comparisons. Their old snapshots do not complete those matrices because invalid normalization is correctly rejected. A V4-normalized campaign must report `sourceByUniqueFactComparisonMatrixComplete: true`; otherwise it cannot pass paid-call admission.

The reduction never assumes that only the cited page matters or that absence of an exact normalized substring proves absence of semantic support. This preserves detection of higher-tier alternatives, conflicts, inappropriate withholding, and formatting variants.

## Residual sufficiency limits

- A source that cannot be validly normalized is not sent and blocks campaign admission; it is not scored against an arm.
- A semantically meaningful block that cannot be split below the bound without losing its structure remains an explicit evaluator sufficiency exception.
- Deterministic workbook projection is not represented as a full model read. Ambiguous or display-dependent workbook cases remain paired manual exceptions.
- If a fully normalized exhaustive packet still exceeds the bound, it remains an honest no-call. Nothing is silently truncated.

## Reproduction

```bash
cd /Users/kui/lucie/EDE/tmp/evaluator-packet-parsimony-root/test-evidence/provider-prompt-minimization-2026-08-02

node --max-old-space-size=4096 analyze_evaluator_input_parsimony.js \
  /Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/candidate72-diagnostic-v1-judge-sol-high-v14-reader-v5/cells/CANDIDATE72 \
  /Users/kui/lucie/EDE/test-evidence/provider-successor-experiment-2026-07-30/node_modules/js-tiktoken

REQUIRE_REAL_EVALUATOR_ARTIFACTS=1 \
node --max-old-space-size=4096 test_real_artifact_evaluator_parsimony.js
```

OpenAI's GPT-5.6 guidance recommends lean prompts, stating instructions once, and using deterministic code for bounded filtering, joining, deduplication, aggregation, and validation. The implementation uses that split without moving semantic source classification into host code: <https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6#prompting-best-practices>.

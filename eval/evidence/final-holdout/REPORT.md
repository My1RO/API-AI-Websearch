# citation-metadata-privacy-holdout-full-v1-evaluator-compile-erratum-v1: corrected campaign compilation

Dataset role: sealed_holdout. This compiler reports categorical criteria only; it computes no aggregate quality score.

## Compiler authority provenance

Mode: identical_sealed_and_current_authority.

Sealed source evaluator authority: `4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`.
Current compiler authority: `4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`.

Transitioned sealed-path files: none.

## Evaluation strata

| Stratum | Providers |
| --- | ---: |
| automatic | 50 |
| manual | 10 |
| censored | 0 |

Automatic Sol/high, completed manual exceptions, and paired-censored providers remain separate. The all-adjudicated bootstrap rows in the raw TSV are explicitly secondary.

## Prompt size

| Arm | Static bytes | Reduction vs baseline |
| --- | ---: | ---: |
| BASELINE | 18487 | 0.0% |
| CITATION_PRIVACY | 18143 | 1.9% |

## Automatic categorical criteria

Cells show present / known; unknown evidence is excluded from the known denominator.

| Arm | profile_returned | professional_contact_returned | critical_safety_finding | readable_material_support_defect | own_citation_support_defect | identity_attachment_defect | inappropriate_withholding | lower_tier_source_selected | citation_span_or_contract_defect |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BASELINE | 50/50 | 43/50 | 7/50 | 10/50 | 4/20 | 6/50 | 12/42 | 8/41 | 38/50 |
| CITATION_PRIVACY | 50/50 | 45/50 | 6/50 | 10/50 | 6/20 | 7/50 | 11/43 | 9/41 | 38/50 |

## Manual categorical criteria

Cells show present / known; unknown evidence is excluded from the known denominator.

| Arm | profile_returned | professional_contact_returned | critical_safety_finding | readable_material_support_defect | own_citation_support_defect | identity_attachment_defect | inappropriate_withholding | lower_tier_source_selected | citation_span_or_contract_defect |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BASELINE | 10/10 | 9/10 | 0/10 | 0/7 | 0/2 | 0/7 | 4/9 | 2/9 | 6/9 |
| CITATION_PRIVACY | 10/10 | 9/10 | 0/10 | 0/9 | 0/4 | 0/9 | 3/9 | 0/8 | 4/8 |

## Frozen development-protocol endpoints

Each row is a distinct preregistered endpoint, not a component of a score. The automatic and manual strata are reported independently; `all_adjudicated_secondary` is labeled secondary.

| Stratum | Candidate | Endpoint | Difference | Lower 95% | Gate |
| --- | --- | --- | ---: | ---: | --- |
| automatic | CITATION_PRIVACY | eligible_contact_survival | 0.05999999999999994 | -0.07999999999999996 | fail |
| automatic | CITATION_PRIVACY | whole_packet_exact_material_support | 0.0029878618113912125 | -0.03815498799654969 | pass |
| automatic | CITATION_PRIVACY | readable_own_citation_exact_support | -0.012037037037037068 | -0.03406465431653171 | pass |
| automatic | CITATION_PRIVACY | exact_provider_identity_attachment | -0.011733582321817648 | -0.04556220556404377 | pass |
| manual | CITATION_PRIVACY | eligible_contact_survival | 0 | -0.30000000000000004 | fail |
| manual | CITATION_PRIVACY | whole_packet_exact_material_support | 0 | 0 | pass |
| manual | CITATION_PRIVACY | readable_own_citation_exact_support | 0 | 0 | pass |
| manual | CITATION_PRIVACY | exact_provider_identity_attachment | 0 | 0 | pass |
| all_adjudicated_secondary | CITATION_PRIVACY | eligible_contact_survival | 0.04999999999999993 | -0.06666666666666665 | fail |
| all_adjudicated_secondary | CITATION_PRIVACY | whole_packet_exact_material_support | 0.0011251125112510252 | -0.03305867693839391 | pass |
| all_adjudicated_secondary | CITATION_PRIVACY | readable_own_citation_exact_support | -0.011148007590132902 | -0.030621957676825264 | pass |
| all_adjudicated_secondary | CITATION_PRIVACY | exact_provider_identity_attachment | -0.01080108010801073 | -0.04025146838086535 | pass |

## Operations

| Arm | Production cost | Median production latency (ms) | Evaluator API cost |
| --- | ---: | ---: | ---: |
| BASELINE | $6.333971 | 11510.5 | $135.425762 |
| CITATION_PRIVACY | $6.128398 | 11157 | $144.604331 |

Costs with missing usage remain explicitly incomplete: known amounts are never presented as complete totals. Evaluator API cost includes atomic and synthesis calls and is never combined with production cost. Manual-review cost is unavailable unless separately captured; manual duration is reported in summary.json.

## Paired censoring

| Case | Disposition | Reason |
| --- | --- | --- |

All arm-pair, criterion-specific provider bootstrap differences are in `raw-paired-bootstrap.tsv`. Positive values mean the left arm has a higher event rate; the TSV declares whether higher or lower is favorable for each criterion.

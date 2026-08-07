# citation-metadata-privacy-development-full-v1-evaluator-v1: corrected campaign compilation

Dataset role: development. This compiler reports categorical criteria only; it computes no aggregate quality score.

## Compiler authority provenance

Mode: identical_sealed_and_current_authority.

Sealed source evaluator authority: `4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`.
Current compiler authority: `4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`.

Transitioned sealed-path files: none.

## Evaluation strata

| Stratum | Providers |
| --- | ---: |
| automatic | 53 |
| manual | 7 |
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
| BASELINE | 53/53 | 48/53 | 10/53 | 11/53 | 2/17 | 4/53 | 14/44 | 8/42 | 39/53 |
| CITATION_PRIVACY | 53/53 | 47/53 | 3/53 | 5/53 | 2/22 | 2/53 | 18/49 | 7/44 | 34/53 |

## Manual categorical criteria

Cells show present / known; unknown evidence is excluded from the known denominator.

| Arm | profile_returned | professional_contact_returned | critical_safety_finding | readable_material_support_defect | own_citation_support_defect | identity_attachment_defect | inappropriate_withholding | lower_tier_source_selected | citation_span_or_contract_defect |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BASELINE | 7/7 | 5/7 | 0/7 | 0/7 | 0/2 | 0/7 | 4/7 | 6/7 | 7/7 |
| CITATION_PRIVACY | 7/7 | 5/7 | 0/7 | 0/7 | 0/2 | 0/7 | 4/7 | 6/7 | 6/7 |

## Frozen development-protocol endpoints

Each row is a distinct preregistered endpoint, not a component of a score. The automatic and manual strata are reported independently; `all_adjudicated_secondary` is labeled secondary.

| Stratum | Candidate | Endpoint | Difference | Lower 95% | Gate |
| --- | --- | --- | ---: | ---: | --- |
| automatic | CITATION_PRIVACY | eligible_contact_survival | 0 | -0.1132075471698113 | fail |
| automatic | CITATION_PRIVACY | whole_packet_exact_material_support | 0.03386591010900408 | -0.0008008342567165066 | pass |
| automatic | CITATION_PRIVACY | readable_own_citation_exact_support | -0.0017226528854434875 | -0.04166666666666663 | pass |
| automatic | CITATION_PRIVACY | exact_provider_identity_attachment | 0.005763774824548262 | -0.011494252873563204 | pass |
| manual | CITATION_PRIVACY | eligible_contact_survival | 0 | 0 | pass |
| manual | CITATION_PRIVACY | whole_packet_exact_material_support | 0 | 0 | pass |
| manual | CITATION_PRIVACY | readable_own_citation_exact_support | 0 | 0 | pass |
| manual | CITATION_PRIVACY | exact_provider_identity_attachment | 0 | 0 | pass |
| all_adjudicated_secondary | CITATION_PRIVACY | eligible_contact_survival | 0 | -0.09999999999999998 | fail |
| all_adjudicated_secondary | CITATION_PRIVACY | whole_packet_exact_material_support | 0.029697315819531722 | -0.0007779444033153693 | pass |
| all_adjudicated_secondary | CITATION_PRIVACY | readable_own_citation_exact_support | -0.001815980629539915 | -0.03896627565982406 | pass |
| all_adjudicated_secondary | CITATION_PRIVACY | exact_provider_identity_attachment | 0.004997144488863459 | -0.01034981780730675 | pass |

## Operations

| Arm | Production cost | Median production latency (ms) | Evaluator API cost |
| --- | ---: | ---: | ---: |
| BASELINE | $6.286149 | 12332.5 | $144.268954 |
| CITATION_PRIVACY | $6.172005 | 11302.5 | $153.169787 |

Costs with missing usage remain explicitly incomplete: known amounts are never presented as complete totals. Evaluator API cost includes atomic and synthesis calls and is never combined with production cost. Manual-review cost is unavailable unless separately captured; manual duration is reported in summary.json.

## Paired censoring

| Case | Disposition | Reason |
| --- | --- | --- |

All arm-pair, criterion-specific provider bootstrap differences are in `raw-paired-bootstrap.tsv`. Positive values mean the left arm has a higher event rate; the TSV declares whether higher or lower is favorable for each criterion.

# Development-to-holdout comparison

## Scope and comparability

This is a read-only comparison of the latest fixed-evaluator results for the 60-provider development battery and the distinct 60-provider holdout battery. Both splits compare the same production baseline with the same shorter candidate prompt and use evaluator-authority SHA `4a442fcdff5390350a49a8468acfb45ffbc1cd56332cde334e7aedc31950b00e`.

Each split contains 60 providers per arm, 120 successful production responses, and no censored or error rows. The adjudication strata differ: development has 53 automatic and 7 manual cases, while holdout has 50 automatic and 10 manual cases. Automatic and manual strata therefore are not directly comparable across splits; all quality comparisons below use all adjudicated cases and retain criterion-specific known denominators.

The candidate reduces the static prompt from 18,487 to 18,143 bytes: 344 bytes, or 1.8608%. This percentage applies only to these two immediate arms.

## Candidate performance across splits

Defect criteria are lower-is-better. Differences are holdout minus development. Rates with denominators below 60 are conditional on readable or otherwise known evidence, not full-battery failure rates.

| Criterion | Development | Holdout | Difference | Fisher exact p |
|---|---:|---:|---:|---:|
| Profile returned | 60/60 (100.0%) | 60/60 (100.0%) | 0.0 pp | 1.000 |
| Professional contact | 52/60 (86.7%) | 54/60 (90.0%) | +3.3 pp | 0.777 |
| Critical safety finding | 3/60 (5.0%) | 6/60 (10.0%) | +5.0 pp worse | 0.491 |
| Readable material-support defect | 5/60 (8.3%) | 10/59 (16.9%) | +8.6 pp worse | 0.178 |
| Own-citation support defect | 2/24 (8.3%) | 6/24 (25.0%) | +16.7 pp worse | 0.245 |
| Identity-attachment defect | 2/60 (3.3%) | 7/59 (11.9%) | +8.5 pp worse | 0.095 |
| Inappropriate withholding | 22/56 (39.3%) | 14/52 (26.9%) | -12.4 pp better | 0.221 |
| Lower-tier source selected | 13/51 (25.5%) | 9/49 (18.4%) | -7.1 pp better | 0.472 |
| Citation span/contract defect | 40/60 (66.7%) | 42/58 (72.4%) | +5.7 pp worse | 0.552 |

None of these development-to-holdout differences is statistically established at alpha 0.05. After Holm correction across the nine criteria, none is significant; the smallest adjusted p-value is approximately 0.852. The directional picture is mixed: the holdout has more observed safety, support, identity, and citation-contract defects, but less inappropriate withholding and fewer lower-tier source selections.

## Does the candidate's treatment effect transport?

The table compares the paired candidate-minus-baseline effect in each split. Negative values are favorable for defect criteria. Cross-split p-values come from 50,000-label permutation tests.

| Criterion | Development effect | Holdout effect | Holdout - development | Permutation p |
|---|---:|---:|---:|---:|
| Profile returned | 0.0 pp | 0.0 pp | 0.0 pp | 1.000 |
| Professional contact | -1.7 pp | +3.3 pp | +5.0 pp | 0.629 |
| Critical safety finding | -11.7 pp | -1.7 pp | +10.0 pp | 0.138 |
| Readable material-support defect | -10.0 pp | 0.0 pp | +10.0 pp | 0.208 |
| Own-citation support defect | -6.3 pp | +5.9 pp | +12.1 pp | 0.516 |
| Identity-attachment defect | -3.3 pp | +1.8 pp | +5.1 pp | 0.453 |
| Inappropriate withholding | +6.3 pp | -2.1 pp | -8.4 pp | 0.572 |
| Lower-tier source selected | -2.3 pp | -6.8 pp | -4.5 pp | 0.824 |
| Citation span/contract defect | -10.0 pp | -3.4 pp | +6.6 pp | 0.476 |

No cross-split treatment-effect shift is statistically established; all Holm-adjusted p-values are 1. Fully observed paired denominators are 60 development and 60 holdout cases for profile, contact, and safety. The paired known denominators for support, own-citation, identity, withholding, source tier, and citation contract are respectively 60/57, 16/17, 60/57, 48/47, 44/44, and 60/58 for development/holdout. Those effects are therefore conditional on comparable known pairs rather than the full batteries.

## Frozen all-adjudicated endpoints

These are candidate-minus-baseline effects. They are descriptive cross-split checks; the existing within-split bootstrap intervals overlap, but interval overlap is not a direct significance test of the cross-split difference.

| Endpoint | Development | Holdout |
|---|---:|---:|
| Eligible-contact survival | 0.00000 | +0.05000 |
| Whole-packet exact support | +0.02970 | +0.00113 |
| Readable own-citation exact support | -0.00182 | -0.01115 |
| Exact identity attachment | +0.00500 | -0.01080 |

## Production operations

All totals cover 60 complete attempts per arm with no missing usage or unknown cost.

| Split | Metric | Baseline | Candidate | Candidate - baseline |
|---|---|---:|---:|---:|
| Development | Estimated Azure cost | $6.286149 | $6.172005 | -$0.114144 (-1.82%) |
| Development | Mean latency | 12,928.1 ms | 12,624.2 ms | -303.9 ms |
| Development | Median latency | 12,332.5 ms | 11,302.5 ms | -1,030.0 ms |
| Development | Searches | 194 | 184 | -10 (-5.15%) |
| Holdout | Estimated Azure cost | $6.333971 | $6.128398 | -$0.205573 (-3.25%) |
| Holdout | Mean latency | 13,332.9 ms | 12,205.4 ms | -1,127.5 ms |
| Holdout | Median latency | 11,510.5 ms | 11,157.0 ms | -353.5 ms |
| Holdout | Searches | 198 | 190 | -8 (-4.04%) |

Paired case-level estimates and 95% bootstrap intervals show the same directional reductions, but none is statistically established within either split:

| Metric | Development mean delta (95% CI) | Holdout mean delta (95% CI) | Cross-split shift (95% CI), p |
|---|---:|---:|---:|
| Cost per case | -$0.001902 (-$0.008879, +$0.004788) | -$0.003426 (-$0.010186, +$0.003296) | -$0.001524 (-$0.010930, +$0.008011), p=0.757 |
| Latency per case | -304 ms (-1,864, +1,352) | -1,127 ms (-3,192, +650) | -824 ms (-3,449, +1,608), p=0.534 |
| Searches per case | -0.167 (-0.383, +0.033) | -0.133 (-0.367, +0.100) | +0.033 (-0.267, +0.350), p=0.916 |

The cost, search, and latency reductions transport directionally to the holdout. The uncertainty intervals include zero, so neither the within-split paired reductions nor their cross-split shifts are statistically established.

## Conclusion

There is no statistically established development-to-holdout regression at alpha 0.05 under the fixed evaluator. The holdout does expose directionally worse safety and evidentiary outcomes, especially identity attachment and citation support, so those cases remain important for qualitative failure analysis. At the same time, the candidate returns every profile on both batteries, improves contact availability on holdout, withholds less, selects fewer lower-tier sources, and retains modest directional production-efficiency gains. The honest conclusion is mixed transport with limited power, not equivalence or proof of no regression.

## Authoritative artifacts

- Development evaluator: `/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-development-full-v1-analysis-sol-high-v1/`
- Development production summary: `/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-development-full-v1-production/summary.json`
- Holdout evaluator: `/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-analysis-sol-high-compile-erratum-v1/`
- Holdout production summary: `/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-production/summary.json`

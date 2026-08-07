# CMS provider-profile report consistency audit

Audit date: 2026-08-07 (America/New_York)

Status: **publication-blocking inconsistencies found**. This is a read-only audit. The three CMS-facing documents were not edited.

## Authoritative inputs reviewed

1. `API-AI-Websearch/eval/CMS_PROVIDER_AI_RESPONSE.md`
2. `API-AI-Websearch/eval/CMS_PROVIDER_AI_VALIDATION_REPORT.md`
3. `API-AI-Websearch/eval/README.md`
4. `test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-analysis-sol-high-compile-erratum-v1/REPORT.md`
5. Supporting immutable artifacts used to resolve details that the compiled report summarizes:
   - production summary: `test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-production/summary.json`
   - evaluator summary: `test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-analysis-sol-high-compile-erratum-v1/summary.json`
   - exact evaluated request: `test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-production/cells/CITATION_PRIVACY/H001/artifact.json`
   - treatment worktree: `tmp/citation-metadata-privacy-v1`

The latest experiment is not the single-arm holdout described in the three outward-facing documents. It is a paired 60-provider-per-arm sealed-holdout comparison of:

- **Item-local citation baseline** (internal arm `BASELINE`), commit `bfea3e63ad9d907af09b92e7b35d7e40c14d7c28`.
- **Hostname-derived citation metadata** (internal arm `CITATION_PRIVACY`), commit `8cb1bd884493b5c63affcfc8811707b7fb9e6ef8`.

For outward-facing prose, use the descriptive names above. Reserve arm IDs, campaign names, commits, hashes, and compiler terminology for a technical reproducibility appendix.

## Executive finding

The CMS response, validation report, and README are internally consistent with one another, but they consistently describe the older August 1–2 single-arm, long-prompt holdout. They are not consistent with the August 7 paired citation-metadata holdout.

They therefore must not be published as the report of the latest experiment. In particular, the latest comparison does **not** establish the hostname-derived treatment as a statistically validated winner: its formal eligible-contact-survival noninferiority gate failed in the automatic, manual, and secondary combined strata, even though its point estimates were neutral or favorable. The latest automatic stratum also contains candidate-specific safety-gate failures that require trace-level adjudication before any latest-campaign claim of “zero confirmed major safety violations.”

## Blocking inconsistencies by document

### `CMS_PROVIDER_AI_RESPONSE.md`

| Location | Current statement | Why it is stale or incorrect for the latest holdout | Required correction |
| --- | --- | --- | --- |
| lines 3–14 | Describes one selected configuration, exactly 40 variants, and a single frozen 60-provider holdout. | The latest study is a paired two-arm holdout. The exact count of 40 predates later August 6–7 treatments. | Describe the paired comparison. Recount unique production-shaped variants, or say “more than 40.” Do not call either latest arm selected solely from this holdout. |
| lines 20–24 | Reports zero confirmed major safety violations among 59 evaluable cases, one overflow, 206/218 exact claims, and 60/60 profiles for the selected arm. | These are older single-arm results. The latest campaign has 50 automatic plus 10 blinded-manual providers per arm, zero censored, and different categorical results. | Replace with the latest arm-by-arm automatic and manual results. Keep critical model flags distinct from confirmed violations and adjudicate the latest flags before making a confirmed-safety claim. |
| lines 31–59 | Gives the older winner-selection narrative. | The latest treatment changes prompt, strict model schema, and sanitizer behavior; it was not merely the older final prompt comparator. Its formal contact-survival gate failed. | Explain the latest treatment and its gate results. If it is adopted for policy reasons, label that a policy/defense-in-depth decision rather than an empirical superiority finding. |
| lines 132–166 | Gives old production and evaluator counts: 148 searches, 61 sends, `$5.028516`, 59 judge calls plus one overflow, `$44.153370`. | Latest arm totals are different, and there was no censored/overflow provider in the latest compiled campaign. | Replace with the paired-arm metrics below; never combine production and evaluation costs. |
| lines 174–207 | Compares the old development battery with the old disjoint holdout and says no prompt was retuned after opening it. | This is not the comparison compiled in the latest report. The latest report compares two arms on the sealed holdout. | Either retain this section clearly labeled “historical prior validation,” or replace it with an accurate latest-study interpretation. Do not portray a treatment chosen from the latest holdout as prospectively frozen before that same holdout. |
| lines 249–259 | Appendix A claims to quote the literal prompt and explicitly preserves internal `D34` headings. | This is the obsolete historical 86k-era prompt, not the prompt sent by the latest treatment. Internal candidate labels are not CMS-facing language. | Replace the appendix wholesale from the recorded latest request body; do not edit labels inside the old quotation. |
| lines 278 onward, including 325–346 and repeated definitions through 796 | Appendix B includes model-emitted nullable `sourceTitle`. | The latest strict model schema removes `sourceTitle`. The public response may still contain it, but host code derives it from the citation URL hostname. | Replace Appendix B wholesale with the exact recorded `text.format` envelope. Explain public host-derived `sourceTitle` separately. |

### `CMS_PROVIDER_AI_VALIDATION_REPORT.md`

| Location | Current statement | Why it is stale or incorrect for the latest holdout | Required correction |
| --- | --- | --- | --- |
| lines 3–18 | August 1 status, ship decision, 59 evaluable cases, one evaluator overflow, exactly 40 variants. | Latest paired holdout completed August 7 with 60 providers per arm, split 50 automatic/10 manual, zero censored. The latest candidate failed the eligible-contact gate. | Update date, study identity, denominators, and selection status. Use “more than 40” unless a fresh manifest recount supports an exact number. |
| lines 40–58 | Says the shipped model emits nullable `sourceTitle`. | The latest treatment removes `sourceTitle` from the model schema. | State that the model emits `sourceUrl`, `providerIdentitySpan`, `factSpan`, and nullable `explicitFactDateSpan`; host code derives outward title metadata from the hostname. |
| lines 128–165 | Older candidate funnel and final-comparator result. | Does not describe the citation-metadata privacy treatment or latest formal gates. | Add the exact treatment diff and latest paired protocol. |
| lines 188–201 | Describes a single selected arm, one judge call per case, and an overflow-prone direct-input evaluator. | Latest evaluation used automatic atomic/synthesis calls plus blinded manual exceptions, kept strata separate, and had zero censored providers. | Describe 50 automatic and 10 manual providers per arm, one fixed Sol/high categorical authority, identical rubric/schema/fetch protocol, and no aggregate score. |
| lines 203–224 | Old single-arm output, search, send, and cost inputs. | Not latest. | Replace with paired metrics. |
| lines 242–319 | Old 218-claim evidence table, one context overflow, 206 exact whole-packet claims, 92 unreadable own citations, and post-hoc adverse-case audit. | Not the latest categorical output. The latest compiler reports provider-level criteria with separate known denominators and separate automatic/manual strata. | Replace with the latest criteria table; do not translate unknown evidence into success or failure. Trace-adjudicate the 7/50 versus 6/50 automatic critical flags before using “confirmed” safety wording. |
| lines 321–358 | Old development-to-holdout regression table. | It does not compare the latest two arms and cannot validate the latest treatment. | Clearly label as historical, or remove from the current-results section. |
| lines 360–401 | Old production cost/latency and evaluator cost. | Not latest. | Replace with the paired operational table below. State manual-review cost is unavailable. |
| lines 470–520 | CMS-facing conclusions reuse the old 59-case safety and 206/218 support claims. | Not latest. | Rewrite only after latest trace adjudication and an honest selection decision. |

### `README.md`

| Location | Current statement | Why it is stale or incorrect for the latest holdout | Required correction |
| --- | --- | --- | --- |
| lines 20–30 | Exactly 40 variants, one frozen configuration, 60/60 profiles, 59 evaluable cases, and one overflow. | Summarizes the older study, not the latest paired holdout. | Update to the paired study and current publication status. Avoid “current authoritative” language until the CMS documents are reconciled. |
| lines 32–36 | Says evaluation uses one fixed Sol/high judge over returned pages. | Directionally correct but incomplete for the latest evaluator. | Add separate 50 automatic/10 manual strata per arm and zero censored; preserve the statement that production has no host fetch. |
| lines 38–42 | Clarifies `lineOfCoverage: "Medical"`. | This remains correct and useful. | Retain: it is an insurance-product workflow value, not an entity-type filter, and facilities remain supported. |

## Latest paired-holdout facts that should replace old results

### Frozen production protocol

- 60 identical holdout provider requests per arm, with each arm run independently and retaining its own returned webpages.
- `gpt-5.6-terra`, reasoning `low`.
- Azure OpenAI Responses API with required native `web_search`, maximum eight tool calls.
- OpenAI SDK 5.23.2.
- Strict SDK-native structured output.
- 60 HTTP sends per arm; no missing usage and complete production-cost totals.
- No production host webpage fetch. Deterministic page fetching is evaluation-only.
- Plan/network information is absent from the model prompt and schema. CMS and plan-directory APIs remain authoritative for participation.

### Treatment difference

The hostname-derived citation-metadata arm differs from the item-local baseline in three material ways:

1. The prompt adds: `Prohibited contact data must not appear anywhere in the returned profile, including citation fields.`
2. The strict model schema removes model-emitted `sourceTitle`.
3. The sanitizer preserves the public `sourceTitle` field by deriving it from the validated citation URL hostname instead of relaying model-controlled page-title metadata.

This is a complete production-shaped treatment, not a prompt-only arm. The reports must say so.

### Prompt/schema size

| Arm | Static bytes | Difference |
| --- | ---: | ---: |
| Item-local citation baseline | 18,487 | reference |
| Hostname-derived citation metadata | 18,143 | 1.9% smaller |

The 1.9% reduction is relative to the latest item-local citation baseline. It must not be described as the reduction from the historical approximately 86k prompt.

### Categorical results — automatic stratum

Cells are finding present / known denominator. Unknown evidence is excluded from known denominators.

| Criterion | Item-local citation baseline | Hostname-derived citation metadata |
| --- | ---: | ---: |
| Profile returned | 50/50 | 50/50 |
| Professional contact returned | 43/50 | 45/50 |
| Critical safety finding | 7/50 | 6/50 |
| Readable material-support defect | 10/50 | 10/50 |
| Own-citation support defect | 4/20 | 6/20 |
| Identity-attachment defect | 6/50 | 7/50 |
| Inappropriate withholding | 12/42 | 11/43 |
| Lower-tier source selected | 8/41 | 9/41 |
| Citation span/contract defect | 38/50 | 38/50 |

### Categorical results — blinded manual stratum

| Criterion | Item-local citation baseline | Hostname-derived citation metadata |
| --- | ---: | ---: |
| Profile returned | 10/10 | 10/10 |
| Professional contact returned | 9/10 | 9/10 |
| Critical safety finding | 0/10 | 0/10 |
| Readable material-support defect | 0/7 | 0/9 |
| Own-citation support defect | 0/2 | 0/4 |
| Identity-attachment defect | 0/7 | 0/9 |
| Inappropriate withholding | 4/9 | 3/9 |
| Lower-tier source selected | 2/9 | 0/8 |
| Citation span/contract defect | 6/9 | 4/8 |

Ten providers per arm required blinded manual review under the same categorical rubric. Automatic and manual strata must remain separate in the primary report. Any combined “all adjudicated” result is secondary.

### Formal noninferiority endpoints

| Stratum | Endpoint | Candidate minus baseline | Lower 95% bound | Result |
| --- | --- | ---: | ---: | --- |
| Automatic | Eligible-contact survival | +0.0600 | -0.0800 | **Fail** |
| Automatic | Whole-packet exact material support | +0.0030 | -0.0382 | Pass |
| Automatic | Readable own-citation exact support | -0.0120 | -0.0341 | Pass |
| Automatic | Exact provider identity attachment | -0.0117 | -0.0456 | Pass |
| Manual | Eligible-contact survival | 0.0000 | -0.3000 | **Fail** |
| Manual | Whole-packet exact material support | 0.0000 | 0.0000 | Pass |
| Manual | Readable own-citation exact support | 0.0000 | 0.0000 | Pass |
| Manual | Exact provider identity attachment | 0.0000 | 0.0000 | Pass |
| Secondary combined | Eligible-contact survival | +0.0500 | -0.0667 | **Fail** |

The three support/identity endpoints passed, but the eligible-contact endpoint did not. The point estimate does not override the prespecified confidence-bound gate.

The evaluator summary also marks the automatic candidate safety gate as failed because it found new candidate-specific wrong-provider, unsupported-material, contradicted, and cross-NPI claims. Those categorical findings are not automatically equivalent to manually confirmed major violations, but they cannot be omitted from a selection claim. They require trace-level adjudication under the fixed rubric, with dispositions reported additively rather than mutating sealed results.

### Production cost and latency

| Metric | Item-local citation baseline | Hostname-derived citation metadata |
| --- | ---: | ---: |
| Total production cost | `$6.3339705` | `$6.128398` |
| Mean cost/request | `$0.105566175` | `$0.102139967` |
| Median cost/request | `$0.10084825` | `$0.10125625` |
| p95 cost/request | `$0.138502` | `$0.140109125` |
| Mean latency | `13.333 s` | `12.205 s` |
| Median latency | `11.511 s` | `11.157 s` |
| p95 latency | `20.432 s` | `19.550 s` |
| Maximum latency | `53.801 s` | `25.677 s` |
| Web-search calls | 198 | 190 |
| HTTP sends | 60 | 60 |

### Evaluation cost

| Arm | Evaluator API cost |
| --- | ---: |
| Item-local citation baseline | `$135.425762` |
| Hostname-derived citation metadata | `$144.604331` |

Production and evaluator costs must remain separate. Manual-review cost is unavailable/not reported and must not be silently treated as zero.

## Required disclosures missing from the current CMS account

The revised reports should explicitly disclose all of the following:

1. The latest holdout compared two complete production-shaped arms independently. Each arm searched independently and kept its own returned webpages; there was no union source packet.
2. The treatment protects citation metadata as well as displayed values: it prohibits private contact data anywhere in the profile, removes model-controlled page titles from the strict schema, and derives outward title metadata from the URL hostname.
3. Production performs no host webpage fetch. Evaluator-only deterministic fetching is separate and does not alter production output.
4. The evaluator was fixed at `gpt-5.6-sol`, reasoning `high`, with an identical categorical rubric, structured-output schema, scoring code, and fetch protocol for both arms. Host code did not create an aggregate score.
5. Ten providers per arm used blinded manual review. Automatic and manual strata are primary and separate; combined rows are secondary only.
6. There were zero censored providers in this campaign. Content-filter exhaustion should nevertheless remain defined as operational censoring in the protocol, not a quality failure attributed to an arm.
7. Critical categorical flags are not synonymous with manually confirmed major safety violations. The latest 7/50 versus 6/50 automatic flags and candidate-specific safety-gate failures need trace-level adjudication before a “zero confirmed” claim.
8. The formal eligible-contact-survival gate failed in every reported stratum. This prevents describing the treatment as a statistically validated winner.
9. Unknown or unreadable evidence remains outside known denominators and is neither success nor failure.
10. Production cost, evaluator API cost, and unavailable manual-review cost are separate quantities.
11. The prompt/schema reduction is 1.9% versus the latest item-local baseline, not versus the historical 86k prompt.
12. `lineOfCoverage: "Medical"` is an insurance-product workflow value, not an entity-type filter. NPI Type 1 practitioners and NPI Type 2 groups, clinics, hospitals, and facilities remain supported.
13. Plan, network, coverage, enrollment, and participation information is excluded from the model prompt/schema. CMS and plan-directory APIs exclusively determine network status.
14. Ratings remain excluded from the model output.
15. Recency is fact-specific; missing recency is neutral. Do not reuse the older “zero qualifying dates” result as if it came from this paired campaign unless the latest evaluator artifacts independently report it.
16. If a production choice is made after reviewing this holdout, say so. Do not claim that choice was frozen before the same holdout was opened, and do not imply that the holdout remains an untouched confirmatory validation of that choice.

## Exact appendix replacement sources

The current Appendices A and B should be replaced, not patched in place.

Use the recorded request artifact:

`test-evidence/provider-prompt-minimization-2026-08-02/runs/citation-metadata-privacy-holdout-full-v1-production/cells/CITATION_PRIVACY/H001/artifact.json`

- Literal production system instructions: `.sends[0].request.body.instructions`
- Exact strict JSON Schema envelope: `.sends[0].request.body.text.format`
- Runtime confirmation: `.sends[0].request.body.model`, `.reasoning`, `.tools`, and `.max_tool_calls`

The recorded format is `type: "json_schema"`, `strict: true`, and does not ask the model to emit `sourceTitle`. The artifact's provider-specific dynamic input should not be copied into a public appendix. If the user-message shape is useful, publish a neutral template separately with placeholders.

For public API documentation, explain this post-parse transformation outside the literal model schema:

`public sourceTitle = validated hostname(sourceUrl)`

Do not describe the hostname as a model-emitted page title or as semantic evidence about the source.

## Recommended publication order and selection status

1. **Do not publish the current CMS response or validation report as latest results.** Mark them historical internally until reconciled.
2. Adjudicate the latest automatic critical/safety findings from both arms, preserving sealed results and adding trace dispositions.
3. Decide whether the hostname-derived treatment is adopted as a narrow privacy defense despite its failed contact-survival noninferiority gate. If adopted, say the empirical support/identity endpoints passed while the contact-survival gate did not; do not call it statistically superior or fully noninferior.
4. Rewrite the validation report first, using descriptive arm names and separate automatic/manual tables.
5. Replace the literal prompt/schema appendices from the immutable request artifact.
6. Derive the shorter CMS response from the corrected validation report.
7. Update the README last so it points to genuinely current authoritative documents.

The latest paired holdout supports a narrow conclusion: hostname-derived citation metadata reduces exposure to model-controlled citation titles without an observed loss in the point estimate for eligible-contact return, and the three support/identity noninferiority endpoints passed. It does **not** support an unconditional “winner” claim because the formal contact-survival gate failed and automatic safety findings still require adjudication.

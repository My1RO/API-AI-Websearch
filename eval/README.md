# Provider profile accuracy evaluation

This evaluation exercises the provider-profile API that is already deployed behind `--api-base`. It has no model selector and must not change `AI_MODEL` or call an AI client directly.

## Cohorts

No real provider cohort has been obtained or run yet. The committed example is deliberately synthetic; the cohort sizes below are proposed study-design targets, not a description of existing data.

1. Export candidates from the existing plan provider-search flow. Preserve only provider ID/NPI, name, specialty/taxonomy, and business location; do not include consumer, quote, application, or member data.
2. Use a pilot only to calibrate the workflow and estimate variance/paired disagreement. Then calculate and freeze a separately powered certification cohort. Stratify by individual/facility, region, urban/rural, specialty group, multi-location, common-name ambiguity, recent changes, sparse web presence, known source conflicts, and public rating-directory presence. The earlier 60/400 counts are planning examples, not statistically justified commitments.
3. Assign random case IDs. Store the locked cohort and evidence only under `eval-private/`, which Git ignores.

## Independent truth collection

- Two reviewers independently collect timestamped evidence. The reviewer view must not include the AI result.
- Identity and the paired government baseline use the existing provider-search response plus NPPES/CMS evidence.
- Phone, address, and official website truth requires the provider, practice, facility, or health-system site. An approved professional directory may corroborate but must not convert a residential address or personal mobile number into a display-safe fact.
- A public rating is valid only for the exact provider profile on the cited public rating directory, with score, scale, review count when available, and capture time. No directory receives special status, and ratings must not be transferred between sites.
- Use one or more evaluation LLMs configured with materially higher reasoning effort than production to assess whether each candidate fact is supported, current, professionally appropriate, and matched to the correct provider. Give the judges the candidate fact and evidence from all available source classes; do not declare a government/directory source correct merely because another source differs from it.
- Calibrate LLM judges on a human-reviewed pilot, require structured rationales and source-by-source assessments, measure inter-judge agreement, and send judge disagreements or low-confidence cases to human adjudication. The production model must never judge its own output.
- Record only provider-level evidence. No member, consumer, quote, application, policy, or session data belongs in the evaluation. If the test deliberately includes a known personal provider contact as a leakage sentinel, the current harness can retain only its HMAC rather than copying that contact into fixtures; this is defense in depth for provider personal data, not protection of member data.
- Web search may locate candidate evidence, but the web-search system under test cannot certify its own answer.

## Runs and metrics

The current harness is a scaffold. It validates/runs cases and calculates basic field scores, citation presence, repeatability, and CMS-address disagreement, but it does not yet collect independent web evidence, run LLM judges or human adjudication, compare government phone/site/rating truth, import request cost/search-call telemetry, apply population weights, or perform provider-clustered inference. The rest of this section is the target certification analysis to implement before a CMS-grade run.

Run every locked case three times through the current environment. Treat the provider, not each repeat, as the independent sampling unit; use repeats to estimate nondeterminism and analyze accuracy with provider-clustered or provider-aggregated methods. Score field coverage, emitted precision, gold recall, end-to-end top-one accuracy (missing is incorrect), citation presence, wrong-provider rate, CMS-address agreement/conflict, latency, failure rate, unsafe-personal disclosure, and repeat Jaccard/top-one agreement. Report Wilson 95% intervals for simple provider-level proportions and a paired interval/test (for example, McNemar-based analysis) for AI-versus-directory comparisons. Report weighted overall and stratum results, correct for multiple field/stratum comparisons, and perform the final sample-size calculation from preregistered margins/effects plus pilot-estimated prevalence, paired discordance, clustering, and expected exclusions.

`cmsAddressConflict` is an offline evaluation flag only. It records whether the first returned AI address differs from the locked plan-directory/CMS baseline so later analysis can quantify the issue. It does not suppress, replace, reorder, or otherwise change runtime AI output. Any production reconciliation behavior requires separate product, compliance, and CMS approval.

A conflict flag is not a correctness verdict. The directory value, AI value, both values, or neither value may be current. Accuracy scoring must consider the underlying evidence, recency, source independence, and the higher-reasoning judge/human adjudication result.

Citation presence means that a displayed fact points to a source object with a citation-backed URL. It does **not** prove that the cited page supports that specific field; field support remains a human-adjudicated certification measure.

Release thresholds must be approved before looking at certification results. Personal-contact leakage and wrong-provider critical errors should have a zero-tolerance release gate. Accuracy thresholds for each field, required coverage, acceptable failure/latency, and conflict behavior require product, compliance, and CMS approval.

## Commands

```sh
npm run eval:provider -- validate --cases eval-private/locked-cases.jsonl

PROVIDER_EVAL_LIVE=true \
PROVIDER_EVAL_HMAC_KEY='managed-secret' \
npm run eval:provider -- run \
  --api-base http://api-ai-websearch:3065/v1/ai \
  --cases eval-private/locked-cases.jsonl \
  --repeats 3 \
  --out eval-private/runs

find eval-private/runs -name '*.json' -print | sort > eval-private/observation-manifest.txt

PROVIDER_EVAL_HMAC_KEY='managed-secret' \
npm run eval:provider -- score \
  --cases eval-private/locked-cases.jsonl \
  --observations eval-private/observation-manifest.txt \
  --out eval-results/certification
```

For a direct API-AI run, set `PROVIDER_EVAL_SUBDOMAIN`; the runner sends it as `Lifecycle-Subdomain` and sends no user identifier. For a Public-API run, set `PROVIDER_EVAL_AUTHORIZATION` and `PROVIDER_EVAL_ORIGIN`; Public-API authenticates the request, derives the coarse user class from OAuth, and derives the current tenancy subdomain from Origin. Keep secrets and evidence outside committed artifacts. The production organization-to-user binding and approved evaluation service identity still require an explicit security review.

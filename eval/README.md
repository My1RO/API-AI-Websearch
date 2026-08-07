# Provider-profile evaluation

This directory contains exactly two outward-facing CMS documents for the
shipped one-call provider web-search configuration. The remaining files and
subdirectories are internal navigation, synthetic examples, or evidence.

## Current documents

- [CMS_PROVIDER_AI_RESPONSE.md](CMS_PROVIDER_AI_RESPONSE.md): concise,
  standalone answers to CMS and headline results.
- [CMS_PROVIDER_AI_APPENDIX.md](CMS_PROVIDER_AI_APPENDIX.md): detailed results,
  methodology, assessment of potential-safety screening flags, cost, latency,
  API reproductions, limitations, and the literal production prompt and schema.
- [provider-profile-cases.example.jsonl](provider-profile-cases.example.jsonl):
  synthetic request-shape example only; it is not the sealed battery.
- [runner](runner/README.md): complete fixed evaluator, production campaign
  runner, tests, fixtures, final protocols, and authority-bound dependencies.

## Shipped configuration

The shipped semantic configuration is source commit
`8cb1bd884493b5c63affcfc8811707b7fb9e6ef8`. It uses Azure OpenAI Responses,
`gpt-5.6-terra` with reasoning `low`, required native web search, one semantic
LLM call, and strict SDK-native Zod Structured Outputs.

The model emits direct per-fact citations but no model-controlled source title.
The outward source label is derived from the validated citation URL hostname,
and prohibited contact data are forbidden everywhere in the returned profile,
including citation quotations.

The static contract is 18,143 bytes: 79.1% shorter than the original
86,769-byte legacy contract and 1.9% shorter than its immediate predecessor.

The disjoint holdout completed 120/120 production responses and evaluated all
60 provider pairs: 50 in the automatic stratum and 10 in blinded manual review,
with no censoring. The shipped configuration returned an eligible professional
contact for 51/60 providers versus 48/60 for its immediate predecessor. It met fixed
noninferiority gates for material support, readable own-citation support, and
identity attachment; the contact-survival confidence bound missed the -5%
margin despite the observed improvement. Broad potential-safety screening
flags triggered detailed review; none was substantiated as a fax,
personal/mobile phone, residential address, prohibited-source disclosure, or
contact belonging exclusively to the wrong provider.

`lineOfCoverage: "Medical"` remains in the public request solely as the plan
product-line discriminator. It is not sent to the model, does not identify the
provider entity type, and does not restrict facility support. CMS and plan
directory APIs remain exclusively authoritative for network participation.

## Local service reproduction

Install and run with the repository's pinned Node environment:

```sh
npm ci
npm run build
npm test -- --runInBand
npm start
```

The service requires its normal Redis and Azure configuration. Use approved
secret injection; do not commit credentials or production payloads.

## Historical evidence

Internal pilot labels, frozen case identifiers, raw Azure responses, webpage
snapshots, evaluator requests/responses, and sealed mappings remain in the
controlled experiment evidence package. Outward-facing documents use
descriptive configuration names and preserve only the metrics needed to audit
the decision. Historical reports should not be treated as current when they
refer to the rejected 11,196-byte candidate, the original 86,769-byte contract,
an evaluator overflow, or a 59-provider denominator; the final evaluation has
60 fully adjudicated provider pairs and no censoring.

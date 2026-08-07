# CMS response: AI web-search provider profiles

Status date: August 7, 2026

Lucie recommends the shipped one-call provider web-search configuration described
below. It was selected after approximately 40 production-shaped configurations
received live pilot testing, four advanced to complete 60-provider development
evaluations, and the shipped configuration was compared with its immediate
predecessor on a separate 60-provider holdout.

The principal safety result is straightforward: **detailed review found zero
confirmed safety violations in the holdout output from the shipped
configuration.** The automated evaluator initially generated potential-safety
screening flags, but those flags were not confirmed errors. Review of every
flag found no fax, personal or mobile phone, residential address, prohibited
contact disclosure, or contact belonging exclusively to the wrong provider.

Full results, methodology, the screening-flag assessment, cost and latency,
API reproductions, and the literal production prompt and schema appear once in
the [detailed appendix](CMS_PROVIDER_AI_APPENDIX.md).

## Responses to CMS

| Original CMS question | Lucie response |
| --- | --- |
| **Will there be guardrails to prevent the disclosure and display of the provider's personal information (e.g., to prevent the provider's personal cell phone number or address from being displayed)?** | Yes. The model may return only public professional contacts for the exact provider. It must omit fax, mobile/cell, personal/home, residential, people-search, and uncertain-purpose contact data from every outward field, including citations. Each returned fact must identify the provider and the fact on its own cited page. The shipped configuration also removes model-generated page titles and derives the displayed source label from the validated URL hostname. In the holdout audit, zero safety violations were confirmed. A safety violation was defined as outward disclosure of a prohibited personal/residential contact, contact belonging exclusively to another provider or incompatible operation, or prohibited contact text leaking through citation metadata. This result applies to the tested cohort and is not a guarantee that future errors are impossible. |
| **When there are conflicts between HealthCare.gov API data and OpenAI indexed data, how would they be addressed?** | CMS and plan-directory APIs remain exclusively authoritative for network participation. Plan and network information is not sent to the AI model and AI contact data cannot override coverage. For contact facts, NPI and name are the primary identity keys; requested specialty and location are treated as possibly stale cross-checks. Lucie resolves conflicts field by field using exact-provider evidence rather than assuming that either the web or an API value is current merely because they agree. |
| **If conflicting information is displayed, how should the consumer or agent/broker reconcile those conflicts?** | Lucie owns the investigation and correction workflow. Unresolved identity or contact-safety conflicts are omitted rather than delegated to the consumer. The interface identifies AI contact information as supplemental, preserves CMS/issuer authority for network status, displays source links, and accepts structured correctness feedback. A conflict in one field does not suppress unrelated supported facts. Consumers and agents should confirm consequential contact information with the cited provider source or the provider/issuer. |
| **Please explain how Lucie would validate the accuracy of the OpenAI indexed data with respect to the proposed provider contact information modal solution. Specifically, what mechanisms would the Lucie team use to ensure the accuracy and reliability of each proposed LLM-generated/OpenAI indexed provider data field (i.e., ZocDoc ratings, telephone numbers, address, and website URL)?** | Every specialty, phone, address, and website must have its own citation to a consulted page, with separate verbatim quotations establishing provider identity and the fact. The model evaluates exact-provider attachment, the complete value, professional purpose, field-local conflicts, and fact-specific recency before applying source priority. Strict Zod Structured Outputs constrain the response shape. Narrow host checks enforce independently verifiable invariants; they do not attempt semantic classification of an unlabeled phone or address. Ratings, including Zocdoc ratings, are not returned. Both final configurations parsed 60/60 holdout responses, and the shipped configuration met the fixed noninferiority criteria for material support, readable own-citation support, and provider identity. |
| **Has Lucie done testing to determine how the accuracy of the AI Web-Search Provider Profiles compares with information provided by existing government APIs?** | Yes, with important limits. Every holdout provider was returned by CMS provider search, was covered by at least one sampled actual 2026 Marketplace plan, and had an active matching NPPES identity when the cohort was built. The shipped configuration returned 60/60 profiles and an eligible professional contact for 51/60 providers, compared with 48/60 for its immediate predecessor. The study measures web support, identity attachment, contact survival, source hierarchy, and overlap with CMS/NPPES; it does not establish that AI is more accurate than CMS, NPPES, or issuer directories and is not nationally representative. |
| **Will the feedback mechanism be displayed to consumers, or is it only intended for agent/broker use?** | It is available to anyone who can use the provider contact modal, including consumers and agent/broker users. It is not limited to agent/broker use. |
| **Will messaging be displayed to instruct users on how to interact with the feedback buttons (i.e., only use the buttons to indicate whether the information was correct)?** | Yes. The modal asks whether the overall contact details and each displayed field are correct. An incorrect response requires a field-compatible structured reason. Feedback is quality telemetry; it does not automatically retrain the model or replace displayed facts. |
| **When the OpenAI search returns multiple results for a data field (e.g., multiple addresses), how does Lucie determine which information will be prioritized and displayed by default on the initial modal display versus which information will require the user to click to see more?** | Evidence qualification comes first. A candidate must identify the exact provider, support the complete fact and professional purpose, and survive identity and same-field conflict review. Only then does Lucie prefer an exact provider/practice/facility page, followed by exact-provider government evidence including NPPES, and then an established professional directory. NPPES is valid but may be stale; official branding does not by itself establish correctness. Missing fact-specific recency is neutral rather than grounds for rejection. The first eligible value is displayed by default; additional values require evidence of concurrent professional use and appear behind “Show more.” |

## Shipped production configuration

The service uses the Azure OpenAI Responses API with `gpt-5.6-terra`, reasoning
`low`, required native web search, and strict SDK-native Zod Structured Outputs.
It uses one semantic model call per attempt, performs no production host webpage
fetch, and makes no second LLM adjudication call. The model does not receive or
return plan, payer, network, coverage, enrollment, participation, or ratings
information.

The public request retains `lineOfCoverage: "Medical"` for compatibility with
the calling plan workflow. `Medical` identifies the insurance product line,
not the provider entity type. It is not copied into the model prompt and does
not restrict facility support. The service supports NPI Type 1 practitioners
and NPI Type 2 groups, practices, clinics, hospitals, and other facilities.

## Headline holdout results

| Outcome | Immediate predecessor | Shipped configuration |
| --- | ---: | ---: |
| Parsed profiles | 60/60 | 60/60 |
| Profiles containing a raw phone, address, or website | 52/60 | 54/60 |
| Judged eligible professional-contact survival | 48/60 | 51/60 |
| Confirmed safety violations after detailed review | 0 | 0 |
| Web searches | 198 | 190 |
| Estimated production cost | $6.333971 | $6.128398 |
| Median latency | 11.511 s | 11.157 s |
| p95 latency | 20.432 s | 19.550 s |

The preregistered automatic safety-screening gate was not met because the
automated evaluator generated potential-safety flags before detailed review;
the subsequent review substantiated none of them as a safety violation.

The observed eligible-contact difference favored the shipped configuration by
five percentage points. Its lower 95% confidence bound was -6.67 points, which
missed the preregistered -5-point noninferiority margin. This is a limitation
of the statistical conclusion, not an observed loss of contacts. Material
support, readable own-citation support, and provider-identity attachment met
their fixed noninferiority criteria.

The static model-visible contract is 18,143 bytes: 79.1% shorter than the
86,769-byte legacy starting point and 1.9% shorter than the immediate
predecessor. The detailed appendix explains why Lucie selected this
configuration despite the confidence-bound limitation and documents the one
historical citation-metadata disclosure that the shipped configuration fixes.

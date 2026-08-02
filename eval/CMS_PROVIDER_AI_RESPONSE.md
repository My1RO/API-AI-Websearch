# CMS response: AI web-search provider profiles

Status: technical draft updated with the short contract's sealed holdout. The
holdout overturned the proposed promotion: the short contract is not approved
for deployment unchanged. The longer source-quality predecessor remains the
release candidate while Lucie develops and independently validates a narrow
repair.

The [companion validation report](CMS_PROVIDER_AI_VALIDATION_REPORT.md) gives
the complete design, denominators, cost and latency distributions, limitations,
API reproductions, and evidence inventory. The
[prompt-minimization report](PROVIDER_PROMPT_MINIMIZATION_REPORT.md) records
both the paired development result and the later holdout reversal.

## Responses to CMS

| Original CMS question | Lucie response |
| --- | --- |
| **Will there be guardrails to prevent the disclosure and display of the provider’s personal information (e.g., to prevent the provider’s personal cell phone number or address from being displayed)?** | Yes, but the short successor is not approved unchanged. The model may return only public professional contacts for the exact provider and must omit fax, mobile/cell, personal/home, residential, people-search, and uncertain-purpose candidates. Every fact carries its own provider-identity quotation, fact quotation, and direct page URL. Narrow host checks reject literal self-declared prohibited values and invalid output, but Lucie does not claim deterministic code can identify every unlabeled personal contact. In the short contract's sealed holdout, no judged claim disclosed a personal/mobile phone or residential address; however, one bare fax number was incorrectly retained as a phone. Ten cases were evaluator no-call overflows and two produced no parsed profile. That confirmed prohibited contact blocks promotion under Lucie's safety-first rule. |
| **When there are conflicts between HealthCare.gov API data and OpenAI indexed data, how would they be addressed?** | HealthCare.gov and plan-directory APIs exclusively determine network status. Plan/network data are not serialized into the provider objects sent to the model and are not returned by it, so AI contact information cannot override participation. Contact disagreements are resolved field by field from exact-provider evidence; agreement with an API is not proof that either value is current. NPI and name are primary identity keys. Specialty and requested location are stale-capable cross-checks. |
| **If conflicting information is displayed, how should the consumer or agent/broker reconcile those conflicts?** | The product identifies AI contact information as supplemental, preserves plan-directory authority for network status, provides source links, and supports structured correctness feedback. Users should confirm important details with the cited provider source or provider/issuer. Lucie—not the consumer—owns investigation and correction. An unresolved same-field identity or safety conflict is omitted; a conflict in one field does not suppress unrelated supported facts. Feedback neither automatically trains the model nor replaces displayed data. |
| **Please explain how Lucie would validate the accuracy of the OpenAI indexed data with respect to the proposed provider contact information modal solution. Specifically, what mechanisms would the Lucie team use to ensure the accuracy and reliability of each proposed LLM-generated/OpenAI indexed provider data field (i.e., ZocDoc ratings, telephone numbers, address, and website URL)?** | Every selected specialty, phone, address, and website must identify the exact provider and carry one direct page URL plus separate identity and fact spans. The model verifies professional purpose, resolves relevant different-NPI conflicts, applies fact-specific recency when available, and only then applies source priority. SDK-native strict Zod Structured Outputs and narrow host invariants enforce response shape, but the holdout showed those mechanisms are not sufficient by themselves. Of 166 judged short-contract claims, 164 had exact whole-packet support, one was contradicted, and one was unreadable. Own citations were 160 exact, two not found, one contradicted, and three unreadable. The contradicted claim was a fax emitted as a phone. Thirty-three additional claims were unjudged because complete evidence packets exceeded the fixed context ceiling. Ratings, including Zocdoc ratings, remain outside the contract. |
| **Has Lucie done testing to determine how the accuracy of the AI Web-Search Provider Profiles compare to the accuracy of information provided by the existing gov APIs?** | Yes, with limits. Lucie tested 40 source-quality configurations and seven shorter prompt contracts. Four source-quality configurations advanced to complete 60-provider development evaluations; two prompt-minimization survivors received complete paired development comparisons. The short winner was then frozen and run once on the sealed disjoint 60-provider holdout. Every holdout provider came from CMS provider search, had literal coverage under at least one sampled actual 2026 Marketplace plan, and had an active matching NPPES identity/location at cohort construction. The short contract returned 58/60 parsed profiles and 54/60 profiles with a phone, address, or website, versus 60/60 for both in the predecessor run. Of 57 emitted addresses, 39 matched the requested location, ten were other or compatible professional locations, and eight were unjudged overflows. This evaluates overlap and independent support; it does not establish superiority over CMS, NPPES, or plan directories or national representativeness. |
| **Will the feedback mechanism be displayed to consumers, or is it only intended for agent/broker use?** | It is available to anyone who can use the provider contact modal, including consumers and agent/broker users. It is not limited to agent/broker use. The application derives only a broad user class for aggregate quality analysis. |
| **Will messaging be displayed to instruct users on how to interact with the feedback buttons (i.e., only use the buttons to indicate whether the information was correct)?** | Yes. The modal asks whether the overall contact details and each displayed field are correct. An incorrect response requires a field-compatible structured reason. This path does not collect free-text feedback. |
| **Who will have access to the feedback data?** | Only approved Lucie data analysts will have access to feedback aggregates. Members, consumers, agent/broker users, and ordinary application users cannot read records or summaries; the application has no feedback read route. Production access requires a separate read-only analyst role, least privilege, SSO/MFA, audit logging, recertification, retention, and separation from database/platform administration. |
| **How does Lucie intend to use that feedback data?** | Approved analysts will use organization-scoped daily aggregates to identify quality trends, investigate incorrect information, prioritize corrections, and monitor the service. Feedback will not be shown back to users, automatically train the model, change prompting, suppress fields, or replace directory data. Any future automated use requires separate approval and validation. |
| **When the OpenAI search returns multiple results for a data field (e.g., multiple addresses), how does Lucie determine which information will be prioritized and displayed by default on the initial modal display versus which information will require the user to click to see more?** | Evidence qualification comes first. The model attaches each candidate to the exact provider, verifies the complete fact and professional purpose, resolves identity and same-field conflicts, and applies fact-specific recency when it exists. Only among otherwise eligible evidence does it prefer an exact provider/practice/facility page, then exact-provider government evidence including NPPES, then an established professional directory. NPPES is valid but may be stale; official branding does not guarantee correctness or independent corroboration. Missing recency is neutral rather than a rejection. Element zero is the default; later concurrently supported values appear behind “Show more.” In 48 judged short-contract cases, the highest eligible returned tier was selected for 137 field decisions, a lower tier for 12, and 21 fields were inappropriately withheld. This hierarchy is useful but imperfect and does not override the release-blocking fax finding. |

## Selection and validation history

The source-quality program first exposed over-restrictive host filtering, weak
fact-level citation attribution, source priority applied before fact
qualification, and unnecessary plan context. It tested **40 distinct
production-shaped configurations with live pilot requests**. Four advanced to
complete 60-provider development evaluations. The final two received a paired
comparison under one fixed evaluator; a safety-first winner was frozen before
the independent holdout was opened.

That longer predecessor used one-call direct per-fact citations, applied source
hierarchy only after evidence qualification, preserved government/directory
fallback when a first-party page lacked the field, treated qualified biography
and team pages as website evidence, and stopped after sufficient identity,
fact, first-party, and conflict checks. Its disjoint holdout returned 60/60
profiles. Fifty-nine cases were evaluable; no major safety violation was
confirmed. One minor unsupported slash appeared in an address subfield, nine
claims were indeterminate because their exact evidence was unavailable, and no
claim carried a qualifying fact-specific date.

After sealing that holdout, Lucie minimized the complete prompt contract using
only the frozen development battery. The measurement includes system
instructions, fixed user scaffolding, and the exact strict schema generated
from Zod. Seven shorter contracts were piloted and the two shortest survivors
received complete 60-provider paired comparisons against the predecessor under
the same fixed evaluator.

The complete selected short static contract is **11,196 bytes versus 86,769
bytes (87.1% shorter)**. It was the shortest candidate to pass the frozen paired
non-inferiority, safety, parser, fidelity-count, and evidence-availability
gates; the next-shortest alternative exceeded the withholding-count limit.
Length therefore plateaued for this iteration.

Both full-comparison arms returned 60/60 development profiles. The selected
short contract's paired endpoints were:

| Endpoint | Predecessor | Short contract | Short-minus-predecessor lower 95% bound |
| --- | ---: | ---: | ---: |
| Profile with eligible contact | 98.33% | 98.33% | 0.00 pp |
| Exact whole-packet material support | 99.38% | 99.38% | -1.82 pp |
| Exact own-citation support | 99.36% | 98.05% | -4.64 pp |
| Exact provider identity | 100% | 100% | 0.00 pp |

Every bound cleared the preregistered -5-point margin. Affected-case changes
were -2 inappropriate withholding, -4 lower-tier selection, +2 span defects,
and -6 citation unreadability; each cleared its frozen limit. The short arm
introduced zero new major-safety defects and no parser loss.

The short contract used 1,083,269 input tokens versus 1,922,354 (-43.7%) and
cost an estimated `$4.6159965` versus `$5.041616` (-8.4%). Its
mean/median/p95/max per-request cost was
`$0.07693`/`$0.06909`/`$0.11682`/`$0.17099`; latency was
14.67/8.55/16.31/309.75 seconds.

One initially reported source failure was an evaluator transport defect: the
direct fetch received an ALB 403, while the uniform rate-limited reader
fallback retrieved the exact returned first-party page and confirmed the
specialty, phone, and address. The only remaining issue on that case was a
minor unsupported slash in `addressLine2`. The corrected fetch protocol had
zero fallback failures for emitted citations and was applied identically to
both arms.

After the development decision was frozen, Lucie ran the short contract once
on that same sealed, disjoint 60-provider holdout. It returned 58/60 parsed
profiles and 54/60 profiles with a phone, address, or website. Two cases failed
after the initial attempt and semantic retry because the lean structured schema
accepted full state names while the downstream parser required two-letter
states. Among 48 judge-complete cases,
164/166 claims had exact whole-packet support, but one first-party fax was
emitted as a phone. Ten complete evidence packets exceeded the fixed context
ceiling and remained unknown. Twenty-one non-rating fields were also judged
inappropriately withheld.

That result changes the decision. The development-selected short contract is
not approved unchanged; the longer predecessor remains the release candidate.
The short prompt is published below as the exact evaluated treatment, not as a
claim of deployment approval. Across both phases Lucie exercised **47 prompt
or stack configurations**: 40 source-quality configurations and seven prompt-
minimization variants.

## Evaluated short production-shaped contract

The rejected-as-is successor used this production-shaped service path:

`provider-only request → one Azure Responses call with native web search → strict structured parsing → narrow local invariants → ordered modal facts`

It used:

- Azure OpenAI Responses API;
- `gpt-5.6-terra`, reasoning `low`;
- required native `web_search`, maximum eight calls;
- SDK-native strict Zod Structured Outputs, not instructions to emit JSON;
- one LLM call per semantic attempt and at most three non-stacking HTTP sends;
- direct per-fact `sourceUrl`, `providerIdentitySpan`, `factSpan`, and
  nullable exact-fact date span;
- no production host webpage fetch and no second adjudication call;
- no plan/network input or output;
- no rating output; and
- model-owned semantic decisions with narrow independently checkable host
  invariants.

The complete static contract is 11,196 bytes. Development evaluation suggested
that removing schema descriptions while retaining one lean system policy and
strict field names/types preserved performance. The sealed holdout disproved
that conclusion for end-to-end robustness: full state names passed the lean
structured schema but failed the downstream two-letter-state parser, citation
span fidelity worsened, and a fax escaped the semantic policy.

The public request retains `lineOfCoverage: "Medical"` for compatibility with
the medical insurance-product workflow. `Medical` identifies product line,
not entity type. The field is not serialized into model provider objects or
returned by the model. The independent prompt phrase “Medical providers”
scopes the healthcare-search domain; it does not narrow entity type. NPI Type 1
practitioners and NPI Type 2 groups, clinics, hospitals, and facilities remain
supported. Network authority remains exclusively with CMS and plan-directory
APIs.

The host validates public URL/string shape, exact request identity, phone-digit
shape, website/citation URL equality, obvious placeholders, literal prohibited
labels in emitted values, and stable deduplication. It does not fetch pages in
production or semantically classify source quality, currentness, or an
unlabeled contact. In the confirmed fax case, the emitted value and fact span
contained only the digits, so this intentionally narrow check could not infer
the page's omitted `Fax` label. Native citation/action mismatches are logged
rather than used as a destructive parser gate.

The retry envelope does not stack. The initial call uses SDK `maxRetries=1`;
at most one semantic retry uses `maxRetries=0`. Native refusal and completion
content filtering receive one identical full retry; malformed strict output
receives one identity-focused retry.

## Source priority and recency

Source priority applies only after exact-provider, exact-fact, professional-
purpose, conflict, and fact-applicable recency qualification:

1. exact provider, practice, clinic, facility, hospital, or health-system page;
2. exact-provider government evidence, including NPPES; and
3. established exact-provider professional directory.

This is a display preference, not a truth guarantee. A higher tier cannot
rescue a wrong provider, unsupported value, unsafe purpose, incompatible
operation, or affirmative different-NPI conflict. Shared use is not a
contradiction without evidence of exclusivity or incompatibility.

Only a date governing the exact provider, field, and value counts as recency.
Retrieval time, copyright year, and record-wide registry enumeration,
certification, or update dates do not. Undated supported evidence remains
eligible and neutral; Lucie does not call it current.

## Evaluation and governance limits

The fixed evaluator was `gpt-5.6-sol`, reasoning `high`, with one categorical
rubric, strict structured output, host-computed criteria, and no model-generated
aggregate score. The successor retained only its own returned URLs. The
evaluator fetched those exact URLs and normalized readable content; it did not
credit a page the arm did not return. The holdout produced 48 paid judgments,
10 honest no-call context overflows, two production errors, no judge error, and
no content-filter censor. No source packet was truncated or summarized by an
extraction model. Evaluation-only TLS verification was disabled under explicit
authorization because of local interception; production performed no host
fetch.

The studies are model-assisted evaluations with additive trace review, not
blinded independent human adjudication. They do not prove perfect citation
fidelity, complete internet coverage, national performance, or superiority
over CMS, NPPES, or plan directories.

Feedback is stored only as organization-scoped daily aggregate counts by broad
submitter class, provider, normalized fact, answer, reason, and UTC day. The
path stores no raw event, member/user/session/request/query/prompt/response
identifier, and has no application read route. Approved analyst access,
retention, minimum-cell suppression, access review, audit evidence, and
incident/correction ownership remain organizational release controls.

## Appendix A — Literal evaluated short prompt

The following is the exact system instruction:

```text
Find public professional profile facts for each exact requested medical provider. Use web search every time; eight calls is a ceiling. Search quoted name plus exact NPI first. Then make one separate first-party query without the NPI using exact name plus location or likely organization, and inspect its best plausible result; do not stop at a registry. NPI plus name are primary identity; providerId is correlation data, location may be stale search context, and specialty is a weak cross-check. Results, snippets, titles, URLs, and error/challenge pages are leads, not readable evidence. Qualify each fact independently: exact-provider attachment; one readable cited page supporting identity and the complete value; professional purpose/location; same-field and different-NPI conflicts; fact-bound recency when available; then source priority. Tier, branding, or recency cannot rescue an ineligible fact. For organizations, inspect relevant same-name alternate-NPI evidence before using a first-party bundle. It is relevant only when readable evidence binds the candidate value or exact domain/page bundle to another NPI, subpart, or incompatible operation; similarity, proximity, branding, affiliation, or location mismatch alone is insufficient. Omit an implicated value unless affirmative evidence attaches that same value to the requested NPI or establishes shared/concurrent use. For Entity Type 2 at one base street, omit an unresolved conflicting suite/subpart but preserve an independently exact-NPI base address. Conflicts are field-local: address/phone conflict does not implicate a domain. An implicated domain needs requested-provider attachment, shared use, or rebranding/acquisition/ownership continuity. Do not demand exclusivity for unimplicated facts. Emit only public professional facts. Phones are professional voice numbers, never fax, mobile/cell, personal/home, or uncertain-purpose. Addresses are complete professional office/practice/clinic/facility/hospital locations, never residential, people-search, place-name-only, or uncertain-purpose. Omit prohibited or uncertain candidates. A shared facility phone is eligible when attached to the exact provider and not exclusive to an incompatible operation. Emit multiple competing values only with affirmative concurrent-operation evidence; registry labels or undated conflicts do not establish concurrency. Otherwise choose one. After qualification, prefer a currently offered exact-provider first-party value over a conflicting undated registry/directory value unless affirmative evidence makes it former, ineligible, or another operation. Record-wide registry dates do not date each fact; undated support remains eligible. Among otherwise eligible same-fact evidence prefer exact-provider first-party, then government including NPPES, then established professional directory. NPPES may be stale; official is not necessarily correct or independent corroboration. Give every fact one citation to a consulted readable page supporting identity and its complete value. After values are fixed, make one citation-only pass over already-consulted same-value exact-provider pages: replace a lower-tier citation with first-party evidence when available, otherwise government, then directory; never change the value. sourceUrl is that exact page, never a search/snippet/metadata/tool-action/unread/error or different corroborating page. providerIdentitySpan and factSpan are shortest sufficient contiguous quotations from it: no ellipses, joined regions, paraphrase, invented labels, or token rewriting. Identity normally needs NPI or full name plus compatible organization/location; a shortened name needs multiple compatible biographical identifiers and no conflict. factSpan preserves rendered words/token order; only markup, whitespace, and Unicode typography may normalize. explicitFactDateSpan quotes an effective/current date co-bound to this fact, else null; retrieval, copyright, generic, and record-wide dates do not qualify. A website is the exact consulted readable provider/organization first-party page URL and equals citation.sourceUrl. Its identity and fact spans may reuse one exact page-local provider/organization heading. Emit it only when both spans can be copied exactly; omit rather than fabricate or combine text. A biography/team page qualifies without NPI/contact parity when it has unambiguous full name, compatible credential/specialty, and practice/location. Compatible affiliations are allowed; omit a domain unresolved to another NPI/operation. Return a profile when any eligible fact remains, including specialty only; preserve requested providerId/NPI/name and use empty unsupported arrays. Never search for or return insurance, payer, plan/network/coverage/enrollment, ratings, or participation. Remove items without readable item-local evidence, upgrade only same-value citations, put the best value first, and preserve other qualified facts. Stop after sufficient identity, fact support, first-party inspection, and relevant conflict checks.
```

The following is the exact fixed user scaffolding for one placeholder provider;
runtime values replace only the placeholders:

```text
Find eligible public professional facts for these Medical providers.
Return one profile per provider when any eligible fact is found; use empty arrays for unsupported fact types.
Providers: [{"providerId":"<providerId>","npi":"<npi>","name":"<name>","specialty":"<specialty>","city":"<city>","state":"<state>","zip":"<zip>"}]
```

## Appendix B — Exact evaluated generated strict output schema

This is the exact JSON Schema passed as the strict Responses API text format.
It is generated from the evaluated short Zod schema and intentionally contains no
field descriptions.

```json
{
  "type": "object",
  "properties": {
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "providerId": {
            "type": "string",
            "nullable": true
          },
          "npi": {
            "type": "string",
            "nullable": true
          },
          "providerName": {
            "type": "string"
          },
          "specialties": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "value": {
                  "type": "string"
                },
                "citation": {
                  "type": "object",
                  "properties": {
                    "sourceUrl": {
                      "type": "string"
                    },
                    "sourceTitle": {
                      "type": "string",
                      "nullable": true
                    },
                    "providerIdentitySpan": {
                      "type": "string"
                    },
                    "factSpan": {
                      "type": "string"
                    },
                    "explicitFactDateSpan": {
                      "type": "string",
                      "nullable": true
                    }
                  },
                  "required": [
                    "sourceUrl",
                    "sourceTitle",
                    "providerIdentitySpan",
                    "factSpan",
                    "explicitFactDateSpan"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "value",
                "citation"
              ],
              "additionalProperties": false
            }
          },
          "locations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "addressLine1": {
                  "type": "string"
                },
                "addressLine2": {
                  "type": "string",
                  "nullable": true
                },
                "city": {
                  "type": "string",
                  "nullable": true
                },
                "state": {
                  "type": "string",
                  "nullable": true
                },
                "zip": {
                  "type": "string",
                  "nullable": true
                },
                "citation": {
                  "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation"
                }
              },
              "required": [
                "addressLine1",
                "addressLine2",
                "city",
                "state",
                "zip",
                "citation"
              ],
              "additionalProperties": false
            }
          },
          "phoneNumbers": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items"
            }
          },
          "websites": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items"
            }
          }
        },
        "required": [
          "providerId",
          "npi",
          "providerName",
          "specialties",
          "locations",
          "phoneNumbers",
          "websites"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "profiles"
  ],
  "additionalProperties": false,
  "definitions": {
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation": {
      "type": "object",
      "properties": {
        "sourceUrl": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl"
        },
        "sourceTitle": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle"
        },
        "providerIdentitySpan": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan"
        },
        "factSpan": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan"
        },
        "explicitFactDateSpan": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan"
        }
      },
      "required": [
        "sourceUrl",
        "sourceTitle",
        "providerIdentitySpan",
        "factSpan",
        "explicitFactDateSpan"
      ],
      "additionalProperties": false
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items": {
      "type": "object",
      "properties": {
        "value": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_value"
        },
        "citation": {
          "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation"
        }
      },
      "required": [
        "value",
        "citation"
      ],
      "additionalProperties": false
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceUrl": {
      "type": "string"
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_sourceTitle": {
      "type": "string",
      "nullable": true
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_providerIdentitySpan": {
      "type": "string"
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_factSpan": {
      "type": "string"
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation_properties_explicitFactDateSpan": {
      "type": "string",
      "nullable": true
    },
    "provider_profiles_properties_profiles_items_properties_specialties_items_properties_value": {
      "type": "string"
    },
    "provider_profiles": {
      "type": "object",
      "properties": {
        "profiles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "providerId": {
                "type": "string",
                "nullable": true
              },
              "npi": {
                "type": "string",
                "nullable": true
              },
              "providerName": {
                "type": "string"
              },
              "specialties": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "value": {
                      "type": "string"
                    },
                    "citation": {
                      "type": "object",
                      "properties": {
                        "sourceUrl": {
                          "type": "string"
                        },
                        "sourceTitle": {
                          "type": "string",
                          "nullable": true
                        },
                        "providerIdentitySpan": {
                          "type": "string"
                        },
                        "factSpan": {
                          "type": "string"
                        },
                        "explicitFactDateSpan": {
                          "type": "string",
                          "nullable": true
                        }
                      },
                      "required": [
                        "sourceUrl",
                        "sourceTitle",
                        "providerIdentitySpan",
                        "factSpan",
                        "explicitFactDateSpan"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "value",
                    "citation"
                  ],
                  "additionalProperties": false
                }
              },
              "locations": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "addressLine1": {
                      "type": "string"
                    },
                    "addressLine2": {
                      "type": "string",
                      "nullable": true
                    },
                    "city": {
                      "type": "string",
                      "nullable": true
                    },
                    "state": {
                      "type": "string",
                      "nullable": true
                    },
                    "zip": {
                      "type": "string",
                      "nullable": true
                    },
                    "citation": {
                      "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items_properties_citation"
                    }
                  },
                  "required": [
                    "addressLine1",
                    "addressLine2",
                    "city",
                    "state",
                    "zip",
                    "citation"
                  ],
                  "additionalProperties": false
                }
              },
              "phoneNumbers": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items"
                }
              },
              "websites": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/provider_profiles_properties_profiles_items_properties_specialties_items"
                }
              }
            },
            "required": [
              "providerId",
              "npi",
              "providerName",
              "specialties",
              "locations",
              "phoneNumbers",
              "websites"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "profiles"
      ],
      "additionalProperties": false
    }
  },
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

# CMS response: AI web-search provider profiles

## Organizing message

Lucie will complete a careful pre-launch evaluation of result quality and safety, incorporating CMS's suggestions about prioritizing source quality and recency. The [evaluation plan below](#pre-launch-evaluation-plan) will answer most empirical questions about accuracy, conflicts, citations, and multiple results. Firm governance policies, including separation of responsibilities, answer the operational questions. The current implementation provides the evidence for the remaining answers.

For internal readers, “OpenAI indexed data” in the CMS questions means results returned through Azure OpenAI's live Responses `web_search` tool; it is not a static Lucie or OpenAI provider index. Azure OpenAI is the only supported runtime, and the service fails closed when its Azure configuration or compliance gates are incomplete ([runtime.ts](../src/config/runtime.ts#L4-L90)).

## Internal before-launch checklist — not part of the CMS response

| Requirement | Status | What remains |
|---|---|---|
| Comparative result-quality and safety evaluation | **Planned before launch** | Build an authorized provider-only cohort, finish independent evidence collection and adjudication, preregister thresholds, and run the [evaluation plan](#pre-launch-evaluation-plan). |
| Test CMS's source-quality and recency suggestions | **Planned before launch** | Compare the current prompt with offline source-quality, recency, combined, and optional directory-address-seed variants. Do not change production behavior until a variant passes the release gates. |
| Azure privacy and web-search approval | **Leadership evidence needed** | Document the production resource settings, modified-abuse-monitoring status, content logging, diagnostics, retention, access controls, and approval of Grounding with Bing's separate terms and geographic boundary. |
| Display-safe provider contact standard | **Leadership evidence needed** | Approve the rule for residential-looking addresses, mobile-looking numbers, identity ambiguity, withholding, and zero-tolerance safety failures. |
| Feedback minimization and application enforcement | **Implemented** | The application accepts structured provider-fact feedback, aggregates it by organization and UTC day, stores no raw event timestamp or member/session/query identifier, and exposes no feedback read route. |
| Authoritative broker-organization binding | **Planned before launch** | Validate or replace the current Origin-derived lifecycle tenant label before treating it as the authoritative broker-organization dimension for analytics. |
| Feedback access, retention, and oversight policy | **Leadership evidence needed** | Name the data owner and analyst group; approve retention, minimum-cell rules, access reviews, audit cadence, correction service level, and incident escalation. |
| Azure evaluation judge | **Planned before launch** | Select an approved Azure deployment distinct from production and calibrate it against blinded human review. A 2026-07-28 check did not find GPT-5.6 Sol; no further model experiments are planned until provisioning and governance are approved. |
| PRD “30–50%” provider-directory statement | **Leadership evidence needed** | Kristy will supply the source, population, date, and metric definition. Until then, the figure will not be used as a baseline or accuracy claim. |

## Responses to CMS

The middle column is written for CMS. The final column is an internal briefing and is **not part of the CMS response**.

| Original CMS question | CMS-facing short answer | Internal complete answer — not for submission |
|---|---|---|
| **Will there be guardrails to prevent the disclosure and display of the provider’s personal information (e.g., to prevent the provider’s personal cell phone number or address from being displayed)?** | Yes. Lucie instructs the search not to return personal contact information and filters the results before display. Before launch, Lucie will test every proposed field for accuracy, professional relevance, and the risk of exposing personal information. Under the release policy, information that cannot be supported safely will not be displayed. | The prompt prohibits personal mobile numbers, residential addresses, personal email, people-search records, and social profiles ([prompt-builder.service.ts](../src/services/prompt-builder.service.ts#L3-L8)). Post-processing binds displayed values to actual citation URLs, rejects unsafe source classes, validates and normalizes each field, and requires the returned identity to match the requested provider ([response-parser.ts](../src/services/ai-provider/response-parser.ts#L87-L135), [provider-profile-sanitizer.service.ts](../src/services/provider-profile-sanitizer.service.ts#L353-L443)). These controls reduce risk but cannot prove that a value published by a professional-looking directory is not residential or personal. Release therefore still requires the display-safe standard and safety evaluation in the checklist. |
| **When there are conflicts between HealthCare.gov API data and OpenAI indexed data, how would they be addressed?** | HealthCare.gov and plan-directory data will continue to determine whether a provider is in network; the AI information will not override that decision. A disagreement about contact information will be treated as a signal for review, not proof that either source is correct. Before launch, Lucie will test CMS's suggestions for favoring higher-quality and more recent sources. | Current code keeps network participation and AI contact details in separate product layers. The UI states that AI contact information is supplemental and does not override network status ([English copy](../../consumer-frontend/src/locales/en/default.json#L1140)). The evaluator records an address agreement or disagreement without treating it as a correctness verdict ([provider-profile-eval.ts](../src/eval/provider-profile-eval.ts#L266-L287)). There is no current prompt instruction that reconciles the AI result against directory data; proposed source-quality, recency, and address-seed behavior remains an offline experiment. |
| **If conflicting information is displayed, how should the consumer or agent/broker reconcile those conflicts?** | The application tells the user that plan-directory information controls network status and that AI contact information is supplemental. Users should consult the cited source and confirm with the provider or issuer when necessary, then report incorrect information through the feedback controls. Lucie will own the investigation and correction process rather than asking the user to decide which source is correct. | The modal already provides the authority notice, source links, and correctness feedback controls ([ProviderProfileContactModal.js](../../consumer-frontend/src/components/pages/Plans/Components/ProviderProfileContactModal.js#L509-L525)). The adopted correction policy is to verify identity and location, compare current evidence, withhold ambiguous or unsafe AI fields, and escalate recurring or safety-critical errors. Feedback counts do not automatically replace directory values, change prompting, or suppress fields. The correction owner and service level still require leadership approval. |
| **Please explain how Lucie would validate the accuracy of the OpenAI indexed data with respect to the proposed provider contact information modal solution. Specifically, what mechanisms would the Lucie team use to ensure the accuracy and reliability of each proposed LLM-generated/OpenAI indexed provider data field (i.e., ZocDoc ratings, telephone numbers, address, and website URL)?** | Lucie will check that each displayed field belongs to the correct provider, is supported by the cited page, is current, and is appropriate professional contact information. The pre-launch evaluation will independently review telephone numbers, addresses, website URLs, ratings, and their cited sources. Zocdoc will be treated like any other public website returned by the search; it receives no special preference or treatment. | Current processing applies identity matching, schema validation, citation-URL binding, source classification, unsafe-domain filtering, normalization, deduplication, and deterministic ordering before display ([provider-profile-sanitizer.service.ts](../src/services/provider-profile-sanitizer.service.ts#L249-L251), [field filters](../src/services/provider-profile-sanitizer.service.ts#L353-L443), [ordering](../src/services/provider-profile-sanitizer.service.ts#L482-L521)). A citation proves that the model returned a URL, not that the page supports the exact field or that the fact is current. The evaluation therefore measures citation provenance, field support, identity and location correctness, recency, and display safety separately. There is no dedicated Zocdoc integration or priority; a Zocdoc result is evaluated under the same rules as another permitted open-web rating source. |
| **Has Lucie done testing to determine how the accuracy of the AI Web-Search Provider Profiles compare to the accuracy of information provided by the existing gov APIs?** | Not yet. Lucie has designed a comparative evaluation and will complete it before launch using the [test plan below](#pre-launch-evaluation-plan). The study will independently assess both sources rather than assuming that either is correct when they disagree. | No completed comparative study is evidenced in the repository. A partial runner, scorer, and synthetic example exist, but no real provider cohort supports an accuracy claim ([evaluation README](README.md), [runner](../scripts/provider-profile-eval.ts#L26-L71)). The planned study uses provider-level paired comparisons, independent web evidence, higher-reasoning evaluation models, blinded human review, and adjudication. Repeated runs measure nondeterminism but are not counted as independent providers. |
| **Will the feedback mechanism be displayed to consumers, or is it only intended for agent/broker use?** | It will be available to anyone who can use the provider contact modal, including consumers and agent/broker users. It is not limited to agent/broker use. The application records only a broad user class for quality analysis. | Submission is not role-gated in the frontend path. Public-API derives a coarse class from authenticated roles rather than trusting a caller-supplied value: consumer, producer, general agent, broker administrator, internal administrator, or unknown ([FeedbackSubmitterClass.php](../../Public-API/module/Application/src/Tools/FeedbackSubmitterClass.php#L7-L38), [ACLListener.php](../../Public-API/module/Application/src/Listener/ACLListener.php#L55-L72)). The feedback record contains no user identifier and is aggregated by organization, provider fact, answer, reason, and UTC day. |
| **Will messaging be displayed to instruct users on how to interact with the feedback buttons (i.e., only use the buttons to indicate whether the information was correct)?** | Yes. The modal asks whether the overall contact details and each individual field are correct. If a user marks information incorrect, the user must select a reason. Lucie will not collect free-text feedback. | The frontend provides profile-level and per-phone, address, website, and rating controls. A positive response records `correct/accurate`; a negative response is not submitted until the user selects a field-compatible reason ([ProviderProfileContactModal.js](../../consumer-frontend/src/components/pages/Plans/Components/ProviderProfileContactModal.js#L278-L365)). Both Public-API and API-AI reject unsupported fields and free-text notes ([ProviderFeedbackPayload.php](../../Public-API/module/Application/src/Tools/ProviderFeedbackPayload.php#L7-L87), [provider-profile.validator.ts](../src/validators/provider-profile.validator.ts#L103-L179)). |
| **Who will have access to the feedback data?** | Only approved Lucie data analysts will have access to the feedback data. Members, consumers, agent/broker users, and application users will not be able to view feedback records or summaries. Lucie will enforce this through separation of responsibilities, limited access, auditing, and regular access review. | The application currently has no feedback read or aggregate route ([ai.routes.ts](../src/routes/ai.routes.ts#L44-L90)). The adopted policy restricts database and reporting access to the named Lucie analyst group through a separate read-only role; the application service is write-only, and platform administrators may not use the data for routine analysis. Production proof of database permissions, access recertification, auditing, minimum-cell controls, and retention is organizational evidence that cannot be established from this repository alone. |
| **How does Lucie intend to use that feedback data?** | Approved Lucie data analysts will use the feedback to identify quality trends, investigate incorrect information, prioritize corrections, and monitor results by broker organization. Feedback will not be shown back to members or agent/broker users. It will not automatically train the model or change displayed information. | API-AI stores organization-scoped daily counts by broad submitter class, provider, fact/value, answer, and structured reason, plus daily positive/negative consensus counts ([feedback.service.ts](../src/services/feedback.service.ts#L35-L103), [migration](../src/migrations/2026060200010-SafeFeedbackTables.ts#L8-L61)). It stores no raw feedback event, event timestamp, member, user, session, request, query, quote, prompt, or response identifier. Analysts may drill down only to broker-organization granularity under minimum-cell rules. The current organization value comes from the Origin-derived lifecycle tenant label, so production must validate or replace that binding before treating it as authoritative broker-organization data ([Client.php](../../Public-API/module/Application/src/Tools/Client.php#L124-L135)). Any future automated training, ranking, suppression, or prompt change requires separate approval and validation. |
| **When the OpenAI search returns multiple results for a data field (e.g., multiple addresses), how does Lucie determine which information will be prioritized and displayed by default on the initial modal display versus which information will require the user to click to see more?** | Today, Lucie applies consistent ordering rules and displays the first result, with additional results available through “Show more.” Those rules do not yet determine which result is newest or definitively most accurate. Before launch, Lucie will evaluate CMS's suggestion to prioritize source quality and recency and will adopt it only if testing shows that it improves results safely. | The current prompt uses provider identity plus city, state, and ZIP hints but does not ask for the newest value or rank source classes ([prompt-builder.service.ts](../src/services/prompt-builder.service.ts#L15-L52)). Post-processing prefers apparent official-provider phone sources, then government sources, then professional directories; address ordering first considers requested location hints and then that source order; website and rating ties are lexical, and ratings have no preferred source ([provider-profile-sanitizer.service.ts](../src/services/provider-profile-sanitizer.service.ts#L482-L521)). The UI displays the first item and places the rest behind “Show more.” The optional directory-address seed may improve location matching but could anchor the search to stale directory data, so it belongs in the offline evaluation rather than the current prompt. |

## Shared implementation details

### Provider contact safeguards

The implemented display path is:

`provider-only request → Azure web search → local parsing → actual citation extraction → source and value filtering → identity matching → deterministic ordering → modal`

| Field | Current pre-display control | What the evaluation must establish |
|---|---|---|
| Provider identity | Reject conflicting provider identifiers; otherwise require a matching provider ID, NPI, or normalized name ([identity matching](../src/services/provider-profile-sanitizer.service.ts#L564-L588)). | Correct provider and location, including common-name and missing-identifier cases. |
| Telephone | Require a displayable source and 7–15 digits ([telephone filter](../src/services/provider-profile-sanitizer.service.ts#L353-L365)). | Cited-page support, current professional purpose, correct location, and no personal mobile number. |
| Address | Require a displayable source and normalized address components ([address filter](../src/services/provider-profile-sanitizer.service.ts#L391-L415)). | Cited-page support, current professional location, correct identity, and no residential address. |
| Website | Require classification as the provider's professional site and exact equality with the citation URL ([website filter](../src/services/provider-profile-sanitizer.service.ts#L367-L389)). | Provider ownership, reachability, correct location, and current status. |
| Rating | Require a permitted public rating domain ([rating filter](../src/services/provider-profile-sanitizer.service.ts#L418-L443)). | Exact provider, source, value, scale, capture date, and permitted use. |

Four separate questions must remain separate in the evaluation:

1. Did the URL come from a real model citation?
2. Does the cited page support the displayed field?
3. Is the citation attached to the correct provider, location, and field?
4. Is the fact current, accurate, professionally appropriate, and safe to display?

### Ingress and Azure boundaries

- Lucie confirms that the public Internet reaches the frontend through its reverse proxy; direct API access additionally requires Lucie's VPN and valid OAuth. “Public” in the OAuth route configuration means available to a valid OAuth client/token, not anonymously Internet-accessible ([ACLListener.php](../../Public-API/module/Application/src/Listener/ACLListener.php#L87-L123)).
- Public-API removes authorization, identity, network, and Origin headers before calling API-AI, then supplies only the lifecycle context required by the service ([Client.php](../../Public-API/module/Application/src/Tools/Client.php#L92-L137), [AiWebsearchProxy.php](../../Public-API/module/Application/src/Controller/V1/AiWebsearchProxy.php#L24-L51)).
- Redis jobs retain random request UUIDs but namespace every key with a SHA-256 scope derived from normalized tenant context. A different tenant sees the same expired response as a missing job ([provider-profile-job.service.ts](../src/services/provider-profile-job.service.ts#L24-L40), [contract test](../tests/provider-profile.redis-polling.contract.test.js#L147-L177)).
- Lucie does not construct a direct Bing request. It sends Azure OpenAI the provider name, provider identifier, and city/state/ZIP hints; Azure OpenAI's web-search tool generates downstream search activity ([prompt-builder.service.ts](../src/services/prompt-builder.service.ts#L15-L52)). No explicit member information is part of the intended request. A party monitoring search timing and sequence could still infer an interaction pattern, which is why logging, access, and retention controls remain necessary.

## Feedback governance and separation of responsibilities

The schema stores daily aggregates, not raw feedback events:

- broker organization;
- coarse submitter class;
- provider identifier;
- fact type and normalized provider fact;
- correct/incorrect answer and structured reason;
- UTC day and count.

There is no application feedback read route, and provider-profile, feedback, and phone-click requests are excluded from the general API request archive. That exclusion does not stop collection: Public-API forwards the validated feedback directly to API-AI, which updates the daily aggregate.

| Responsibility | Permitted access | Required separation |
|---|---|---|
| Feedback data owner | Approves purpose, fields, retention, correction workflow, and analyst group. | Cannot approve their own access or administer the production database. |
| Application service | Validates and increments daily aggregates. | No feedback read, export, reporting, or access-administration privilege. |
| Approved Lucie data analysts | Read organization-scoped daily aggregates for quality analysis. | No application deployment, database administration, or access-approval authority. |
| Database/platform administrators | Maintain availability, backups, schema, and access enforcement. | No routine analytic use; exceptional access must be approved, time-bound, and audited. |
| Security/privacy approvers | Approve controls, recertify access, review audit evidence, and oversee incidents. | No routine analytic access and no self-granted access. |

Lucie will require SSO/MFA, least privilege, periodic recertification, immutable audit records, minimum-cell suppression, a documented retention/deletion period, and an incident/correction workflow. Feedback may not be joined to member, user, session, request, query, quote, prompt, or response data. These commitments align with the [CMS Acceptable Risk Safeguards](https://security.cms.gov/policy-guidance/cms-acceptable-risk-safeguards-ars), [CMS separation-of-duties and least-privilege guidance](https://www.cms.gov/tra/Application_Development/AD_0060_Application_Business_Rules.htm#BR-D-1), [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final), and [HHS minimum-necessary guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html).

## Pre-launch evaluation plan

This is a proposed certification study, not a completed result. It is designed to answer CMS's questions about comparative accuracy, conflicts, source support, recency, personal-information risk, citations, and the prioritization of multiple results.

### 1. Build the provider cohort

Sample providers actually returned by the intended provider-search APIs in the launch markets and period. Export provider-only data: provider ID/NPI, name, specialty/taxonomy, professional location, directory source/version, and sampling fields. Do not export member, consumer, quote, application, policy, query, or session data.

Use known sampling probabilities and include individual and facility providers, regions, rurality, specialties, multi-location providers, common names, recent changes, sparse web presence, public rating-directory presence, and known source disagreements. Use a pilot to estimate variance and disagreement, then calculate the certification sample; do not assume that an arbitrary count such as 60 or 400 is sufficient.

### 2. Freeze the systems being compared

Record the production Azure deployment, prompt, configuration, case manifest, and directory snapshot. Run each provider repeatedly under the same controlled schedule. Preserve sanitized outputs, citations, latency, token usage, web-search calls, estimated cost, configuration hashes, and capture times.

### 3. Collect independent evidence

Retrieve each cited page and a preregistered evidence set from provider, practice, facility, or health-system sites; current government registries; and permitted professional or rating directories. Preserve the URL, retrieval time, content hash, page date when available, source class, and the passage supporting each field. Record blocked or unreachable pages rather than silently excluding them.

### 4. Review and adjudicate

Two reviewers, blinded to which system supplied a value, label provider identity, location, exact field support, current/stale/unknown status, professional or personal nature, and source independence. An approved Azure evaluation model distinct from production may assist at higher reasoning effort, but it receives the locked evidence packet rather than unrestricted search. Human adjudication decides disagreements, low-confidence cases, common-name ambiguity, possible personal contact, and critical conflicts.

### 5. Compare the current prompt with CMS's suggestions

Production prompting remains unchanged while the following variants are tested offline:

| Variant | Change being tested | Primary tradeoff |
|---|---|---|
| Current baseline | Existing prompt and ordering. | Reference performance. |
| Source quality | Prefer the exact provider/facility site, then a current government registry, then a permitted professional directory. | May improve support but reduce coverage. |
| Recency | Prefer dated/current evidence and withhold values whose freshness cannot be established. | May reduce stale facts but increase abstention. |
| Source quality and recency | Combine both suggestions without assuming the directory is correct. | Candidate behavior if it improves accuracy and safety. |
| Directory-address seed | Supply the selected directory address as a location hint while permitting independently supported newer locations. | May improve phone-to-location matching but may anchor the search to stale data. |

### 6. Measure results and apply release gates

Measure, by field and overall:

- coverage, emitted precision, recall, and top-result accuracy;
- citation provenance, exact field support, citation correctness, recency, and source quality;
- wrong-provider, wrong-location, personal-contact, stale-contact, and unsupported-field rates;
- agreement and disagreement with directory data without treating agreement as truth;
- repeatability, failures, latency, tokens, web-search calls, and cost.

Treat the provider—not fields or repeated runs—as the independent unit. Compare AI and directory facts as paired observations, use provider-level or provider-clustered confidence intervals, correct for multiple field and subgroup comparisons, and count missing AI results as end-to-end failures.

Approve the release thresholds before reviewing certification results. Personal-information disclosure and critical wrong-provider results require a zero-observed-event gate plus an approved upper confidence bound. Accuracy, citation support, coverage, recency, repeatability, latency, and cost require approved thresholds. The final report must show the AI result, directory result, and independently adjudicated reference separately.

## Internal decisions and evidence still needed

1. Name the feedback data owner, approved analyst group, correction owner, security approver, and privacy/legal approver.
2. Approve the retention period, minimum-cell threshold, access-review cadence, correction service level, and incident escalation path.
3. Provide Azure evidence for modified abuse monitoring, content logging, diagnostics, retention, access controls, and Grounding with Bing approval.
4. Approve the display-safe rule for residential-looking addresses, mobile-looking numbers, and ambiguous provider identities.
5. Obtain Kristy's source and metric definition for the PRD's “30–50%” statement.
6. Confirm whether any off-repository comparative testing or correction workflow should be represented.
7. Select launch markets and period, accuracy and safety thresholds, minimum coverage, and cost ceiling.
8. Decide whether usage and cost telemetry remains operations-only in Azure Monitor/Application Insights or feeds an existing internal platform. The recommended metrics have only low-cardinality environment, deployment, operation, outcome, and pricing-version dimensions—never provider, organization, member, user, session, request, query, quote, prompt, or response identifiers.

Until the evaluation and internal decisions are complete, Lucie can accurately describe the implemented safeguards and committed policies but should not claim that AI provider contact data is proven more accurate than government or directory data, or that personal-contact disclosure is impossible.

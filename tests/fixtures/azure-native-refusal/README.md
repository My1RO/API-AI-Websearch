# Native Responses refusal fixture

`contract-example.json` is a synthetic, secret-free fixture for the Responses API native refusal contract (`output[].content[].type === "refusal"`). It is not represented as a captured Azure response.

Before creating it, the saved non-holdout provider-search response artifacts were searched for native refusal content items. None was present. The preserved apology cases are materially different: Azure reported `status: "incomplete"`, `incomplete_details.reason: "content_filter"`, and an `output_text` apology. Those real, redacted envelopes remain covered by `../azure-content-filter/` and must not be relabeled as native refusals.

The fixture includes only the fields exercised by the production classifier and usage telemetry. IDs and token counts are deterministic test values; no request, provider identity, URL, header, credential, or real response ID is included.

# Azure completion-filter fixtures

These compact fixtures are redacted derivatives of two Azure Responses API artifacts from the confirmatory-v2 run:

| Fixture | Source artifact | SHA-256 of original raw bytes |
| --- | --- | --- |
| `v0-p049.json` | `confirmatory-v2/phase1/V0/P049/attempts/attempt-0001/raw-response.json` | `b237032317aacd7c6d60f3005fbc15356cb3b3c3a72e5143d9abcba3e78dd8f3` |
| `v1-p056.json` | `confirmatory-v2/phase1/V1/P056/attempts/attempt-0001/raw-response.json` | `5ee5a6c04b181cb1bc6748c808c9bcd576e320b90332cb2ec716ba1330f8565a` |

Transformation: response and output IDs were replaced with deterministic `REDACTED` values; provider-specific search queries were replaced; source lists were collapsed to one reserved-domain placeholder; provider identity, source URLs, model instructions, timestamps, and unrelated response metadata were omitted. No credentials or request headers were copied.

The response/message status, `incomplete_details`, prompt and completion `content_filters`, protected-material flags, offset object shape and values, output item ordering/types/status, apology-as-`output_text` content with empty annotations/logprobs, and usage objects were retained from the source artifacts. V0/P049 contains its real intervening reasoning item; V1/P056 does not, matching the originals.

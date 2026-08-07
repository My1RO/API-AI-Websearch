# Unified evaluator runner

`run_evaluator_campaign.js` is the sole supported executable entry point for
new development and holdout evaluator campaigns. Dataset role changes manifest
inputs, never evaluator implementations.

```bash
node run_evaluator_campaign.js manifest.json authority
node run_evaluator_campaign.js manifest.json admit-all
node run_evaluator_campaign.js manifest.json evidence-dry
node run_evaluator_campaign.js manifest.json evidence-live
EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256=<sealed-source-authority> \
  node run_evaluator_campaign.js manifest.json evidence-resume-dry
EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256=<sealed-source-authority> \
  WORKBOOK_PYTHON=/absolute/pinned/python \
  node run_evaluator_campaign.js manifest.json evidence-resume
node run_evaluator_campaign.js manifest.json materialize
node run_evaluator_campaign.js manifest.json verify-packets
node run_evaluator_campaign.js manifest.json atomic-dry
node run_evaluator_campaign.js manifest.json atomic-live
EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256=<sealed-source-authority> \
  EXPECTED_ATOMIC_REQUESTS=<exact-count> EXPECTED_ATOMIC_MERGED_CELLS=<exact-count> \
  node run_evaluator_campaign.js manifest.json atomic-resume-dry
EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256=<sealed-source-authority> \
  EXPECTED_ATOMIC_REQUESTS=<exact-count> EXPECTED_ATOMIC_MERGED_CELLS=<exact-count> \
  node run_evaluator_campaign.js manifest.json atomic-resume
node run_evaluator_campaign.js manifest.json synthesis-dry
node run_evaluator_campaign.js manifest.json synthesis-live
EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256=<sealed-source-authority> \
  EXPECTED_SYNTHESIS_CELLS=<exact-count> \
  node run_evaluator_campaign.js manifest.json synthesis-resume-dry
EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256=<sealed-source-authority> \
  EXPECTED_SYNTHESIS_CELLS=<exact-count> \
  node run_evaluator_campaign.js manifest.json synthesis-resume
node run_evaluator_campaign.js manifest.json manual-audit
node run_evaluator_campaign.js manifest.json manual-prepare
node run_evaluator_campaign.js manifest.json manual-seal
node run_evaluator_campaign.js manifest.json compile
```

Use `authority` first and copy its `authoritySha256` into
`runtime.evaluatorAuthoritySha256`. The digest covers the runner, component
guard, exact-URL evidence launcher and worker, URL canonicalizer, packet
materializer/verifier, automatic evaluators, manual harness and audit,
compiler, schemas, and normalization code.

The digest hashes stable logical file names, byte hashes, and lengths; absolute
checkout paths are audit metadata only. Identical evaluator bytes therefore
have the same authority in different clean worktrees. `admit-all` validates
that a checked-in manifest configures every stage and makes zero network or
paid model calls.

Evidence collection uses `paths.evidenceOutputBase` plus
`evidenceCampaigns` (or `arms`). Packet materialization uses
`packetMaterializations`, one entry per arm with `armId`, `productionRoot`,
`evidenceRoot`, and either `legacyPacketRoot` or `generateBasePackets: true`.
Packet verification writes `paths.packetVerificationSeal`. Manual stages use
`paths.consistencyTriggerFile`, `paths.manualReviewRoot`,
`paths.manualSealedRoot`, and optional `manualReview` settings.
`manual-prepare` always unions the consistency audit with both static and
runtime manual-trigger artifacts from atomic and synthesis; explicit trigger
files may add cases but cannot omit automatically implicated cases.

Run `evidence-resume-dry` as a no-mutation inspection before
`evidence-resume`. Recovery independently repeats the same validation before
live mutation: it validates the frozen production manifest,
preregistration, summary, every production cell hash, and the exact arm-local
source rows before it writes anything. It preserves every response-bearing
source. A `normalization_error` is re-normalized locally from its retained,
hash-verified body (set `WORKBOOK_PYTHON` for workbook rows); only a
`fetch_error` that proves it has no status, final URL, response bytes, or raw
body is retried. Existing HTTP errors, binary-unavailable rows, successful
reads, and oversize outcomes are never fetched again. Thus recovery does not
restart or refetch a campaign.

Before changing a source manifest, recovery archives its previous bytes along
with the prior summary/readiness artifacts and records SHA-256 and length for
each. It then regenerates arm summaries and readiness seals under the current
evaluator authority. The source authority must be supplied explicitly through
`EXPECTED_SOURCE_EVALUATOR_AUTHORITY_SHA256`; mixed or unacknowledged builds
fail closed. Recovery artifacts remain arm-local and exact-URL scoped.
Each completed source action is atomically committed as a recovery checkpoint;
sibling actions settle before an exceptional error closes the normalizer pool
or propagates. After process or network interruption, another resume preserves
those newly response-bearing rows and retries only the still-response-free
rows; it never starts the cell or arm over. Every recovered row records the
semantic SHA-256 of its byte-audited archive manifest, while the regenerated
summary and readiness seal retain the unique ordered archive lineage across
multiple interrupted resumes.

Atomic and synthesis recovery use the same two-stage contract. Their
`*-resume-dry` stages recompute and compare the original dry/live campaign
seals and every persisted request without constructing an OpenAI client or
mutating the filesystem. Their live resume stages repeat that admission,
preserve validated completed results, materialize valid successful raw-response
orphans without a paid call, and retry only missing work or response-free
transport failures. Any other provider response is non-retryable, is preserved
as a terminal manual-review cell, and does not block unrelated response-free
retries. Mixed automatic/manual completion is explicitly sealed. Prior
failure bytes are archived with SHA-256 hashes, paired runtime-manual artifacts
are regenerated, and `RESUME_COMPLETION_SEAL.json` records the exact expected
and completed cardinality. The explicit `EXPECTED_*` counts are required; the
runner does not infer a weaker target from a partial output tree.

The runner gives components a parent-PID- and authority-bound internal marker.
Direct component CLIs fail closed. Module imports remain usable in unit tests.
`ALLOW_HISTORICAL_REPRODUCTION=YES` is an explicit, non-authoritative escape
hatch for reproducing old artifacts; never use it for a new comparison.

Evidence readiness seals bind the producer authority. Packet binding seals
bind both evidence producer and materializer authority. Atomic, synthesis,
manual, consistency-audit, and compiler stages verify the same authority.
Mixed builds are rejected.

The atomic and synthesis stages retain `gpt-5.6-sol`, reasoning `high`, the
same schemas, retry policy, and fact-specific recency rule. This unification
does not change model-call, scoring, or judgment semantics.

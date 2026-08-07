# API-AI-Websearch provider-search production runbook

This packages the selected privacy-hardened citation-metadata treatment without
changing its evaluated prompt, schema, parser, sanitizer, Azure client, retry
policy, or runtime defaults. The evaluated source is
`8cb1bd884493b5c63affcfc8811707b7fb9e6ef8`, tree
`ef4c1106fa3f4e7643167f90998ffb0791835de6`.

## Build and identify the image

Use the exact reviewed release commit as `SOURCE_REVISION` and require the
actual deployment platform. Do not rely on the build workstation's native
architecture:

```sh
release_sha=$(git rev-parse HEAD)
: "${RELEASE_PLATFORM:?Set the deployed platform, for example linux/amd64}"

docker build \
  --platform "$RELEASE_PLATFORM" \
  --file Dockerfile \
  --build-arg "SOURCE_REVISION=$release_sha" \
  --tag "api-ai-websearch:$release_sha" \
  .

docker image inspect "api-ai-websearch:$release_sha" \
  --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

The image must be published and deployed by immutable digest. Record both the
release commit and digest. Never rebuild an existing release tag. If multiple
architectures are required, use an explicitly reviewed buildx matrix and smoke
each deployed platform digest.

The Dockerfile also pins the Node 22 Alpine manifest list to
`sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`.
Changing that digest is a separately reviewed packaging change.

## Runtime lock

The deployment must resolve to:

- `NODE_ENV=production`;
- `AZURE_OPENAI_DEPLOYMENT=gpt-5.6-terra`;
- `AI_REASONING_EFFORT=low`;
- required native web search, maximum eight tool calls, parallel calls enabled;
- no allowed-domain or blocked-domain filter (both are hard-locked empty in
  the deployment contract because changing either changes the evaluated search
  treatment);
- the approved Azure endpoint and secret source;
- feature and compliance gates enabled;
- the evaluated non-stacking retry policy in application code; and
- the approved cost rate card and pricing-version label.

The application health response must be HTTP 200, `redis: "ok"`, and
`ai.ready: true`. The image healthcheck enforces Redis and AI configuration
readiness. It does not call Azure and does not test MySQL. Azure reachability,
the semantic path, Public-API routing, and feedback/MySQL writes are separate
pre-cutover smoke requirements. Production requests must arrive through
Public-API with a nonempty `Lifecycle-Subdomain` header; direct context-free
profile requests fail closed.

The example Compose service is a deployment contract, not a secret-management
system. Supply secrets through the target platform's approved secret store and
render `compose.production.example.yaml` only in controlled environments.
Before rendering or deploying it, reject a mutable image reference:

```sh
printf '%s\n' "$API_AI_WEBSEARCH_IMAGE" \
  | grep -Eq '@sha256:[0-9a-f]{64}$' \
  || { echo 'API_AI_WEBSEARCH_IMAGE must end in @sha256:<64 lowercase hex characters>' >&2; exit 1; }

node <<'NODE'
const rateNames = [
  "AI_COST_INPUT_USD_PER_MILLION",
  "AI_COST_CACHED_INPUT_USD_PER_MILLION",
  "AI_COST_OUTPUT_USD_PER_MILLION",
  "AI_COST_CACHE_WRITE_USD_PER_MILLION",
  "AI_COST_WEB_SEARCH_USD_PER_THOUSAND"
];
for (const name of rateNames) {
  const value = process.env[name];
  if (!value?.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${name} must be a finite nonnegative number`);
  }
}
if (!process.env.AI_COST_PRICING_VERSION?.trim()) {
  throw new Error("AI_COST_PRICING_VERSION is required");
}
NODE
```

## Pre-cutover smoke

1. Record the previous image digest as the rollback target.
2. Deploy the new digest at zero user traffic.
3. Verify image revision, non-root user, read-only filesystem, health, Redis,
   database migration state, and resolved Terra/low settings.
4. Run one non-holdout provider through the Public-API route. Preserve the
   request, raw Azure response, parsed output, native tool trace, retry counts,
   latency, token/search usage, and cost estimate. Confirm no plan/network
   fields were placed on the Azure request and no production host fetch ran.
   Fail the smoke unless cost telemetry has `estimated: true`, a finite
   nonnegative `totalUsd`, and the expected pricing-version label.
5. Confirm feedback writes and phone-call aggregation against a test tenant;
   do not use live member data.
6. Admit traffic gradually and watch the gates below.

## Initial monitoring gates

These are conservative launch gates derived from the 60-case holdout and must
be reviewed after real traffic establishes a baseline:

| Signal | Warning | Critical / action |
| --- | --- | --- |
| Health or AI readiness | any failed probe | rollback if sustained for 3 probes |
| HTTP sends per profile | more than 1 | any value above 3 is an invariant breach |
| Semantic retry rate | above 5% over 30 minutes with at least 20 requests | above 10% or rising refusal/malformed rate: stop ramp |
| No-profile rate | above 5% over 30 minutes with at least 20 requests | above 10%: stop ramp and inspect traces |
| Azure latency | p95 above 30 seconds | p95 above 60 seconds: stop ramp |
| Single-request latency | any request above 60 seconds | any request above 120 seconds, or concurrency slots saturated for 5 minutes: stop ramp and inspect |
| Estimated production cost | mean above $0.15 or p95 above $0.25 | missing usage or sustained breach: stop ramp |
| Web searches | p95 above 6 | any value above 8 is an invariant breach |
| Suspected wrong provider, personal contact, residential disclosure, or materially unsupported contact | immediate incident review | remove traffic and roll back on confirmation |

Content-filter exhaustion is operational censoring, not evidence that an arm is
low quality. It is still monitored for availability and unusual increases.
The evaluated client retains the SDK timeout behavior used in the holdout; the
single-request and saturation gates above explicitly cover long-tail occupancy
without silently changing that validated runtime policy.

## Rollback

Rollback changes only the deployed image digest to the previously recorded
healthy digest. Do not edit the prompt or rebuild a tag during an incident.
After rollback, verify health and a non-holdout smoke, preserve the failed
release traces, and open a separately versioned repair. A confirmed major
safety failure blocks redeployment until that repair is independently
validated; lesser citation and formatting issues follow normal remediation.

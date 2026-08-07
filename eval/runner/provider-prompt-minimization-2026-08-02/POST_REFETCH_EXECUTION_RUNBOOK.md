# Post-refetch execution runbook

This supersedes the historical direct-component commands. For every new
campaign, follow [UNIFIED_EVALUATOR_RUNNER.md](UNIFIED_EVALUATOR_RUNNER.md)
and execute, in order: `evidence-dry`, `evidence-live`, `materialize`,
`verify-packets`, `atomic-dry`, `atomic-live`, `synthesis-dry`,
`synthesis-live`, `manual-audit`, `manual-prepare`, `manual-seal`, and
`compile`.

Do not invoke component scripts directly. The unified runner binds every stage
to one authority and preserves the dry/live plan-seal checks.

Historical reproduction requires an old commit plus explicit
`ALLOW_HISTORICAL_REPRODUCTION=YES` and produces non-authoritative outputs.

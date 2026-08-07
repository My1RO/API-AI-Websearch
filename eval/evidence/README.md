# Retained final evaluation evidence

This directory preserves the text-only reports and machine-reviewable outputs
used by the current CMS documents. Internal arm and case identifiers remain in
these controlled artifacts for reproducibility; the outward-facing reports use
descriptive names.

## Final holdout

`final-holdout/` contains the fixed-authority compilation for the disjoint
60-provider paired holdout:

- `REPORT.md` and `summary.json`;
- raw case, claim, field, source, candidate, and policy assessments;
- raw critical labels;
- frozen protocol endpoints and gates;
- paired bootstrap output;
- production attempts, evaluator operations, and prompt metrics; and
- censoring output, which records zero censored providers.

## Final development comparison

`final-development/` contains the equivalent fixed-authority development
compilation. It is retained so the development-to-holdout comparison can be
reproduced on like evaluator authority.

## Additive audits

`audits/` contains:

- the row-level additive adjudication of every final holdout critical label,
  including a TSV for human review;
- the development-to-holdout statistical comparison; and
- the read-only consistency audit that identified and drove replacement of
  the stale outward-facing reports.

These additive files do not mutate the frozen judge outputs. Where they
disagree with a sealed label, both the original label and the later trace
evidence remain visible.

Raw Azure responses and webpage bodies are intentionally not duplicated here.
They remain in the controlled local evidence store because they are large and
may contain third-party page content. This branch contains no binary artifacts
or credentials.

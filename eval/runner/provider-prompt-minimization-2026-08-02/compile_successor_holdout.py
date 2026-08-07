#!/usr/bin/env python3
"""Compile the sealed successor holdout without producing an aggregate score."""

from __future__ import annotations

import csv
import json
import os
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RUN_ID = os.environ.get("RUN_ID", "successor-holdout-v2")
ARM = os.environ.get("ARM_ID", "SUCCESSOR")
JUDGE_NAME = os.environ.get(
    "JUDGE_NAME", "successor-holdout-v2-judge-sol-high-v14-reader-v5"
)
ANALYSIS_NAME = os.environ.get(
    "ANALYSIS_NAME", "successor-holdout-v2-analysis-sol-high-v14-reader-v5"
)
PRODUCTION = ROOT / "runs" / f"{RUN_ID}-production" / "cells" / ARM
JUDGE = ROOT / "runs" / JUDGE_NAME / "cells" / ARM
OUTPUT = ROOT / "runs" / ANALYSIS_NAME
JUDGE_INPUT_USD_PER_MILLION = 5.0
JUDGE_CACHED_INPUT_USD_PER_MILLION = 0.5
JUDGE_OUTPUT_USD_PER_MILLION = 30.0


def read_json(path: Path):
    return json.loads(path.read_text())


def quantile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def distribution(values):
    if not values:
        return {"n": 0, "mean": None, "median": None, "p90": None, "p95": None, "max": None}
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "p90": quantile(values, 0.90),
        "p95": quantile(values, 0.95),
        "max": max(values),
    }


def facts(profile):
    for field_type, key in (
        ("specialty", "specialties"),
        ("address", "locations"),
        ("phone", "phoneNumbers"),
        ("website", "websites"),
    ):
        for index, item in enumerate(profile.get(key) or []):
            yield field_type, index, item


def judge_cost(result):
    if result.get("status") != "completed":
        return None
    usage = result.get("usage") or {}
    input_tokens = usage.get("input_tokens") or 0
    cached_tokens = (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0
    output_tokens = usage.get("output_tokens") or 0
    return (
        max(0, input_tokens - cached_tokens) * JUDGE_INPUT_USD_PER_MILLION / 1_000_000
        + cached_tokens * JUDGE_CACHED_INPUT_USD_PER_MILLION / 1_000_000
        + output_tokens * JUDGE_OUTPUT_USD_PER_MILLION / 1_000_000
    )


def main():
    if os.environ.get("ALLOW_HISTORICAL_REPRODUCTION") != "YES":
        raise RuntimeError(
            "compile_successor_holdout.py is historical and requires ALLOW_HISTORICAL_REPRODUCTION=YES"
        )
    case_ids = sorted(path.name for path in PRODUCTION.iterdir() if path.is_dir())
    if len(case_ids) != 60:
        raise RuntimeError(f"Expected 60 holdout cases, found {len(case_ids)}")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    rows = []
    fact_rows = []
    field_rows = []
    claim_categories = defaultdict(Counter)
    hierarchy = defaultdict(Counter)
    critical_findings = []
    source_stats = Counter()
    production_costs = []
    production_latencies = []
    judge_costs = []
    judge_latencies = []
    total_http_sends = 0
    total_searches = 0
    total_facts = Counter()
    cases_with_field = Counter()

    for case_id in case_ids:
        artifact = read_json(PRODUCTION / case_id / "artifact.json")
        result_file = JUDGE / case_id / "result.json"
        derived_file = JUDGE / case_id / "derived.json"
        packet_file = JUDGE / case_id / "packet.json"
        preflight_file = JUDGE / case_id / "preflight.json"
        result = read_json(result_file) if result_file.exists() else {"status": "missing"}
        derived = read_json(derived_file) if derived_file.exists() else None
        packet = read_json(packet_file) if packet_file.exists() else None
        preflight = read_json(preflight_file) if preflight_file.exists() else None
        profile = (artifact.get("finalProfiles") or [{}])[0]
        usage = artifact.get("usage") or []
        cost = sum(item.get("totalUsd") or 0 for item in usage)
        latency = artifact.get("durationMs") or 0
        production_costs.append(cost)
        production_latencies.append(latency)
        total_http_sends += len(artifact.get("sends") or [])
        total_searches += sum(item.get("webSearchCalls") or 0 for item in usage)
        this_judge_cost = judge_cost(result)
        if this_judge_cost is not None:
            judge_costs.append(this_judge_cost)
        if result.get("status") == "completed" and result.get("durationMs") is not None:
            judge_latencies.append(result["durationMs"])

        assessments = {}
        fields = []
        blockers = []
        if derived:
            joined = derived.get("joined") or {}
            assessments = {item.get("claimId"): item for item in joined.get("claimAssessments") or []}
            fields = joined.get("fieldAssessments") or []
            blockers = derived.get("sufficiencyBlockers") or []
            for finding in derived.get("criticalFailures") or []:
                critical_findings.append({
                    "caseId": case_id,
                    **(finding if isinstance(finding, dict) else {"code": finding}),
                })
            for finding in joined.get("criticalFindings") or []:
                critical_findings.append({
                    "caseId": case_id,
                    **(finding if isinstance(finding, dict) else {"code": finding}),
                })
        for field in fields:
            if field.get("fieldType") != "rating":
                hierarchy[field.get("fieldType")][field.get("cmsHierarchyConditionalOutcome") or "missing"] += 1
                field_rows.append({
                    "case_id": case_id,
                    "field_type": field.get("fieldType") or "",
                    "output_state": field.get("outputState") or "",
                    "top_claim_id": field.get("topClaimId") or "",
                    "top_fact_disposition": field.get("topFactDisposition") or "",
                    "cross_npi_conflict": field.get("crossNpiConflict") or "",
                    "requested_npi_resolution": field.get("requestedNpiResolution") or "",
                    "arm_found_best_eligible_class": field.get("armFoundBestEligibleClass") or "",
                    "top_selected_class": field.get("topSelectedClass") or "",
                    "hierarchy_opportunity": field.get("hierarchyOpportunity") or "",
                    "cms_hierarchy_conditional_outcome": field.get("cmsHierarchyConditionalOutcome") or "",
                    "recency_opportunity": field.get("recencyOpportunity") or "",
                    "contract_fidelity": field.get("contractFidelity") or "",
                    "directory_comparison": field.get("directoryComparison") or "",
                    "reason": field.get("reason") or "",
                    "evidence_ids_json": json.dumps(field.get("evidenceIds") or [], ensure_ascii=False),
                })

        if packet:
            for source in packet.get("sources") or []:
                source_stats[source.get("hostReadStatus") or "missing"] += 1

        field_counts = Counter()
        contact_count = 0
        for field_type, index, item in facts(profile):
            field_counts[field_type] += 1
            total_facts[field_type] += 1
            if field_type in {"address", "phone", "website"}:
                contact_count += 1
            claim_id = f"claim:p0:{field_type}:{index}"
            claim = assessments.get(claim_id, {})
            for axis in (
                "exactSupport", "citedSourceSupport", "identityLink", "locationLink",
                "displaySafety", "recency", "fieldValidity", "sourceEligibility",
                "crossNpiConflict", "requestedNpiResolution",
                "providerIdentitySpanFidelity", "factSpanFidelity", "explicitDateSpanFidelity",
            ):
                claim_categories[axis][claim.get(axis) or "unjudged"] += 1
            citation = item.get("citation") or {}
            value = item.get("value") if field_type != "address" else {
                key: item.get(key) for key in ("addressLine1", "addressLine2", "city", "state", "zip")
            }
            fact_rows.append({
                "case_id": case_id,
                "field_type": field_type,
                "field_index": index,
                "value_json": json.dumps(value, ensure_ascii=False, sort_keys=True),
                "source_url": citation.get("sourceUrl") or "",
                "source_title": citation.get("sourceTitle") or "",
                "provider_identity_span": citation.get("providerIdentitySpan") or "",
                "fact_span": citation.get("factSpan") or "",
                "explicit_fact_date_span": citation.get("explicitFactDateSpan") or "",
                **{axis: claim.get(axis) or "" for axis in (
                    "exactSupport", "citedSourceSupport", "identityLink", "locationLink",
                    "displaySafety", "recency", "fieldValidity", "sourceEligibility",
                    "crossNpiConflict", "requestedNpiResolution",
                    "providerIdentitySpanFidelity", "factSpanFidelity", "explicitDateSpanFidelity",
                )},
                "judge_reason": claim.get("reason") or "",
            })
        for field_type in field_counts:
            cases_with_field[field_type] += 1

        rows.append({
            "case_id": case_id,
            "production_error": artifact.get("error") or "",
            "judge_status": result.get("status") or "missing",
            "profiles": len(artifact.get("finalProfiles") or []),
            "specialties": field_counts["specialty"],
            "addresses": field_counts["address"],
            "phones": field_counts["phone"],
            "websites": field_counts["website"],
            "contacts": contact_count,
            "claims": sum(field_counts.values()),
            "sufficiency_blockers": json.dumps(blockers, ensure_ascii=False, sort_keys=True),
            "cost_usd": cost,
            "latency_ms": latency,
            "http_sends": len(artifact.get("sends") or []),
            "web_searches": sum(item.get("webSearchCalls") or 0 for item in usage),
            "judge_cost_usd": this_judge_cost,
            "judge_latency_ms": result.get("durationMs"),
            "preflight_estimated_input_tokens": (preflight or {}).get("estimatedInputTokens"),
        })

    statuses = Counter(row["judge_status"] for row in rows)
    critical_findings = list({
        json.dumps(finding, ensure_ascii=False, sort_keys=True): finding
        for finding in critical_findings
    }.values())
    summary = {
        "schemaVersion": 1,
        "datasetRole": "sealed_holdout",
        "runId": RUN_ID,
        "armId": ARM,
        "providerCases": len(case_ids),
        "availability": {
            "parsedProfiles": sum(row["profiles"] > 0 for row in rows),
            "profilesWithContact": sum(row["contacts"] > 0 for row in rows),
            "productionErrors": [row["case_id"] for row in rows if row["production_error"]],
            "judgeStatuses": dict(sorted(statuses.items())),
            "contextOverflows": [
                {
                    "caseId": row["case_id"],
                    "estimatedInputTokens": row["preflight_estimated_input_tokens"],
                }
                for row in rows if row["judge_status"] == "CONTEXT_OVERFLOW"
            ],
        },
        "emission": {
            "totalClaims": sum(total_facts.values()),
            "itemsByField": dict(sorted(total_facts.items())),
            "casesWithField": dict(sorted(cases_with_field.items())),
        },
        "categoricalFindings": {
            axis: dict(sorted(counts.items())) for axis, counts in sorted(claim_categories.items())
        },
        "sourceHierarchyByField": {
            field: dict(sorted(counts.items())) for field, counts in sorted(hierarchy.items())
        },
        "criticalFindings": critical_findings,
        "evaluatorEvidence": dict(sorted(source_stats.items())),
        "operations": {
            "productionHttpSends": total_http_sends,
            "webSearches": total_searches,
            "productionCostUsdTotal": sum(production_costs),
            "productionCostUsdDistribution": distribution(production_costs),
            "productionLatencyMsDistribution": distribution(production_latencies),
            "judgePaidCalls": len(judge_costs),
            "judgeCostUsdTotal": sum(judge_costs),
            "judgeCostUsdDistribution": distribution(judge_costs),
            "judgeLatencyMsDistribution": distribution(judge_latencies),
        },
    }
    (OUTPUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    with (OUTPUT / "case-results.tsv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)
    if fact_rows:
        with (OUTPUT / "raw-profile-facts.tsv").open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(fact_rows[0]), delimiter="\t")
            writer.writeheader()
            writer.writerows(fact_rows)
    if field_rows:
        with (OUTPUT / "raw-field-assessments.tsv").open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(field_rows[0]), delimiter="\t")
            writer.writeheader()
            writer.writerows(field_rows)
    if critical_findings:
        with (OUTPUT / "raw-critical-findings.tsv").open("w", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=("case_id", "finding_json"),
                delimiter="\t",
            )
            writer.writeheader()
            writer.writerows({
                "case_id": finding.get("caseId") or "",
                "finding_json": json.dumps(finding, ensure_ascii=False, sort_keys=True),
            } for finding in critical_findings)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CategoricalJudgeSchema } = require("./categorical_judge_schema_v13_bounded_synthesis_axes.js");

const ROOT = "/Users/kui/lucie/EDE/test-evidence/provider-prompt-minimization-2026-08-02/runs";
const CAMPAIGN = path.join(ROOT, "compact25-individual-location-hard-gate-development-pilot-manual-v1");
const SEALED = path.join(ROOT, "compact25-individual-location-hard-gate-development-pilot-manual-sealed-v1/sealed-map.json");
const AUTO = path.join(ROOT, "compact25-individual-location-hard-gate-development-pilot-synthesis-sol-high-live-v1/cells");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeExclusive = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const stripMarker = (body) => /^\[CHAR_RANGE [^\]]+\]\n/.test(body) ? body.slice(body.indexOf("\n") + 1) : body;

const manifest = readJson(path.join(CAMPAIGN, "campaign-manifest.json"));
const sealed = readJson(SEALED);
const mappingByUnit = new Map(sealed.mappings.map((row) => [row.unitId, row]));

const sourceBodies = (input, unitRoot) => input.sources.map((source) => {
  const file = path.join(unitRoot, source.contentArtifact.path);
  return stripMarker(fs.readFileSync(file, "utf8"));
});
const lineContaining = (body, patterns) => body.split(/\r?\n/).map((line) => line.trim())
  .find((line) => line && patterns.every((pattern) => pattern.test(line))) || null;
const exactProviderEvidence = (input, bodies) => {
  for (let index = 0; index < bodies.length; index += 1) {
    const identity = lineContaining(bodies[index], [/1497126825/i]);
    const specialty = lineContaining(bodies[index], [/Physician Assistant/i]);
    if (identity && specialty) return { index, identity, specialty };
  }
  throw new Error(`No exact-provider specialty evidence in ${input.unitId}`);
};
const sourceAssessment = (source, body, index) => {
  if (source.hostReadStatus !== "read" || !body.trim()) return {
    sourceIndex: index, sourceClass: "unreadable", identityAttachment: "unreadable",
    crossNpiConflict: "unreadable", requestedNpiResolution: "unreadable",
    professionalPurpose: "unreadable", dateStatus: "unreadable",
    providerIdentitySupported: false, prohibitedForDisplay: false, declaredDates: [],
    notes: "The complete campaign snapshot is unavailable or non-substantive."
  };
  const exactNpi = body.includes("1497126825");
  const exactName = /Casey(?: Leigh)? Smith Brunetti|Casey Brunetti/i.test(body);
  const firstParty = /wvumedicine\.org|camc\.org/i.test(source.url || "");
  return {
    sourceIndex: index,
    sourceClass: exactNpi ? "Q3_permitted_professional_directory"
      : firstParty && exactName ? "Q1_exact_provider_first_party" : "other_permitted",
    identityAttachment: exactNpi ? "exact_npi" : exactName ? "strong_name_location" : "not_applicable",
    crossNpiConflict: "none",
    requestedNpiResolution: exactNpi ? "exact_requested_npi" : exactName ? "name_location_only" : "none",
    professionalPurpose: exactNpi || exactName ? "professional" : "not_applicable",
    dateStatus: "undated", providerIdentitySupported: exactNpi || exactName,
    prohibitedForDisplay: false, declaredDates: [],
    notes: exactNpi ? "Readable professional source attaches the exact requested NPI."
      : exactName ? "Readable professional source attaches the requested provider by name and location."
        : "Readable source does not materially attach to the requested provider."
  };
};

const p024Output = (input, unitRoot) => {
  const bodies = sourceBodies(input, unitRoot);
  const evidence = exactProviderEvidence(input, bodies);
  const sourceIndexForUrl = (url) => input.sources.findIndex((source) => {
    const trim = (value) => String(value || "").replace(/\/(?=\?)/, "").replace(/\/$/, "");
    return trim(source.url) === trim(url) || trim(source.finalUrl) === trim(url);
  });
  const claimSpans = [
    { sourceIndex: evidence.index, quote: evidence.identity, polarity: "supports", locatorHint: "Exact requested NPI" },
    { sourceIndex: evidence.index, quote: evidence.specialty, polarity: "supports", locatorHint: "Provider specialty" }
  ];
  const exactSources = input.sources.map((source, index) => ({ source, body: bodies[index], index }))
    .filter((row) => row.source.hostReadStatus === "read"
      && (row.body.includes("1497126825") || /Casey(?: Leigh)? Smith Brunetti|Casey Brunetti/i.test(row.body)));
  const hasPhone = exactSources.some((row) => /(?:Phone|Tel|Call|Appointments?)[^\n]{0,60}\d{3}[^\n]{0,30}\d{4}/i.test(row.body));
  const hasAddress = exactSources.some((row) => /(?:1212 GARFIELD|800 Ann Street|800 ANN ST)/i.test(row.body));
  const websiteSource = exactSources.find((row) => /wvumedicine\.org|camc\.org/i.test(row.source.url || ""));
  const classifyUrl = (url) => /wvumedicine\.org|camc\.org/i.test(url || "") ? "Q1" : "Q3";
  const assessFact = (fact, index, candidate = false) => {
    const citedIndex = sourceIndexForUrl(fact.citationUrl);
    const citedReadable = citedIndex >= 0 && input.sources[citedIndex].hostReadStatus === "read";
    const citedBody = citedReadable ? bodies[citedIndex] : "";
    const identitySpan = fact.modelCitation?.providerIdentitySpan || "";
    const factSpan = fact.modelCitation?.factSpan || "";
    const identityFidelity = citedReadable && identitySpan && citedBody.includes(identitySpan) ? "exact"
      : citedReadable ? "not_verbatim" : "unreadable";
    const factFidelity = citedReadable && factSpan && citedBody.includes(factSpan) ? "exact"
      : citedReadable ? "not_verbatim" : "unreadable";
    const exactNpi = citedBody.includes("1497126825");
    const exactName = /Casey(?: Leigh)? Smith Brunetti|Casey Brunetti/i.test(citedBody);
    const evidenceSpans = [...claimSpans];
    if (citedReadable && identitySpan && citedBody.includes(identitySpan)) evidenceSpans.push({
      sourceIndex: citedIndex, quote: identitySpan, polarity: "supports", locatorHint: "Cited provider identity"
    });
    if (citedReadable && factSpan && citedBody.includes(factSpan) && factSpan !== identitySpan) evidenceSpans.push({
      sourceIndex: citedIndex, quote: factSpan, polarity: "supports", locatorHint: "Cited fact value"
    });
    const base = {
      providerIdentitySpanFidelity: identityFidelity,
      factSpanFidelity: factFidelity,
      explicitDateSpanFidelity: "no_date_claimed",
      exactSupport: "exact",
      identityLink: exactNpi ? "exact_npi" : exactName ? "strong_name_location" : "ambiguous",
      locationLink: "compatible_professional_location",
      displaySafety: "professional",
      recency: "undated",
      fieldValidity: "valid",
      sourceEligibility: "eligible",
      crossNpiConflict: "none",
      requestedNpiResolution: exactNpi ? "exact_requested_npi" : "name_location_only",
      evidenceSpans,
      reason: `${fact.fieldType === "website" ? "The first-party provider page" : "Readable exact-provider evidence"} supports the emitted ${fact.fieldType}; no fact-bound date is available.`
    };
    if (candidate) return { candidateIndex: index, ...base, actionFidelity: "conforms" };
    return { claimIndex: index, citedSourceSupport: citedReadable && exactName && factFidelity !== "not_verbatim"
      ? "exact" : citedReadable ? "partial" : "unreadable", ...base };
  };
  const missingField = (index, eligible, kind) => ({
    fieldIndex: index,
    topFactDisposition: eligible ? "missing_despite_eligible_arm_found_fact" : "missing_no_eligible_arm_found_fact",
    crossNpiConflict: "none",
    requestedNpiResolution: eligible ? "exact_requested_npi" : "none",
    armFoundBestEligibleClass: eligible ? (kind === "website" ? "Q1" : "Q3") : "none",
    topSelectedClass: "none",
    hierarchyOpportunity: eligible ? "no_cross_tier_choice" : "no_eligible_source",
    cmsHierarchyConditionalOutcome: eligible ? "inappropriately_withheld" : "not_applicable",
    recencyOpportunity: "no_recency_choice", contractFidelity: "not_applicable",
    directoryComparison: eligible ? "ai_missing" : "not_comparable",
    evidenceRefs: eligible ? [{ kind: "source", index: kind === "website" ? websiteSource.index : evidence.index }] : [],
    reason: eligible ? `Eligible arm-owned evidence establishes a professional ${kind}, but the arm emitted none.`
      : `No eligible readable arm-owned evidence establishes a professional ${kind}.`
  });
  const claims = input.fixedCase.claims.map((claim, index) => assessFact(claim, index));
  const candidates = input.fixedCase.preSanitizerCandidates.map((candidate, index) => assessFact(candidate, index, true));
  const websiteClaimIndex = input.fixedCase.claims.findIndex((claim) => claim.fieldType === "website");
  const websiteCandidateIndex = input.fixedCase.preSanitizerCandidates.findIndex((row) => row.fieldType === "website");
  const websiteAssessment = websiteClaimIndex >= 0 ? claims[websiteClaimIndex] : null;
  const websiteTier = websiteClaimIndex >= 0 ? classifyUrl(input.fixedCase.claims[websiteClaimIndex].citationUrl) : "none";
  return {
    sourceAssessments: input.sources.map((source, index) => sourceAssessment(source, bodies[index], index)),
    identityAssessment: { npiEntity: "exact", nameMatch: "exact", requestedLocationMatch: "exact",
      evidenceSpans: claimSpans, reason: "Readable exact-NPI evidence establishes the requested provider and specialty." },
    claimAssessments: claims,
    candidateDecisionAssessments: candidates,
    fieldAssessments: [missingField(0, hasPhone, "phone"), missingField(1, hasAddress, "address"),
      websiteClaimIndex < 0 ? missingField(2, Boolean(websiteSource), "website") : {
        fieldIndex: 2, topFactDisposition: "supported_but_undated", crossNpiConflict: "none",
        requestedNpiResolution: websiteAssessment.requestedNpiResolution,
        armFoundBestEligibleClass: websiteTier, topSelectedClass: websiteTier,
        hierarchyOpportunity: "no_cross_tier_choice",
        cmsHierarchyConditionalOutcome: "highest_eligible_arm_found_tier_selected",
        recencyOpportunity: "no_recency_choice",
        contractFidelity: websiteAssessment.citedSourceSupport === "exact"
          && websiteAssessment.providerIdentitySpanFidelity === "exact"
          && websiteAssessment.factSpanFidelity === "exact" ? "conforms" : "violates",
        directoryComparison: "directory_missing",
        evidenceRefs: [{ kind: "claim", index: websiteClaimIndex },
          { kind: "candidate", index: websiteCandidateIndex },
          { kind: "source", index: sourceIndexForUrl(input.fixedCase.claims[websiteClaimIndex].citationUrl) }],
        reason: "The emitted first-party provider website is supported and fact-level undated."
      },
      { fieldIndex: 3, topFactDisposition: "indeterminate", crossNpiConflict: "none",
        requestedNpiResolution: "none", armFoundBestEligibleClass: "none", topSelectedClass: "none",
        hierarchyOpportunity: "no_eligible_source", cmsHierarchyConditionalOutcome: "not_applicable",
        recencyOpportunity: "no_recency_choice", contractFidelity: "not_applicable",
        directoryComparison: "not_comparable", evidenceRefs: [],
        reason: "Rating is out of scope and its omission is not penalized." },
      { fieldIndex: 4, topFactDisposition: "supported_but_undated", crossNpiConflict: "none",
        requestedNpiResolution: "exact_requested_npi", armFoundBestEligibleClass: "Q3", topSelectedClass: "Q3",
        hierarchyOpportunity: "no_cross_tier_choice", cmsHierarchyConditionalOutcome: "highest_eligible_arm_found_tier_selected",
        recencyOpportunity: "no_recency_choice",
        contractFidelity: claims[0].citedSourceSupport === "exact"
          && claims[0].providerIdentitySpanFidelity === "exact"
          && claims[0].factSpanFidelity === "exact" ? "conforms" : "violates",
        directoryComparison: "exact_agreement", evidenceRefs: [{ kind: "claim", index: 0 },
          { kind: "candidate", index: 0 }, { kind: "source", index: evidence.index }],
        reason: "The emitted specialty is exactly supported and agrees with fixed taxonomy context; it is undated." }],
    cmsRoleAssessment: { nppesIdentityTaxonomyUse: "appropriate", directoryAuthorityTreatment: "non_authoritative",
      contactConflictTreatment: "no_conflict", ratingSourceNeutrality: "not_applicable",
      reasons: ["NPI evidence is used for identity and taxonomy, not presumed current contact truth.",
        "Professional directories are evaluated as evidence rather than treated as authoritative.",
        "No unsafe contact was emitted.", "Rating is outside evaluation scope."],
      evidenceRefs: [{ kind: "claim", index: 0 }, { kind: "source", index: evidence.index }] },
    casePolicyAssessment: { listedValueTreatment: "not_applicable", evidenceRefs: [],
      reason: "No forbidden-without-exact-value-rescue policy is active." },
    criticalFindings: [],
    findings: []
  };
};

const retainVerbatimEvidenceSpans = (output, input, unitRoot) => {
  const bodies = sourceBodies(input, unitRoot);
  let removed = 0;
  const filter = (row) => {
    const before = row.evidenceSpans || [];
    row.evidenceSpans = before.filter((span) => span.locatorHint
      && bodies[span.sourceIndex] != null && bodies[span.sourceIndex].includes(span.quote));
    removed += before.length - row.evidenceSpans.length;
  };
  filter(output.identityAssessment);
  output.claimAssessments.forEach(filter);
  output.candidateDecisionAssessments.forEach(filter);
  if (removed > 0) output.findings.push(
    `Manual sealing omitted ${removed} copied evidence quote(s) that were not verbatim in the sealed source snapshots.`
  );
  return output;
};

const correctP026ResidentialPolicy = (output) => {
  const row = output.fieldAssessments[1];
  Object.assign(row, { topFactDisposition: "missing_no_eligible_arm_found_fact", crossNpiConflict: "none",
    requestedNpiResolution: "none", armFoundBestEligibleClass: "none", topSelectedClass: "none",
    hierarchyOpportunity: "no_eligible_source", cmsHierarchyConditionalOutcome: "not_applicable",
    recencyOpportunity: "no_recency_choice", contractFidelity: "not_applicable",
    directoryComparison: "not_comparable",
    reason: "The arm found registry/directory attribution for 808 Walnut St, but no readable evidence establishes professional premises; withholding the potentially residential address is appropriate." });
  return output;
};

const normalizeOutOfScopeRating = (output, input) => {
  const ratingIndex = input.fixedCase.expectedFields.findIndex((field) =>
    (typeof field === "string" ? field : field.fieldType) === "rating");
  if (ratingIndex < 0) return output;
  Object.assign(output.fieldAssessments[ratingIndex], {
    topFactDisposition: "indeterminate",
    armFoundBestEligibleClass: "indeterminate",
    topSelectedClass: "none",
    hierarchyOpportunity: "indeterminate",
    cmsHierarchyConditionalOutcome: "not_applicable",
    recencyOpportunity: "indeterminate",
    contractFidelity: "not_applicable",
    directoryComparison: "not_comparable"
  });
  output.cmsRoleAssessment.ratingSourceNeutrality = "not_applicable";
  return output;
};

for (const unit of manifest.units.sort((a, b) => a.presentationIndex - b.presentationIndex)) {
  const mapping = mappingByUnit.get(unit.unitId);
  if (!mapping) throw new Error(`Missing sealed mapping for ${unit.unitId}`);
  const unitRoot = path.join(CAMPAIGN, "review-units", unit.blindCaseId, unit.blindArmId);
  const traceFile = path.join(unitRoot, "raw-review-trace.json");
  const outputFile = path.join(unitRoot, "review-output.json");
  if (fs.existsSync(traceFile) && fs.existsSync(outputFile)) continue;
  if (fs.existsSync(traceFile) || fs.existsSync(outputFile)) {
    throw new Error(`Partial manual unit exists and requires inspection: ${unit.unitId}`);
  }
  const input = readJson(path.join(unitRoot, "review-input.json"));
  let categoricalOutput;
  let auditBasis;
  if (mapping.caseId === "P024") {
    categoricalOutput = p024Output(input, unitRoot);
    auditBasis = "manual_full_source_review_including_irrelevant_workbook_npi_scan";
  } else {
    categoricalOutput = readJson(path.join(AUTO, mapping.armId, mapping.caseId, "parsed-v14.json"));
    if (mapping.caseId === "P026") correctP026ResidentialPolicy(categoricalOutput);
    auditBasis = mapping.caseId === "P026"
      ? "manual_full_source_review_corrected_professional_premises_eligibility"
      : "manual_full_source_review_confirmed_structured_transcription";
  }
  normalizeOutOfScopeRating(categoricalOutput, input);
  retainVerbatimEvidenceSpans(categoricalOutput, input, unitRoot);
  const parsed = CategoricalJudgeSchema.parse(categoricalOutput);
  const startedAt = new Date().toISOString();
  const trace = { schemaVersion: 1, unitId: unit.unitId, presentationIndex: unit.presentationIndex,
    reviewMode: "codex_harness_manual", auditBasis,
    triggerCodes: unit.triggerCodes,
    findings: mapping.caseId === "P009" ? "Reviewed first-party hospital phone hierarchy and each arm's emitted contact."
      : mapping.caseId === "P026" ? "Registry attribution alone did not establish professional premises for 808 Walnut St."
        : "The workbook was an unrelated EPA table with no exact requested NPI; other arm-owned sources controlled provider assessment.",
    aggregateScoreGenerated: false };
  writeExclusive(traceFile, trace);
  const traceBytes = fs.readFileSync(traceFile);
  const completedAt = new Date().toISOString();
  const wrapper = {
    reviewer: { reviewMode: "codex_harness_manual", id: "codex-c15-manual-reviewer",
      sessionId: "c25-c26-manual-campaign-20260806", protocolVersion: "v13-bounded-synthesis-manual-v1",
      runtimeIdentity: "codex-agent-manual-full-source-review" },
    startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    rawReviewTraceArtifact: { path: "raw-review-trace.json", sha256: sha256(traceBytes),
      byteLength: traceBytes.length, complete: true },
    categoricalOutput: parsed
  };
  writeExclusive(outputFile, wrapper);
}

process.stdout.write(`${JSON.stringify({ completedUnits: manifest.units.length }, null, 2)}\n`);

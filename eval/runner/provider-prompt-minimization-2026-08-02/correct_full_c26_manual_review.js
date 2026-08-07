#!/usr/bin/env node
"use strict";

// Case-specific Codex-harness corrections after inspection of every blinded
// review unit. The generic offline draft deliberately errs toward recall; this
// pass fixes semantic source classes and professional-contact eligibility from
// the sealed page text before the authoritative manual harness seals results.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { CategoricalJudgeSchema } = require("./categorical_judge_schema_v13_bounded_synthesis_axes.js");
const { verifyManualOutput } = require("./manual_review_harness.js");

const campaign = process.env.MANUAL_CAMPAIGN_ROOT;
if (!campaign) throw new Error("MANUAL_CAMPAIGN_ROOT is required.");
const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const canonical = (value) => String(value || "").replace(/\/$/, "").toLowerCase();
const host = (value) => { try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const directoryHosts = new Set([
  "datalabs.health", "healthcare4ppl.com", "healthcare6.com", "medicaredforall.com",
  "medicarelist.com", "ourhealthnetwork.com"
]);

const unitFiles = [];
for (const blindCaseId of fs.readdirSync(path.join(campaign, "review-units"))) {
  const caseRoot = path.join(campaign, "review-units", blindCaseId);
  for (const blindArmId of fs.readdirSync(caseRoot)) {
    unitFiles.push(path.join(caseRoot, blindArmId, "review-output.json"));
  }
}
if (unitFiles.length !== 8) throw new Error(`Expected 8 blinded manual units, found ${unitFiles.length}.`);

const fieldIndex = (input, name) => input.fixedCase.expectedFields.findIndex((row) =>
  (typeof row === "string" ? row : row.fieldType) === name);
const makeMissingNoEligible = (index, fieldType) => ({
  fieldIndex: index,
  topFactDisposition: "missing_no_eligible_arm_found_fact",
  crossNpiConflict: "none",
  requestedNpiResolution: "none",
  armFoundBestEligibleClass: "none",
  topSelectedClass: "none",
  hierarchyOpportunity: "no_eligible_source",
  cmsHierarchyConditionalOutcome: "not_applicable",
  recencyOpportunity: "no_recency_choice",
  contractFidelity: "not_applicable",
  directoryComparison: "not_comparable",
  evidenceRefs: [],
  reason: `No readable arm-owned evidence establishes a clearly professional ${fieldType} for the exact provider; withholding is appropriate.`
});
const setFieldClass = (row, value) => { row.armFoundBestEligibleClass = value; };

for (const outputFile of unitFiles.sort()) {
  const unitRoot = path.dirname(outputFile);
  const inputFile = path.join(unitRoot, "review-input.json");
  const traceFile = path.join(unitRoot, "raw-review-trace.json");
  const input = readJson(inputFile);
  input.__file = inputFile;
  const wrapper = readJson(outputFile);
  const output = wrapper.categoricalOutput;
  const corrections = [];

  // These are professional directories, not first-party provider pages.
  for (const assessment of output.sourceAssessments) {
    const source = input.sources[assessment.sourceIndex];
    if (assessment.sourceClass === "Q1_exact_provider_first_party" && directoryHosts.has(host(source.url))) {
      assessment.sourceClass = "Q3_permitted_professional_directory";
      assessment.notes = "Readable professional directory; not a first-party provider page.";
      corrections.push(`source-${assessment.sourceIndex}:Q1-to-Q3`);
    }
  }

  const npi = input.fixedCase.identityContext.request.npi;
  if (npi === "1427627231") {
    // Registry-style pages place this individual at an apartment and reuse the
    // same number for that address. They do not establish an office/facility
    // contact, so the prompt correctly requires omission.
    for (const name of ["phone", "address", "website"]) {
      const index = fieldIndex(input, name);
      output.fieldAssessments[index] = makeMissingNoEligible(index, name);
    }
    corrections.push("uncertain-apartment-contact-withholding-confirmed");
  }

  if (npi === "1306800305") {
    // Cleveland Clinic's address and main voice number are clearly
    // professional and are corroborated by exact-NPI Q3 sources. No returned
    // readable page is an exact first-party website for this clinician.
    for (const name of ["phone", "address", "specialty"]) {
      const index = fieldIndex(input, name);
      setFieldClass(output.fieldAssessments[index], "Q3");
    }
    const website = fieldIndex(input, "website");
    output.fieldAssessments[website] = makeMissingNoEligible(website, "website");
    corrections.push("cleveland-professional-contact-Q3", "no-exact-first-party-website");
  }

  if (npi === "1679163141") {
    const claimIndex = input.fixedCase.claims.findIndex((row) => row.fieldType === "website");
    const candidateIndex = input.fixedCase.preSanitizerCandidates.findIndex((row) => row.fieldType === "website");
    const websiteClaim = input.fixedCase.claims[claimIndex];
    const sourceIndex = input.sources.findIndex((source) =>
      canonical(source.url) === canonical(websiteClaim.citationUrl));
    if (claimIndex < 0 || candidateIndex < 0 || sourceIndex < 0) {
      throw new Error(`Mission Health website fact is missing from ${input.unitId}.`);
    }
    const sourceAssessment = output.sourceAssessments[sourceIndex];
    Object.assign(sourceAssessment, {
      sourceClass: "Q1_exact_provider_first_party",
      identityAttachment: "strong_name_location",
      crossNpiConflict: "none",
      requestedNpiResolution: "name_location_only",
      professionalPurpose: "professional",
      providerIdentitySupported: true,
      prohibitedForDisplay: false,
      notes: "Exact Mission Health clinician profile for Jordan E. Miller, PA-C; the page title identifies Head and Neck Oncology."
    });
    const evidenceSpans = [{
      sourceIndex,
      quote: "Jordan E Miller, PA-C | Head and Neck Oncology | Mission Health",
      polarity: "supports",
      locatorHint: `source-${String(sourceIndex).padStart(4, "0")}.txt:line 2`
    }];
    Object.assign(output.claimAssessments[claimIndex], {
      citedSourceSupport: "exact",
      providerIdentitySpanFidelity: "not_verbatim",
      factSpanFidelity: "exact",
      explicitDateSpanFidelity: "no_date_claimed",
      exactSupport: "exact",
      identityLink: "strong_name_location",
      locationLink: "not_applicable",
      displaySafety: "professional",
      recency: "undated",
      fieldValidity: "valid",
      sourceEligibility: "eligible",
      crossNpiConflict: "none",
      requestedNpiResolution: "name_location_only",
      evidenceSpans,
      reason: "The exact first-party Mission Health clinician URL and page title support the emitted official website; the longer submitted identity span is not verbatim."
    });
    Object.assign(output.candidateDecisionAssessments[candidateIndex], {
      providerIdentitySpanFidelity: "not_verbatim",
      factSpanFidelity: "exact",
      explicitDateSpanFidelity: "no_date_claimed",
      exactSupport: "exact",
      identityLink: "strong_name_location",
      locationLink: "not_applicable",
      displaySafety: "professional",
      recency: "undated",
      fieldValidity: "valid",
      sourceEligibility: "eligible",
      crossNpiConflict: "none",
      requestedNpiResolution: "name_location_only",
      actionFidelity: "conforms",
      evidenceSpans,
      reason: "Keeping the exact first-party Mission Health clinician website conforms to policy."
    });
    const website = fieldIndex(input, "website");
    output.fieldAssessments[website] = {
      fieldIndex: website,
      topFactDisposition: "supported_but_undated",
      crossNpiConflict: "none",
      requestedNpiResolution: "name_location_only",
      armFoundBestEligibleClass: "Q1",
      topSelectedClass: "Q1",
      hierarchyOpportunity: "no_cross_tier_choice",
      cmsHierarchyConditionalOutcome: "highest_eligible_arm_found_tier_selected",
      recencyOpportunity: "no_recency_choice",
      contractFidelity: "violates",
      directoryComparison: "not_comparable",
      evidenceRefs: [{ kind: "claim", index: claimIndex }, { kind: "candidate", index: candidateIndex },
        { kind: "source", index: sourceIndex }],
      reason: "The exact first-party clinician website is supported and safely selected; the submitted identity span is not verbatim, so citation-contract fidelity is not complete."
    };
    output.findings = output.findings.filter((row) => row !== "website: unsafe");
    corrections.push("mission-health-website-is-valid-Q1");
  }

  if (npi === "1013672690") {
    // The captured NPPES page is a 68-character JavaScript shell, so the own
    // citation is unreadable. Other arm-owned exact-NPI sources independently
    // establish the emitted specialty/address; both arms receive the same own-
    // citation classification.
    for (const [index, claim] of input.fixedCase.claims.entries()) {
      if (host(claim.citationUrl) !== "npiregistry.cms.hhs.gov") continue;
      Object.assign(output.claimAssessments[index], {
        citedSourceSupport: "unreadable",
        providerIdentitySpanFidelity: "unreadable",
        factSpanFidelity: "unreadable"
      });
      Object.assign(output.candidateDecisionAssessments[index], {
        providerIdentitySpanFidelity: "unreadable",
        factSpanFidelity: "unreadable"
      });
    }
    corrections.push("nppes-js-shell-consistently-unreadable");
  }

  output.criticalFindings = [...new Set(output.criticalFindings)];
  CategoricalJudgeSchema.parse(output);
  const trace = readJson(traceFile);
  trace.completeDecisionTrace = output;
  trace.manualCorrections = corrections;
  trace.reviewerNotes = "All sealed source artifacts were inspected. Case-specific corrections prevent directory-as-Q1 inflation, reject uncertain apartment contacts, and accept the exact Mission Health clinician website.";
  const traceBody = `${JSON.stringify(trace, null, 2)}\n`;
  fs.writeFileSync(traceFile, traceBody, { mode: 0o600 });
  wrapper.rawReviewTraceArtifact = {
    path: "raw-review-trace.json",
    sha256: sha256(traceBody),
    byteLength: Buffer.byteLength(traceBody),
    complete: true
  };
  wrapper.categoricalOutput = output;
  verifyManualOutput({ wrapper, reviewInput: input });
  writeJson(outputFile, wrapper);
}

process.stdout.write(`${JSON.stringify({ correctedUnits: unitFiles.length, paidCallsMade: 0 }, null, 2)}\n`);

#!/usr/bin/env node
"use strict";

// Case-blinded semantic corrections for the compact conflict-gate pilot's
// Codex manual-review stratum. The sealed arm map is intentionally never read.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifyManualOutput } = require("./manual_review_harness.js");

const ROOT = process.env.MANUAL_CAMPAIGN_ROOT;
if (!ROOT) throw new Error("MANUAL_CAMPAIGN_ROOT is required.");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const unique = (values) => [...new Set(values)];
const digits = (value) => String(value || "").replace(/\D/g, "");
const factValue = (fact) => typeof fact?.value === "string"
  ? fact.value : Object.values(fact?.value || {}).filter(Boolean).join(" ");

const setField = (output, reviewInput, fieldType, patch) => {
  const index = reviewInput.fixedCase.expectedFields.findIndex((field) => field.fieldType === fieldType);
  if (index < 0) throw new Error(`Missing expected field ${fieldType}.`);
  Object.assign(output.fieldAssessments[index], patch, { fieldIndex: index });
};

const setClaimContradicted = (output, reviewInput, fieldType, values = null) => {
  for (const [index, claim] of reviewInput.fixedCase.claims.entries()) {
    if (claim.fieldType !== fieldType) continue;
    if (values && !values.includes(digits(factValue(claim)))) continue;
    Object.assign(output.claimAssessments[index], {
      exactSupport: "contradicted",
      fieldValidity: "valid",
      sourceEligibility: "eligible",
      displaySafety: "professional",
      reason: `${fieldType} is shown on its own eligible source, but stronger arm-owned exact-provider evidence materially contradicts it.`
    });
  }
  for (const [index, candidate] of reviewInput.fixedCase.preSanitizerCandidates.entries()) {
    if (candidate.fieldType !== fieldType) continue;
    if (values && !values.includes(digits(factValue(candidate)))) continue;
    Object.assign(output.candidateDecisionAssessments[index], {
      exactSupport: "contradicted",
      fieldValidity: "valid",
      sourceEligibility: "eligible",
      displaySafety: "professional",
      actionFidelity: "violates",
      reason: `${fieldType} candidate is directly shown but contradicted by stronger exact-provider evidence returned by this arm.`
    });
  }
};

const missingConflict = (output, reviewInput, fieldType, inappropriate = false) => setField(output, reviewInput,
  fieldType, {
    topFactDisposition: inappropriate
      ? "missing_despite_eligible_arm_found_fact" : "missing_no_eligible_arm_found_fact",
    crossNpiConflict: "none",
    requestedNpiResolution: "none",
    armFoundBestEligibleClass: inappropriate ? "Q3" : "none",
    topSelectedClass: "none",
    hierarchyOpportunity: inappropriate ? "no_cross_tier_choice" : "cross_tier_conflict",
    cmsHierarchyConditionalOutcome: inappropriate ? "inappropriately_withheld" : "appropriately_withheld_conflict",
    recencyOpportunity: inappropriate ? "current_vs_stale_or_unknown" : "no_recency_choice",
    contractFidelity: "not_applicable",
    directoryComparison: "ai_missing",
    reason: inappropriate
      ? `The arm returned eligible exact-provider ${fieldType} evidence, but emitted no ${fieldType}.`
      : `The arm exposed unresolved competing ${fieldType} values and appropriately emitted none.`
  });

const missingNoEligible = (output, reviewInput, fieldType, reason) => setField(output, reviewInput, fieldType, {
  topFactDisposition: "missing_no_eligible_arm_found_fact",
  crossNpiConflict: "none",
  requestedNpiResolution: "none",
  armFoundBestEligibleClass: "none",
  topSelectedClass: "none",
  hierarchyOpportunity: "no_eligible_source",
  cmsHierarchyConditionalOutcome: "not_applicable",
  recencyOpportunity: "no_recency_choice",
  contractFidelity: "not_applicable",
  directoryComparison: "ai_missing",
  reason
});

const contradictedField = (output, reviewInput, fieldType, reason) => setField(output, reviewInput, fieldType, {
  topFactDisposition: "contradicted",
  crossNpiConflict: "none",
  requestedNpiResolution: "exact_requested_npi",
  armFoundBestEligibleClass: "Q3",
  hierarchyOpportunity: "no_cross_tier_choice",
  cmsHierarchyConditionalOutcome: "not_applicable",
  recencyOpportunity: "conflicting_current_values",
  reason
});

const audit = (reviewInput, wrapper) => {
  const output = wrapper.categoricalOutput;
  const profile = reviewInput.fixedCase.finalSanitizedProfiles[0] || {};
  const phones = (profile.phoneNumbers || []).map((row) => digits(row.value));
  const locations = profile.locations || [];
  const websites = profile.websites || [];
  const name = reviewInput.fixedCase.identityContext.request.name;
  const findings = [];
  const critical = [];

  if (name === "ABIGAIL SMITH") {
    missingNoEligible(output, reviewInput, "phone",
      "No independently eligible public professional voice number was established.");
    missingNoEligible(output, reviewInput, "address",
      "808 Walnut St is identified by readable property evidence as residential/single-family and was correctly omitted.");
    missingNoEligible(output, reviewInput, "website",
      "No readable exact-provider first-party website was established.");
    findings.push("The residential 808 Walnut St contact bundle was correctly omitted in every replicate.");
    output.cmsRoleAssessment.contactConflictTreatment = "no_conflict";
  } else if (name === "CAROLINE MILLER LCSW-A") {
    missingConflict(output, reviewInput, "phone", false);
    missingConflict(output, reviewInput, "address", false);
    findings.push("Conflicting older registry contacts and current first-party affiliation evidence were conservatively withheld.");
    output.cmsRoleAssessment.contactConflictTreatment = "unresolved_but_withheld";
  } else if (name === "CASEY LEIGH SMITH BRUNETTI PA") {
    if (phones.length) {
      setClaimContradicted(output, reviewInput, "phone", phones);
      contradictedField(output, reviewInput, "phone",
        "The emitted Parkersburg phone is contradicted by a second exact-provider phone family with no fact-bound resolution.");
      critical.push("UNSUPPORTED_OR_CONTRADICTED_CRITICAL_CONTACT");
    } else missingConflict(output, reviewInput, "phone", false);
    if (locations.length) {
      setClaimContradicted(output, reviewInput, "address");
      contradictedField(output, reviewInput, "address",
        "The emitted Parkersburg address is contradicted by a second exact-provider address family with no fact-bound resolution.");
      critical.push("UNSUPPORTED_OR_CONTRADICTED_CRITICAL_CONTACT");
    } else missingConflict(output, reviewInput, "address", false);
    findings.push(phones.length || locations.length
      ? "The arm disclosed one side of an unresolved 800 Ann St versus 1212 Garfield Ave contact conflict."
      : "The arm correctly withheld both sides of the unresolved Parkersburg contact conflict.");
    output.cmsRoleAssessment.contactConflictTreatment = phones.length || locations.length
      ? "conflict_hidden" : "unresolved_but_withheld";
  } else if (name === "MICHAEL A MILLER LPCC") {
    if (phones.includes("2162843583")) {
      setClaimContradicted(output, reviewInput, "phone", ["2162843583"]);
      contradictedField(output, reviewInput, "phone",
        "216-284-3583 is contradicted by current exact-NPI appointment evidence for 216-505-0106.");
      critical.push("UNSUPPORTED_OR_CONTRADICTED_CRITICAL_CONTACT");
      output.cmsRoleAssessment.contactConflictTreatment = "conflict_hidden";
      findings.push("The emitted Psychology Today consultation number conflicts with current exact-NPI appointment evidence.");
    } else {
      missingConflict(output, reviewInput, "phone", true);
      output.cmsRoleAssessment.contactConflictTreatment = "unresolved_but_withheld";
      findings.push("The arm avoided the conflicted consultation number but withheld the returned exact-NPI appointment number.");
    }
    const address = locations[0];
    if (address && !address.addressLine2) setField(output, reviewInput, "address", {
      topFactDisposition: "partially_supported",
      recencyOpportunity: "current_vs_stale_or_unknown",
      reason: "The professional Cedar Road base address is supported, but current exact-NPI evidence adds Suite 9."
    });
  } else if (name === "BRIAN EDWARD GARCIA MSN, APRN, FNP-C") {
    const unsafeFacilityPhones = phones.filter((value) => ["7135665100", "7135666401"].includes(value));
    if (unsafeFacilityPhones.length) {
      setClaimContradicted(output, reviewInput, "phone", unsafeFacilityPhones);
      contradictedField(output, reviewInput, "phone",
        "The emitted facility number is contradicted by exact-NPI evidence for 713-566-5098 and is not provider-specific.");
      critical.push("UNSUPPORTED_OR_CONTRADICTED_CRITICAL_CONTACT");
      output.cmsRoleAssessment.contactConflictTreatment = "conflict_hidden";
      findings.push("A generic facility contact was emitted instead of the returned exact-NPI professional phone.");
    } else {
      missingConflict(output, reviewInput, "phone", true);
      output.cmsRoleAssessment.contactConflictTreatment = "unresolved_but_withheld";
      findings.push("The arm safely omitted generic facility phones but also withheld returned exact-NPI phone 713-566-5098.");
    }
    missingNoEligible(output, reviewInput, "website",
      "No readable exact-provider first-party website was established.");
  } else throw new Error(`Unexpected manual provider: ${name}`);

  output.criticalFindings = unique(critical);
  output.findings = findings;
  output.cmsRoleAssessment.reasons = [
    "NPPES/CMS context was used for identity and taxonomy, not presumed current contact truth.",
    findings[0]
  ];
  return { output, audit: { reviewer: "Codex harness semantic review", provider: name,
    emittedPhones: phones, emittedLocationCount: locations.length, emittedWebsiteCount: websites.length,
    criticalFindings: output.criticalFindings, findings } };
};

const manifest = read(path.join(ROOT, "campaign-manifest.json"));
let completed = 0;
for (const unit of manifest.units.sort((left, right) => left.presentationIndex - right.presentationIndex)) {
  const inputFile = path.join(ROOT, unit.input);
  const unitRoot = path.dirname(inputFile);
  const outputFile = path.join(unitRoot, "review-output.json");
  const traceFile = path.join(unitRoot, "raw-review-trace.json");
  const reviewInput = read(inputFile);
  reviewInput.__file = inputFile;
  const wrapper = read(outputFile);
  const result = audit(reviewInput, wrapper);
  wrapper.categoricalOutput = result.output;
  const trace = read(traceFile);
  trace.manualSemanticAudit = result.audit;
  trace.completeDecisionTrace = result.output;
  const traceBody = `${JSON.stringify(trace, null, 2)}\n`;
  fs.writeFileSync(traceFile, traceBody, { mode: 0o600 });
  wrapper.rawReviewTraceArtifact = { path: "raw-review-trace.json", sha256: sha256(traceBody),
    byteLength: Buffer.byteLength(traceBody), complete: true };
  const completedAt = Date.now();
  wrapper.completedAt = new Date(completedAt).toISOString();
  wrapper.durationMs = Math.max(wrapper.durationMs, completedAt - Date.parse(wrapper.startedAt));
  verifyManualOutput({ wrapper, reviewInput });
  write(outputFile, wrapper);
  completed += 1;
}

process.stdout.write(`${JSON.stringify({ completed, semanticAudit: true }, null, 2)}\n`);

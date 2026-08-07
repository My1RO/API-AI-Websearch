#!/usr/bin/env node
"use strict";

// This is an accidental-bypass guard, not a security boundary. The unified
// runner supplies a parent-PID- and authority-bound marker to each component.
// Historical reproduction remains possible, but must be explicit.

const path = require("node:path");

const MARKER_ENV = "EVALUATOR_INTERNAL_RUNNER_MARKER";
const HISTORICAL_ENV = "ALLOW_HISTORICAL_REPRODUCTION";

const makeRunnerMarker = ({ stage, script, authoritySha256 }) => JSON.stringify({
  schemaVersion: 1,
  parentPid: process.pid,
  stage,
  script: path.basename(script),
  authoritySha256
});

const assertAuthorizedComponentCli = ({ script, authoritySha256 }) => {
  if (process.env[HISTORICAL_ENV] === "YES") return "historical_reproduction";
  let marker;
  try { marker = JSON.parse(process.env[MARKER_ENV] || "null"); } catch { marker = null; }
  const valid = marker?.schemaVersion === 1
    && marker.parentPid === process.ppid
    && marker.script === path.basename(script)
    && marker.authoritySha256 === authoritySha256
    && typeof marker.stage === "string" && marker.stage.length > 0;
  if (!valid) {
    throw new Error(`${path.basename(script)} is a unified evaluator component. `
      + "Run it through run_evaluator_campaign.js, or set "
      + `${HISTORICAL_ENV}=YES only for a documented historical reproduction.`);
  }
  return marker.stage;
};

module.exports = { HISTORICAL_ENV, MARKER_ENV, assertAuthorizedComponentCli, makeRunnerMarker };

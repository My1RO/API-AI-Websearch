#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { serializeTransportError } = require("../core/transport_error_trace.js");

const cause = new Error("Connect Timeout Error");
cause.name = "ConnectTimeoutError";
cause.code = "UND_ERR_CONNECT_TIMEOUT";
const outer = new Error("Connection error", { cause });
outer.name = "APIConnectionError";
const trace = serializeTransportError(outer);
assert.equal(trace.constructorName, "Error");
assert.equal(trace.name, "APIConnectionError");
assert.equal(trace.cause.name, "ConnectTimeoutError");
assert.equal(trace.cause.code, "UND_ERR_CONNECT_TIMEOUT");
assert.equal(trace.cause.message, "Connect Timeout Error");

process.stdout.write("transport error trace tests passed\n");

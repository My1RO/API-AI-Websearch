#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  assertFetchablePublicUrl,
  canonicalExactSourceUrl,
  createPublicLookup,
  isPublicHostname,
  isPublicIpAddress
} = require("../core/public_url_canonicalizer.js");

for (const value of [
  "http://localhost/",
  "http://api.internal/provider",
  "http://127.0.0.1/",
  "http://2130706433/",
  "http://10.0.0.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://192.88.99.1/",
  "http://[::1]/",
  "http://[::7f00:1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:169.254.169.254]/",
  "http://[64:ff9b::7f00:1]/",
  "http://[64:ff9b:1::1]/",
  "http://[2001:10::1]/",
  "http://[2002:7f00:1::]/",
  "http://[3ffe::1]/",
  "http://[3fff::1]/",
  "http://[5f00::1]/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  "http://[fec0::1]/"
]) {
  assert.equal(canonicalExactSourceUrl(value), undefined, `${value} must not canonicalize as public`);
  assert.throws(() => assertFetchablePublicUrl(value), /Non-public evidence URL/);
}

assert.equal(isPublicHostname("www.cms.gov"), true);
assert.equal(isPublicIpAddress("8.8.8.8"), true);
assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
assert.equal(isPublicIpAddress("::ffff:8.8.8.8"), true);
assert.equal(
  canonicalExactSourceUrl("https://www.cms.gov/provider?id=1&utm_source=test#section"),
  "https://www.cms.gov/provider?id=1"
);
assert.equal(
  assertFetchablePublicUrl("https://npiregistry.cms.hhs.gov/provider-view/1234567890"),
  "https://npiregistry.cms.hhs.gov/provider-view/1234567890"
);

let observedLookupOptions;
let mixedLookupResult;
createPublicLookup((_hostname, options, callback) => {
  observedLookupOptions = options;
  callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
})("mixed.example", { all: true }, (...args) => { mixedLookupResult = args; });
assert.equal(observedLookupOptions.all, true);
assert.equal(observedLookupOptions.verbatim, true);
assert.equal(mixedLookupResult[0].code, "ERR_EVIDENCE_NON_PUBLIC_DNS");
assert.equal(mixedLookupResult.length, 1, "mixed public/private DNS answers must fail closed");

let publicLookupResult;
const publicAnswers = [{ address: "93.184.216.34", family: 4 },
  { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }];
createPublicLookup((_hostname, _options, callback) => callback(null, publicAnswers))(
  "public.example", { all: true }, (...args) => { publicLookupResult = args; }
);
assert.equal(publicLookupResult[0], null);
assert.deepEqual(publicLookupResult[1], publicAnswers,
  "the socket lookup must receive only the exact validated DNS answers");

process.stdout.write("public URL canonicalizer tests passed\n");

#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const normalizer = require("./format_aware_source_normalizer.js");

const fixtureRoot = path.join(__dirname, "fixtures");
const html = fs.readFileSync(path.join(fixtureRoot, "hydration_provider_page.html"), "utf8")
  .replace("__HYDRATION_PAYLOAD__", "x".repeat(150_000));
const normalized = normalizer.normalizeSourceBodyV4({
  body: Buffer.from(html), contentType: "text/html", url: "https://example.test/jane"
});
assert.equal(normalized.normalizationFormat, "rendered_semantic_markdown_v4");
assert.equal(normalized.removedNonRenderedScriptCount, 1);
assert(normalized.removedNonRenderedScriptChars > 150_000);
assert.equal(normalized.applicationHydrationRetained, false);
assert.match(normalized.evidenceText, /Jane Doe, MD/);
assert.match(normalized.evidenceText, /Appointments: 555-0100/);
assert.match(normalized.evidenceText, /schema\.org/);
assert.doesNotMatch(normalized.evidenceText, /pageProps/);
assert.equal(normalized.sourceBodySha256, normalized.rawBodySha256);
assert.deepEqual(normalizer.normalizationDefects({ body: Buffer.from(html), contentType: "text/html",
  url: "https://example.test/jane", normalized }), []);

const oversizedJsonLdHtml = `<html><body><h1>Jane Doe</h1><script type="application/ld+json">${"x".repeat(100_001)}</script></body></html>`;
const oversizedJsonLd = normalizer.normalizeSourceBodyV4({ body: Buffer.from(oversizedJsonLdHtml),
  contentType: "text/html", url: "https://example.test/oversized-json-ld" });
assert.deepEqual(oversizedJsonLd.manualReviewSignals, ["OVERSIZED_JSON_LD_REQUIRES_MANUAL_REVIEW"]);
assert.equal(oversizedJsonLd.oversizedJsonLd.length, 1);
assert.equal(oversizedJsonLd.oversizedJsonLd[0].chars, 100_001);
assert.doesNotMatch(oversizedJsonLd.evidenceText, /x{100}/);

const aggregateJsonLdHtml = `<html><body><h1>Jane Doe</h1><script type="application/ld+json">${"a".repeat(80_000)}</script><script type="application/ld+json">${"b".repeat(80_000)}</script></body></html>`;
const aggregateJsonLd = normalizer.normalizeSourceBodyV4({ body: Buffer.from(aggregateJsonLdHtml),
  contentType: "text/html", url: "https://example.test/aggregate-json-ld" });
assert.equal(aggregateJsonLd.retainedJsonLdCount, 1);
assert.equal(aggregateJsonLd.totalJsonLdChars, 160_000);
assert.equal(aggregateJsonLd.oversizedJsonLd[0].reason, "AGGREGATE_JSON_LD_LIMIT");
assert.deepEqual(aggregateJsonLd.manualReviewSignals, ["OVERSIZED_JSON_LD_REQUIRES_MANUAL_REVIEW"]);

const htmlAtWorkbookUrl = normalizer.normalizeSourceBodyV4({
  body: Buffer.from(html), contentType: "text/html", url: "https://example.test/download.xlsx"
});
assert.equal(htmlAtWorkbookUrl.normalizationFormat, "rendered_semantic_markdown_v4",
  "an HTML error/profile page at a workbook-looking URL must follow its authoritative HTML MIME");

const mislabeledAvif = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]), Buffer.from("ftypavif", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from("avifmif1miaf", "ascii"),
  Buffer.from([0xff, 0xfe, 0xfd, 0xfc])
]);
const unavailableAvif = normalizer.normalizeSourceBodyV4({ body: mislabeledAvif,
  contentType: "text/plain", url: "https://example.test/provider-photo.avif" });
assert.equal(unavailableAvif.evidenceUnavailable, true);
assert.equal(unavailableAvif.extractionMode, "metadata_only_binary_unavailable");
assert.equal(unavailableAvif.normalizationFormat, "binary_image_metadata_only_v1");
assert.equal(unavailableAvif.evidenceText, "");
assert.deepEqual(normalizer.normalizationDefects({ body: mislabeledAvif, contentType: "text/plain",
  url: "https://example.test/provider-photo.avif", normalized: unavailableAvif }), []);
const htmlAtImageUrl = normalizer.normalizeSourceBodyV4({ body: Buffer.from(html),
  contentType: "text/html", url: "https://example.test/provider-photo.jpg" });
assert.equal(htmlAtImageUrl.normalizationFormat, "rendered_semantic_markdown_v4",
  "authoritative/detected HTML must win over an image-looking URL extension");

if (!process.env.WORKBOOK_PYTHON) {
  assert.throws(() => normalizer.normalizeSourceBodyV4({
    body: Buffer.from("binary"), contentType: "application/vnd.ms-excel", url: "https://example.test/a.xls"
  }), /WORKBOOK_PARSER_UNAVAILABLE/);
}

if (process.env.WORKBOOK_PYTHON) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "normalizer-workbook-test-"));
  const xlsx = path.join(directory, "fixture.xlsx");
  try {
    const workbookFixture = path.join(fixtureRoot, "workbook_provider_rows.json");
    execFileSync(process.env.WORKBOOK_PYTHON, ["-c", [
      "import json,openpyxl,sys", "spec=json.load(open(sys.argv[1]))", "w=openpyxl.Workbook()",
      "w.remove(w.active)",
      "[(lambda s: [s.__setitem__(c,v) for c,v in sh['cells'].items()])(w.create_sheet(sh['name'])) for sh in spec['sheets']]",
      "w.save(sys.argv[2])"
    ].join(";"), workbookFixture, xlsx]);
    const workbook = normalizer.normalizeSourceBodyV4({ body: fs.readFileSync(xlsx),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      url: "https://example.test/fixture.xlsx" });
    assert.equal(workbook.completeNonemptyCellCoverage, true);
    assert.equal(workbook.cachedValueLookupPolicy,
      "formula_and_data_only_read_only_rows_iterated_in_coordinate_lockstep");
    assert.equal(workbook.timeoutPolicy.parserTimeoutMs, 120_000);
    assert(workbook.timeoutPolicy.parserTimeoutMs > workbook.timeoutPolicy.basis.worstMeasuredParseMs * 18);
    assert.match(workbook.evidenceText, /A2="1234567890"/);
    assert.match(workbook.evidenceText, /C4="555-0199"/);
    assert.match(workbook.evidenceText, /D2=\{"formula":"=1\+1","cachedDisplayedValue":null\}/);
    assert.match(workbook.evidenceText, /## Sheet: Locations/);
    assert.equal(workbook.sourceBodySha256, workbook.bodySha256);
    assert.deepEqual(normalizer.normalizationDefects({ body: fs.readFileSync(xlsx),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      url: "https://example.test/fixture.xlsx", normalized: workbook }), []);
    if (process.env.WORKBOOK_SOFFICE) {
      execFileSync(process.env.WORKBOOK_SOFFICE, ["--headless", "--convert-to", "xls", "--outdir", directory, xlsx]);
      const xls = path.join(directory, "fixture.xls");
      const converted = normalizer.normalizeSourceBodyV4({ body: fs.readFileSync(xls),
        contentType: "application/vnd.ms-excel", url: "https://example.test/fixture.xls" });
      assert.equal(converted.completeNonemptyCellCoverage, true);
      assert.equal(converted.converter.originalFormat, ".xls");
      assert.match(converted.evidenceText, /A2="1234567890"/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async () => {
  const pool = new normalizer.SemanticMarkdownWorkerPool({ size: 2, timeoutMs: 5_000 });
  try {
    const workerNormalized = await pool.normalize({ body: Buffer.from(html), contentType: "text/html",
      url: "https://example.test/jane" });
    assert.equal(workerNormalized.sourceBodySha256, normalized.sourceBodySha256);
    assert.doesNotMatch(workerNormalized.evidenceText, /pageProps/);
  } finally {
    await pool.close();
  }
  process.stdout.write("format-aware source normalizer tests passed\n");
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

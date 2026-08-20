"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const Module = require("node:module");
const crypto = require("node:crypto");

const BASE_MODULE = path.resolve(__dirname,
  "./source_ingestion.js");
const DEPENDENCY_MODULES = process.env.PROVIDER_EVAL_NODE_MODULES
  || path.resolve(__dirname, "../../../node_modules");
process.env.NODE_PATH = [DEPENDENCY_MODULES, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const base = require(BASE_MODULE);
const parse5 = require("parse5");
const WORKBOOK_SCRIPT = path.join(__dirname, "format_aware_workbook.py");
const WORKBOOK_CONVERSION_TIMEOUT_MS = 120_000;
const WORKBOOK_PARSER_TIMEOUT_MS = 120_000;
const WORKBOOK_WORKER_TIMEOUT_MS = 150_000;
const WORKBOOK_TIMEOUT_BASIS = Object.freeze({
  policy: "bounded_subprocess_and_worker_timeouts_for_large_workbook_normalization"
});
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const mime = (value) => String(value || "").split(";", 1)[0].trim().toLowerCase();
const extension = (url) => {
  try { return path.extname(new URL(url).pathname).toLowerCase(); } catch { return ""; }
};
const workbookExtensions = new Set([".xls", ".xlsx", ".xlsm", ".xlsb", ".ods"]);
const binaryImageExtensions = new Set([".avif", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"]);
const contentKind = ({ body, contentType, url }) => {
  const contentMime = mime(contentType);
  const ext = extension(url);
  const workbookMime = /spreadsheet|ms-excel|opendocument\.spreadsheet/.test(contentMime);
  const htmlMime = /^(?:text\/html|application\/xhtml\+xml)$/.test(contentMime);
  const zip = body.length >= 4 && body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const ole = body.length >= 8
    && body.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const genericMime = contentMime === "" || contentMime === "application/octet-stream"
    || contentMime === "binary/octet-stream";
  const avif = body.length >= 12 && body.subarray(4, 8).toString("ascii") === "ftyp"
    && ["avif", "avis"].includes(body.subarray(8, 12).toString("ascii"));
  const png = body.length >= 8
    && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const gif = body.length >= 6 && ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"));
  const webp = body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF"
    && body.subarray(8, 12).toString("ascii") === "WEBP";
  return {
    contentMime,
    ext,
    workbook: workbookMime || ole || (zip && workbookExtensions.has(ext))
      || (genericMime && workbookExtensions.has(ext)),
    htmlMime,
    binaryImage: (contentMime.startsWith("image/") && contentMime !== "image/svg+xml")
      || binaryImageExtensions.has(ext) || avif || png || jpeg || gif || webp
  };
};

const normalizationDefects = ({ body, contentType, url, normalized }) => {
  const defects = [];
  const kind = contentKind({ body, contentType, url });
  const bodyHash = sha256(body);
  if (!normalized || typeof normalized !== "object") return ["NORMALIZER_RETURNED_NO_AUDIT_OBJECT"];
  if (normalized.sourceBodySha256 !== bodyHash) defects.push("SOURCE_BODY_HASH_MISMATCH");
  if (typeof normalized.evidenceText !== "string") defects.push("EVIDENCE_TEXT_NOT_STRING");
  else {
    if (normalized.evidenceTextBytes !== Buffer.byteLength(normalized.evidenceText)) {
      defects.push("EVIDENCE_TEXT_BYTE_COUNT_MISMATCH");
    }
    if (normalized.evidenceTextSha256 !== sha256(normalized.evidenceText)) {
      defects.push("EVIDENCE_TEXT_HASH_MISMATCH");
    }
  }
  if (kind.workbook) {
    if (normalized.normalizationFormat !== "workbook_rows_v1") defects.push("WORKBOOK_NOT_NORMALIZED_AS_ROWS");
    if (normalized.completeNonemptyCellCoverage !== true) defects.push("WORKBOOK_COVERAGE_NOT_COMPLETE");
    if (/html|plain_text/i.test(String(normalized.extractionMode || ""))) {
      defects.push("WORKBOOK_ENTERED_TEXT_OR_HTML_NORMALIZER");
    }
  }
  if (kind.htmlMime || /<html|<!doctype/i.test(body.toString("utf8", 0, Math.min(body.length, 500)))) {
    if (normalized.normalizationFormat !== "rendered_semantic_markdown_v4") {
      defects.push("HTML_NOT_NORMALIZED_AS_RENDERED_SEMANTIC_MARKDOWN_V4");
    }
    if (normalized.applicationHydrationRetained !== false) defects.push("HTML_HYDRATION_RETENTION_NOT_FALSE");
  }
  return defects;
};

const assertNormalizationResult = (input) => {
  const defects = normalizationDefects(input);
  if (defects.length) throw new Error(`INVALID_NORMALIZATION:${defects.join(",")}`);
  return input.normalized;
};

const attrs = (node) => Object.fromEntries((node.attrs || []).map((item) => [item.name, item.value]));
const removeNonRenderedScripts = (html, {
  maximumJsonLdChars = 100_000,
  maximumAggregateJsonLdChars = 150_000
} = {}) => {
  const document = parse5.parse(html, { sourceCodeLocationInfo: false });
  let removedScriptCount = 0;
  let removedScriptChars = 0;
  let retainedJsonLdCount = 0;
  let retainedJsonLdChars = 0;
  let totalJsonLdChars = 0;
  const oversizedJsonLd = [];
  const text = (node) => node.nodeName === "#text" ? node.value || ""
    : (node.childNodes || []).map(text).join("");
  const visit = (node) => {
    if (!Array.isArray(node.childNodes)) return;
    node.childNodes = node.childNodes.filter((child) => {
      if (String(child.tagName || "").toLowerCase() !== "script") return true;
      const type = String(attrs(child).type || "").split(";", 1)[0].trim().toLowerCase();
      const body = text(child);
      if (type === "application/ld+json") totalJsonLdChars += body.length;
      const withinIndividualLimit = body.length <= maximumJsonLdChars;
      const withinAggregateLimit = retainedJsonLdChars + body.length <= maximumAggregateJsonLdChars;
      if (type === "application/ld+json" && withinIndividualLimit && withinAggregateLimit) {
        retainedJsonLdCount += 1;
        retainedJsonLdChars += body.length;
        return true;
      }
      if (type === "application/ld+json") oversizedJsonLd.push({ chars: body.length, sha256: sha256(body),
        reason: withinIndividualLimit ? "AGGREGATE_JSON_LD_LIMIT" : "INDIVIDUAL_JSON_LD_LIMIT" });
      removedScriptCount += 1;
      removedScriptChars += body.length;
      return false;
    });
    for (const child of node.childNodes) visit(child);
  };
  visit(document);
  return { html: parse5.serialize(document), removedScriptCount, removedScriptChars,
    retainedJsonLdCount, retainedJsonLdChars, totalJsonLdChars, oversizedJsonLd,
    maximumJsonLdChars, maximumAggregateJsonLdChars };
};

const normalizeWorkbook = ({ body, contentType, url, python, soffice }) => {
  const contentMime = mime(contentType);
  let ext = extension(url);
  if (!ext) ext = /openxmlformats/.test(contentMime) ? ".xlsx"
    : /opendocument/.test(contentMime) ? ".ods" : ".xls";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-eval-workbook-"));
  const file = path.join(directory, `source${ext}`);
  try {
    fs.writeFileSync(file, body);
    let normalizedFile = file;
    let conversion = null;
    if (![".xlsx", ".xlsm"].includes(ext)) {
      if (!soffice) throw new Error(`WORKBOOK_CONVERTER_UNAVAILABLE:${ext}`);
      const version = execFileSync(soffice, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
      execFileSync(soffice, ["--headless", "--convert-to", "xlsx", "--outdir", directory, file], {
        encoding: "utf8", maxBuffer: 1024 * 1024, timeout: WORKBOOK_CONVERSION_TIMEOUT_MS
      });
      normalizedFile = path.join(directory, "source.xlsx");
      if (!fs.existsSync(normalizedFile)) throw new Error(`WORKBOOK_CONVERSION_FAILED:${ext}`);
      conversion = {
        originalFormat: ext,
        convertedFormat: ".xlsx",
        converterVersion: version,
        converterBinarySha256: sha256(fs.readFileSync(soffice)),
        convertedBodySha256: sha256(fs.readFileSync(normalizedFile)),
        convertedBodyBytes: fs.statSync(normalizedFile).size
      };
    }
    const result = JSON.parse(execFileSync(python, [WORKBOOK_SCRIPT, normalizedFile], {
      encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: WORKBOOK_PARSER_TIMEOUT_MS
    }));
    return {
      ...result,
      bodySha256: sha256(body),
      bodyBytes: body.length,
      converter: conversion,
      timeoutPolicy: { conversionTimeoutMs: WORKBOOK_CONVERSION_TIMEOUT_MS,
        parserTimeoutMs: WORKBOOK_PARSER_TIMEOUT_MS, workerTimeoutMs: WORKBOOK_WORKER_TIMEOUT_MS,
        basis: WORKBOOK_TIMEOUT_BASIS }
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const normalizeSourceBodyV4 = ({
  body,
  contentType = "application/octet-stream",
  url = "https://invalid.test/",
  workbookPython = process.env.WORKBOOK_PYTHON,
  workbookSoffice = process.env.WORKBOOK_SOFFICE
} = {}) => {
  if (!Buffer.isBuffer(body)) throw new Error("body must be a Buffer");
  if (body.length > base.FETCH_MAX_TRANSFER_BYTES) throw new Error(`body_exceeds_hard_limit:${body.length}`);
  const kind = contentKind({ body, contentType, url });
  if (kind.workbook) {
    if (!workbookPython) throw new Error("WORKBOOK_PARSER_UNAVAILABLE: set WORKBOOK_PYTHON to pinned Python with openpyxl");
    const normalized = normalizeWorkbook({ body, contentType, url, python: workbookPython, soffice: workbookSoffice });
    const result = {
      ...normalized,
      extractorVersion: "format-aware-complete-workbook-v4",
      sourceBodySha256: sha256(body),
      classifiedContentType: kind.contentMime,
      scriptsExecuted: false
    };
    return assertNormalizationResult({ body, contentType, url, normalized: result });
  }
  const decoded = body.toString("utf8");
  if (kind.htmlMime || /<html|<!doctype/i.test(decoded.slice(0, 500))) {
    const cleaned = removeNonRenderedScripts(decoded);
    const normalized = base.linearSemanticMarkdown({
      html: cleaned.html, url, extractionMode: "parse5_rendered_semantic_v4"
    });
    const result = {
      ...normalized,
      extractorVersion: "semantic-rendered-markdown-v4",
      normalizationFormat: "rendered_semantic_markdown_v4",
      sourceBodySha256: sha256(body),
      rawBodySha256: sha256(body),
      rawBodyBytes: body.length,
      removedNonRenderedScriptCount: cleaned.removedScriptCount,
      removedNonRenderedScriptChars: cleaned.removedScriptChars,
      retainedJsonLd: cleaned.retainedJsonLdCount > 0,
      retainedJsonLdCount: cleaned.retainedJsonLdCount,
      retainedJsonLdChars: cleaned.retainedJsonLdChars,
      totalJsonLdChars: cleaned.totalJsonLdChars,
      oversizedJsonLd: cleaned.oversizedJsonLd,
      maximumJsonLdChars: cleaned.maximumJsonLdChars,
      maximumAggregateJsonLdChars: cleaned.maximumAggregateJsonLdChars,
      manualReviewSignals: cleaned.oversizedJsonLd.length ? ["OVERSIZED_JSON_LD_REQUIRES_MANUAL_REVIEW"] : [],
      applicationHydrationRetained: false
    };
    return assertNormalizationResult({ body, contentType, url, normalized: result });
  }
  if (kind.binaryImage) {
    const result = {
      evidenceText: "",
      evidenceTextBytes: 0,
      evidenceTextSha256: sha256(""),
      sourceBodySha256: sha256(body),
      extractorVersion: "format-aware-binary-image-v4",
      extractionMode: "metadata_only_binary_unavailable",
      normalizationFormat: "binary_image_metadata_only_v1",
      classifiedContentType: kind.contentMime,
      evidenceUnavailable: true,
      scriptsExecuted: false
    };
    return assertNormalizationResult({ body, contentType, url, normalized: result });
  }
  const result = base.normalizeSourceBody({ body, contentType, url });
  return assertNormalizationResult({ body, contentType, url, normalized: result });
};

class SemanticMarkdownWorkerPool {
  constructor({ size = 4, timeoutMs = 20_000 } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 32) throw new Error("normalizer worker size must be 1..32");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("normalizer timeout must be at least 1000ms");
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.workers = [];
    this.nextId = 1;
    this.closed = false;
    for (let index = 0; index < size; index += 1) this.workers.push(this.spawn(index));
  }

  spawn(index) {
    const state = { index, active: null, retiring: false,
      worker: new Worker(__filename, { workerData: { formatAwareNormalizerWorker: true } }) };
    state.worker.on("message", (message) => this.complete(state, message));
    state.worker.on("error", (error) => this.fail(state, error));
    state.worker.on("exit", (code) => {
      if (state.active) this.fail(state, new Error(`normalizer_worker_exit_${code}`));
      if (!this.closed && this.workers[index] === state && (state.retiring || code !== 0)) {
        this.workers[index] = this.spawn(index);
        this.dispatch();
      }
    });
    return state;
  }

  normalize({ body, contentType, url }) {
    if (this.closed) return Promise.reject(new Error("normalizer worker pool is closed"));
    if (!Buffer.isBuffer(body)) return Promise.reject(new Error("body must be a Buffer"));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, body: Buffer.from(body), contentType, url,
        workbook: contentKind({ body, contentType, url }).workbook, resolve, reject, timer: null });
      this.dispatch();
    });
  }

  dispatch() {
    for (const state of this.workers) {
      if (state.active || state.retiring || !this.queue.length) continue;
      const task = this.queue.shift();
      state.active = task;
      // Deterministic workbook conversion is subprocess-bound and legitimately
      // slower than HTML parsing. Do not turn a valid workbook into an invalid
      // normalization merely because the HTML worker timeout is smaller.
      const taskTimeoutMs = task.workbook ? Math.max(this.timeoutMs, WORKBOOK_WORKER_TIMEOUT_MS) : this.timeoutMs;
      task.timer = setTimeout(() => {
        if (state.active !== task) return;
        state.active = null;
        state.retiring = true;
        task.reject(new Error(`normalizer_worker_timeout:${taskTimeoutMs}ms`));
        state.worker.terminate();
      }, taskTimeoutMs);
      state.worker.postMessage({ id: task.id, body: task.body, contentType: task.contentType, url: task.url });
    }
  }

  complete(state, message) {
    const task = state.active;
    if (!task || message?.id !== task.id) return;
    clearTimeout(task.timer);
    state.active = null;
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.result);
    this.dispatch();
  }

  fail(state, error) {
    const task = state.active;
    if (!task) return;
    clearTimeout(task.timer);
    state.active = null;
    state.retiring = true;
    task.reject(error);
    state.worker.terminate();
  }

  async close() {
    this.closed = true;
    for (const task of this.queue.splice(0)) task.reject(new Error("normalizer worker pool closed before task started"));
    await Promise.allSettled(this.workers.map((state) => state.worker.terminate()));
  }
}

if (!isMainThread && workerData?.formatAwareNormalizerWorker) {
  parentPort.on("message", ({ id, body, contentType, url }) => {
    try {
      parentPort.postMessage({ id, result: normalizeSourceBodyV4({ body: Buffer.from(body), contentType, url }) });
    } catch (error) {
      parentPort.postMessage({ id, error: String(error?.stack || error?.message || error) });
    }
  });
}

module.exports = {
  ...base,
  SEMANTIC_MARKDOWN_EXTRACTOR_VERSION: "format-aware-source-normalizer-v4",
  normalizeSourceBody: normalizeSourceBodyV4,
  normalizeSourceBodyV4,
  removeNonRenderedScripts,
  contentKind,
  normalizationDefects,
  assertNormalizationResult,
  SemanticMarkdownWorkerPool,
  WORKBOOK_CONVERSION_TIMEOUT_MS,
  WORKBOOK_PARSER_TIMEOUT_MS,
  WORKBOOK_TIMEOUT_BASIS,
  WORKBOOK_WORKER_TIMEOUT_MS
};

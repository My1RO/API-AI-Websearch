#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

// These are ingestion safety limits, not evidence-selection budgets. A response
// that exceeds a hard limit is unavailable to the judge; a partial prefix is
// diagnostic only and is never presented as page evidence.
const FETCH_MAX_TRANSFER_BYTES = 32 * 1024 * 1024;
const SEMANTIC_MARKDOWN_EXTRACTOR_VERSION = "semantic-full-dom-markdown-v6-rendered-semantic-rating-state";
const LARGE_HTML_LINEAR_FALLBACK_CHARS = 2 * 1024 * 1024;
const MAX_STRUCTURED_JSON_DOCUMENTS = 128;
const MAX_STRUCTURED_JSON_CHARS = FETCH_MAX_TRANSFER_BYTES;
const MAX_STRUCTURED_JSON_NODES = 500_000;
const DOCUMENTED_CONTEXT_TOKENS = 272_000;
const DEFAULT_OUTPUT_REASONING_RESERVE_TOKENS = 48_000;
const LOCAL_TOKENIZER_ENCODING = "o200k_base";
const LOCAL_TOKEN_SAFETY_MULTIPLIER = 1.15;
const LOCAL_TOKEN_FIXED_RESERVE = 2_048;
const CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value);

const contentTypeEssence = (value) => String(value || "application/octet-stream")
  .split(";", 1)[0].trim().toLowerCase();

const binaryMagic = (body) => {
  if (body.length >= 4 && body[0] === 0x50 && body[1] === 0x4b
    && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => body[2] === a && body[3] === b)) return "zip_container";
  if (body.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) return "gzip";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "jpeg";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "ole_container";
  return null;
};

const binaryContentType = (contentType) => {
  const type = contentTypeEssence(contentType);
  return /^(?:image|audio|video|font)\//.test(type)
    || /^(?:application\/(?:octet-stream|pdf|zip|x-zip-compressed|gzip|x-gzip|x-7z-compressed|x-rar-compressed|vnd\.rar|msword|vnd\.ms-|vnd\.openxmlformats-officedocument|x-tar))/.test(type);
};

const textContentType = (contentType) => {
  const type = contentTypeEssence(contentType);
  return type.startsWith("text/") || type === "application/xml" || type === "application/xhtml+xml"
    || type.endsWith("+xml") || type === "application/json" || type.endsWith("+json")
    || type === "application/javascript" || type === "application/x-javascript";
};

const directEvidenceMode = ({
  exactInputTokens,
  verifiedContextTokens = DOCUMENTED_CONTEXT_TOKENS,
  outputReasoningReserveTokens = DEFAULT_OUTPUT_REASONING_RESERVE_TOKENS
}) => {
  for (const [label, value] of Object.entries({ exactInputTokens, verifiedContextTokens, outputReasoningReserveTokens })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer`);
  }
  if (outputReasoningReserveTokens >= verifiedContextTokens) throw new Error("reserve consumes context window");
  const maximumDirectInputTokens = verifiedContextTokens - outputReasoningReserveTokens;
  const accepted = exactInputTokens <= maximumDirectInputTokens;
  return {
    mode: accepted ? "direct_full_semantic_sources" : "direct_packet_context_overflow",
    failureCode: accepted ? null : CONTEXT_OVERFLOW,
    overflowCause: accepted ? null : "direct_packet_context_overflow",
    exactInputTokens,
    verifiedContextTokens,
    outputReasoningReserveTokens,
    maximumDirectInputTokens,
    tokensRemainingAfterInput: verifiedContextTokens - exactInputTokens,
    truncationAllowed: false,
    fallbackEnabled: false
  };
};

const requestSansReasoningEffort = (request) => {
  const value = structuredClone(request);
  if (value?.reasoning && Object.hasOwn(value.reasoning, "effort")) delete value.reasoning.effort;
  return value;
};

const requestSansReasoningSha256 = (request) => sha256(stableJson(requestSansReasoningEffort(request)));

const assertReasoningOnlyRequestDifference = (left, right) => {
  const leftHash = requestSansReasoningSha256(left);
  const rightHash = requestSansReasoningSha256(right);
  if (leftHash !== rightHash) throw new Error("requests differ beyond reasoning.effort");
  return leftHash;
};

const assertTruncationDisabled = (request) => {
  if (request?.truncation !== "disabled") {
    throw new Error('Responses request must set truncation to enum "disabled"');
  }
  return true;
};

const localTokenPreflight = ({
  request,
  verifiedContextTokens = DOCUMENTED_CONTEXT_TOKENS,
  outputReasoningReserveTokens = DEFAULT_OUTPUT_REASONING_RESERVE_TOKENS
}) => {
  assertTruncationDisabled(request);
  const { getEncoding } = require("js-tiktoken");
  const encoding = getEncoding(LOCAL_TOKENIZER_ENCODING);
  // Serialize the complete SDK request, including the Structured Output schema.
  // This intentionally overcounts transport keys rather than omitting overhead.
  const localEncodedTokens = encoding.encode(stableJson(request)).length;
  const conservativeInputTokens = Math.ceil(localEncodedTokens * LOCAL_TOKEN_SAFETY_MULTIPLIER)
    + LOCAL_TOKEN_FIXED_RESERVE;
  const decision = directEvidenceMode({
    exactInputTokens: conservativeInputTokens,
    verifiedContextTokens,
    outputReasoningReserveTokens
  });
  return {
    ...decision,
    exactInputTokens: null,
    localTokenizerEncoding: LOCAL_TOKENIZER_ENCODING,
    localEncodedTokens,
    safetyMultiplier: LOCAL_TOKEN_SAFETY_MULTIPLIER,
    fixedSafetyReserveTokens: LOCAL_TOKEN_FIXED_RESERVE,
    conservativeInputTokens,
    deploymentProofRequired: true,
    note: "Azure /responses/input_tokens is unavailable; actual Responses smoke/usage is authoritative."
  };
};

const decodeOne = (body, encoding, maxOutputLength) => {
  const options = { maxOutputLength };
  if (encoding === "gzip" || encoding === "x-gzip") return zlib.gunzipSync(body, options);
  if (encoding === "br") return zlib.brotliDecompressSync(body, options);
  if (encoding === "deflate") {
    try {
      return zlib.inflateSync(body, options);
    } catch (error) {
      // Some servers incorrectly label a raw DEFLATE stream as `deflate`.
      if (!/incorrect header check|unknown compression method|invalid/i.test(String(error?.message || error))) throw error;
      return zlib.inflateRawSync(body, options);
    }
  }
  if (encoding === "identity") return body;
  throw new Error(`unsupported_content_encoding:${encoding}`);
};

const decodeTransferBody = ({
  wireBody,
  contentEncoding,
  maxTransferBytes = FETCH_MAX_TRANSFER_BYTES,
  maxDecompressedBytes = FETCH_MAX_TRANSFER_BYTES
}) => {
  if (!Buffer.isBuffer(wireBody)) throw new Error("wireBody must be a Buffer");
  if (wireBody.length > maxTransferBytes) throw new Error(`wire_body_exceeds_hard_limit:${wireBody.length}`);
  const encodings = String(contentEncoding || "identity").split(",")
    .map((value) => value.trim().toLowerCase()).filter(Boolean);
  let decoded = wireBody;
  try {
    for (const encoding of [...encodings].reverse()) decoded = decodeOne(decoded, encoding, maxDecompressedBytes);
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE" || /larger than|Cannot create a Buffer larger/i.test(String(error?.message || error))) {
      throw new Error("decompressed_body_exceeds_hard_limit");
    }
    throw error;
  }
  if (decoded.length > maxDecompressedBytes) throw new Error(`decompressed_body_exceeds_hard_limit:${decoded.length}`);
  return {
    contentEncoding: encodings.join(", ") || "identity",
    wireBytes: wireBody.length,
    wireSha256: sha256(wireBody),
    decompressedBytes: decoded.length,
    decompressedSha256: sha256(decoded),
    decompressedBody: decoded,
    complete: true
  };
};

const canonicalizeMarkdown = (value) => String(value || "")
  .replace(/\u00a0/g, " ")
  .replace(/[ \t]+$/gm, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const countStructuredJsonNodes = (value) => {
  const pending = [value];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > MAX_STRUCTURED_JSON_NODES) throw new Error("structured_json_nodes_exceed_hard_limit");
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return nodes;
};

const balancedJsonLiteral = (source, start) => {
  const opening = source[start];
  if (opening !== "{" && opening !== "[") return null;
  const closingFor = { "{": "}", "[": "]" };
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(closingFor[character]);
    else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) return source.slice(start, index + 1);
    }
  }
  return null;
};

// Parse only complete line-leading JSON literals. Never evaluate JavaScript.
const inlineJsonAssignments = (source) => {
  const values = [];
  const declaration = /^[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*/gm;
  for (const match of source.matchAll(declaration)) {
    const start = match.index + match[0].length;
    const literal = balancedJsonLiteral(source, start);
    if (!literal) continue;
    try {
      values.push({ value: JSON.parse(literal), label: match[1], raw: literal });
    } catch {
      // Malformed assignments remain in the complete raw artifact only.
    }
  }
  return values;
};

const jsonPathChild = (path, key) => `${path}[${JSON.stringify(String(key))}]`;
const normalizedSemanticKey = (key) => String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const semanticContainerKey = (key) => {
  const value = normalizedSemanticKey(key);
  return /^(?:provider|physician|doctor|practitioner|facility|hospital|clinic|practice)(?:data|record|details|profile|list|locations?|contacts?|specialties?)?$/.test(value)
    || /^(?:profile|profilelist|locations?|addresses?|addressresults|contacts?|specialties?|taxonomies?|ratings?|reviews?|overallrating|ratingsummary|reviewsummary)$/.test(value);
};
const semanticLeafKey = (key) => {
  const value = normalizedSemanticKey(key);
  return /^(?:(?:provider|physician|facility|practice)(?:npi|name|fullname|legalname|firstname|middlename|middleinitial|lastname|designation|credential|title)|npi|pagetitle|physicianmetatitle)$/.test(value)
    || /^(?:specialty|specialties|taxonomy|taxonomies|classification|address|address1|address2|addressline1|addressline2|street|streetaddress|city|state|region|province|zip|zipcode|postal|postalcode|phone|phonenumber|telephone|facsimile|fax|website|webaddress|canonical|url|rating|ratingscale|reviewcount|totalratingcount|totalcommentcount|lookbackwindow|licensenumber|licensestatus|licenseeffectivedate|licenseexpirationdate|updateddate|modifieddate|effectivedate|expirationdate)$/.test(value);
};

// Application state can contain the only server-returned representation of a
// modern page's provider card. Retain every primitive leaf in a semantically
// named provider subtree, plus independently provider-relevant leaves outside
// such a subtree. This is vocabulary-based evidence projection, not a size
// budget: traversal is exhaustive or fails, and selected values are never
// truncated or summarized.
const projectSemanticJson = ({ value, kind, label, raw }) => {
  const selected = [];
  const pending = [{ value, path: "$", anchored: semanticContainerKey(label), key: label || "" }];
  let traversedNodes = 0;
  let emptyPrimitiveCount = 0;
  while (pending.length) {
    const current = pending.pop();
    traversedNodes += 1;
    if (traversedNodes > MAX_STRUCTURED_JSON_NODES) throw new Error("structured_json_nodes_exceed_hard_limit");
    if (current.value && typeof current.value === "object") {
      const entries = Array.isArray(current.value)
        ? current.value.map((child, index) => [index, child, `${current.path}[${index}]`])
        : Object.entries(current.value).map(([key, child]) => [key, child, jsonPathChild(current.path, key)]);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child, childPath] = entries[index];
        pending.push({ value: child, path: childPath, key, anchored: current.anchored || semanticContainerKey(key) });
      }
      continue;
    }
    if (current.value == null || (typeof current.value === "string" && current.value.trim() === "")) {
      emptyPrimitiveCount += 1;
      continue;
    }
    if (!current.anchored && !semanticLeafKey(current.key)) continue;
    selected.push({ path: current.path, value: current.value });
  }
  const lines = selected.map((item) => `${item.path} = ${JSON.stringify(item.value)}`);
  return {
    kind, label: label || null, rawSha256: sha256(raw), traversedNodes,
    selectedPathCount: selected.length,
    selectedPaths: selected.map((item) => item.path),
    selectedPathsSha256: sha256(selected.map((item) => item.path).join("\n")),
    projectionSha256: sha256(lines.join("\n")), projectionChars: lines.join("\n").length,
    emptyPrimitiveCount, lines
  };
};

const collectStructuredJson = (scripts) => {
  const promoted = [];
  const projections = [];
  let serializedChars = 0;
  let traversedNodes = 0;
  let excludedApplicationJsonDocumentCount = 0;
  let excludedInlineAssignmentJsonDocumentCount = 0;
  let malformedApplicationJsonDocumentCount = 0;
  let malformedInlineAssignmentJsonDocumentCount = 0;
  const add = ({ value, kind, label }) => {
    if (promoted.length >= MAX_STRUCTURED_JSON_DOCUMENTS) {
      throw new Error("structured_json_documents_exceed_hard_limit");
    }
    traversedNodes += countStructuredJsonNodes(value);
    if (traversedNodes > MAX_STRUCTURED_JSON_NODES) {
      throw new Error("structured_json_nodes_exceed_hard_limit");
    }
    serializedChars += JSON.stringify(value).length;
    if (serializedChars > MAX_STRUCTURED_JSON_CHARS) {
      throw new Error("structured_json_chars_exceed_hard_limit");
    }
    promoted.push({ value, kind, label });
  };
  for (const script of scripts) {
    const raw = String(script.text || "").trim();
    if (!raw) continue;
    const type = String(script.type || "").split(";", 1)[0].trim().toLowerCase();
    if (type === "application/ld+json") {
      let value;
      try { value = JSON.parse(raw); }
      catch { continue; /* invalid JSON-LD remains available in the complete raw artifact */ }
      add({ value, kind: "json_ld", label: script.id || null });
      continue;
    }
    if (type === "application/json" || (/^application\/.+\+json$/.test(type) && type !== "application/ld+json")) {
      let value;
      try { value = JSON.parse(raw); }
      catch { malformedApplicationJsonDocumentCount += 1; continue; }
      const projection = projectSemanticJson({ value, kind: "application_json", label: script.id || null, raw });
      traversedNodes += projection.traversedNodes;
      if (traversedNodes > MAX_STRUCTURED_JSON_NODES) throw new Error("structured_json_nodes_exceed_hard_limit");
      if (projection.selectedPathCount) projections.push(projection);
      else excludedApplicationJsonDocumentCount += 1;
      continue;
    }
    if (type === "" || type === "text/javascript" || type === "application/javascript") {
      const candidates = inlineJsonAssignments(raw);
      for (const candidate of candidates) {
        const projection = projectSemanticJson({ ...candidate, kind: "inline_json_assignment" });
        traversedNodes += projection.traversedNodes;
        if (traversedNodes > MAX_STRUCTURED_JSON_NODES) throw new Error("structured_json_nodes_exceed_hard_limit");
        if (projection.selectedPathCount) projections.push(projection);
        else excludedInlineAssignmentJsonDocumentCount += 1;
      }
      // A declaration whose literal cannot be balanced or parsed is never
      // projected. Count likely JSON declarations separately for audit.
      const declarationCount = [...raw.matchAll(/^[ \t]*(?:const|let|var)[ \t]+[A-Za-z_$][\w$]*[ \t]*=[ \t]*[{[]/gm)].length;
      malformedInlineAssignmentJsonDocumentCount += Math.max(0, declarationCount - candidates.length);
    }
  }
  return {
    promoted, projections, traversedNodes,
    excludedApplicationJsonDocumentCount,
    excludedInlineAssignmentJsonDocumentCount,
    malformedApplicationJsonDocumentCount,
    malformedInlineAssignmentJsonDocumentCount
  };
};

const structuredJsonMarkdown = (collection) => {
  const jsonLd = collection.promoted.filter((item) => item.kind === "json_ld");
  const sections = [];
  if (jsonLd.length) sections.push(`## Page structured data (JSON-LD)\n\n${jsonLd.map((item) => JSON.stringify(item.value)).join("\n")}`);
  if (collection.projections.length) {
    sections.push(`## Page application data (provider-relevant key-path projection)\n\n${collection.projections.map((item) => {
      const descriptor = item.kind === "application_json" ? "application/json" : "inline JSON assignment";
      return `### ${descriptor}${item.label ? `: ${item.label}` : ""}\n\n${item.lines.join("\n")}`;
    }).join("\n\n")}`);
  }
  return sections.length ? `\n\n${sections.join("\n\n")}` : "";
};

const structuredJsonMetadata = (collection) => ({
  jsonLdDocumentCount: collection.promoted.filter((item) => item.kind === "json_ld").length,
  structuredJsonDocumentCount: collection.promoted.length + collection.projections.length,
  applicationJsonDocumentCount: collection.projections.filter((item) => item.kind === "application_json").length,
  inlineAssignmentJsonDocumentCount: collection.projections.filter((item) => item.kind === "inline_json_assignment").length,
  excludedApplicationJsonDocumentCount: collection.excludedApplicationJsonDocumentCount,
  excludedInlineAssignmentJsonDocumentCount: collection.excludedInlineAssignmentJsonDocumentCount,
  malformedApplicationJsonDocumentCount: collection.malformedApplicationJsonDocumentCount,
  malformedInlineAssignmentJsonDocumentCount: collection.malformedInlineAssignmentJsonDocumentCount,
  applicationStateTraversedNodes: collection.traversedNodes,
  applicationStateSelectedPathCount: collection.projections.reduce((sum, item) => sum + item.selectedPathCount, 0),
  applicationStateProjectionCount: collection.projections.length,
  applicationStateDocuments: collection.projections.map(({ lines, ...metadata }) => metadata),
  htmlApplicationStatePromoted: collection.projections.length > 0,
  htmlApplicationStateProjectionOnly: true
});

const emptyStructuredJsonMetadata = () => structuredJsonMetadata({
  promoted: [], projections: [], traversedNodes: 0,
  excludedApplicationJsonDocumentCount: 0, excludedInlineAssignmentJsonDocumentCount: 0,
  malformedApplicationJsonDocumentCount: 0, malformedInlineAssignmentJsonDocumentCount: 0
});

const unavailableBinaryResult = ({ body, contentType, magic }) => {
  const mimeBinary = binaryContentType(contentType);
  const evidenceText = "";
  return {
    extractorVersion: SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
    extractionMode: "metadata_only_binary_unavailable",
    evidenceUnavailable: true,
    unavailableReason: mimeBinary && magic ? "binary_content_type_and_magic" : mimeBinary ? "binary_content_type" : "binary_magic",
    classifiedContentType: contentTypeEssence(contentType),
    binaryMagic: magic,
    sourceBodySha256: sha256(body),
    evidenceText,
    evidenceTextChars: 0,
    evidenceTextBytes: 0,
    evidenceTextSha256: sha256(evidenceText),
    ...emptyStructuredJsonMetadata(),
    canonicalPageUrl: null,
    pageTitle: null,
    pageHeadMetadata: [],
    pageHeadMetadataCount: 0,
    pageHeadMetadataSha256: sha256("[]"),
    scriptsExecuted: false
  };
};

const resolveCanonicalPageUrl = (href, url) => {
  try {
    const raw = String(href ?? "").trim();
    if (!raw) return null;
    const resolved = new URL(raw, url);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.toString() : null;
  } catch { return null; }
};

const HEAD_META_LABELS = new Map([
  ["description", "Meta description"],
  ["og:title", "Open Graph title"],
  ["og:description", "Open Graph description"],
  ["og:url", "Open Graph URL"],
  ["twitter:title", "Twitter title"],
  ["twitter:description", "Twitter description"]
]);

const auditedHeadMetadata = ({ pageTitle, canonicalPageUrl, entries = [] }) => {
  const pageHeadMetadata = [];
  if (pageTitle) pageHeadMetadata.push({ kind: "title", key: "title", value: pageTitle });
  if (canonicalPageUrl) pageHeadMetadata.push({ kind: "canonical", key: "canonical", value: canonicalPageUrl });
  for (const entry of entries) {
    const key = String(entry.key || "").trim().toLowerCase();
    const value = String(entry.value || "").trim();
    if (HEAD_META_LABELS.has(key) && value) pageHeadMetadata.push({ kind: "meta", key, value });
  }
  return {
    pageHeadMetadata,
    pageHeadMetadataCount: pageHeadMetadata.length,
    pageHeadMetadataSha256: sha256(stableJson(pageHeadMetadata))
  };
};

const pageMetadataMarkdown = ({ pageHeadMetadata }) => {
  const lines = pageHeadMetadata.map((item) => {
    if (item.kind === "title") return `Page title: ${item.value}`;
    if (item.kind === "canonical") return `Canonical URL: ${item.value}`;
    return `${HEAD_META_LABELS.get(item.key)}: ${item.value}`;
  });
  return lines.length ? `\n\n## Page metadata\n\n${lines.join("\n")}` : "";
};

// node-html-markdown can spend unbounded time in RegExpReplace on very large,
// malformed documents. Keep the normal full-DOM converter for ordinary pages,
// but use parse5's linear tree walk above a deterministic size threshold.
const extractLargeHtmlMarkdown = ({ html, url }) => {
  const parse5 = require("parse5");
  const document = parse5.parse(html, { sourceCodeLocationInfo: false });
  const blocks = new Set(["address", "article", "aside", "blockquote", "div", "dl", "dt", "dd", "footer", "form", "header", "h1", "h2", "h3", "h4", "h5", "h6", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "thead", "tfoot", "tr", "ul"]);
  const skipped = new Set(["style", "noscript", "svg", "canvas", "template", "iframe"]);
  const pieces = [];
  const scripts = [];
  let canonicalPageUrl = null;
  let pageTitle = null;
  const headEntries = [];
  const attrs = (node) => Object.fromEntries((node.attrs || []).map((item) => [item.name, item.value]));
  const textContent = (node) => {
    if (node.nodeName === "#text") return node.value || "";
    return (node.childNodes || []).map(textContent).join("");
  };
  const visit = (node) => {
    const tag = String(node.tagName || "").toLowerCase();
    const attributes = attrs(node);
    if (tag === "script") {
      scripts.push({ type: attributes.type || "", id: attributes.id || "", text: textContent(node) });
      return;
    }
    if (tag === "title") pageTitle ||= textContent(node).trim() || null;
    if (tag === "meta") {
      const key = String(attributes.property || attributes.name || "").trim().toLowerCase();
      if (HEAD_META_LABELS.has(key) && attributes.content) headEntries.push({ key, value: attributes.content });
    }
    if (tag === "link" && String(attributes.rel || "").toLowerCase().split(/\s+/).includes("canonical")) {
      canonicalPageUrl ||= resolveCanonicalPageUrl(attributes.href, url);
    }
    if (skipped.has(tag) || Object.hasOwn(attributes, "hidden") || attributes["aria-hidden"] === "true") return;
    if (blocks.has(tag)) pieces.push("\n\n");
    if (tag === "br") pieces.push("\n");
    if (tag === "li") pieces.push("- ");
    if (node.nodeName === "#text") pieces.push(node.value || "");
    for (const child of node.childNodes || []) visit(child);
    if (attributes["aria-label"] && !textContent(node).includes(attributes["aria-label"])) {
      pieces.push(` [aria-label: ${attributes["aria-label"]}]`);
    }
    if (tag === "meta" && attributes.itemprop && attributes.content) {
      pieces.push(` [${attributes.itemprop}: ${attributes.content}]`);
    }
    if (tag === "time" && attributes.datetime && !textContent(node).includes(attributes.datetime)) {
      pieces.push(` [datetime: ${attributes.datetime}]`);
    }
    if (tag === "a" && attributes.href) {
      try { pieces.push(` (${new URL(attributes.href, url).toString()})`); } catch { /* preserve visible anchor text */ }
    }
    if (blocks.has(tag)) pieces.push("\n\n");
  };
  visit(document);
  const structured = collectStructuredJson(scripts);
  const markdown = pieces.join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    markdown, structured, canonicalPageUrl, pageTitle,
    ...auditedHeadMetadata({ pageTitle, canonicalPageUrl, entries: headEntries }),
    mode: "parse5_linear_large_html"
  };
};

const linearSemanticMarkdown = ({ html, url = "https://invalid.test/", extractionMode = "parse5_linear_large_html" }) => {
  const large = extractLargeHtmlMarkdown({ html, url });
  const evidenceText = canonicalizeMarkdown(`${large.markdown}${pageMetadataMarkdown(large)}${structuredJsonMarkdown(large.structured)}`);
  return {
    extractorVersion: SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
    extractionMode,
    evidenceText,
    evidenceTextChars: evidenceText.length,
    evidenceTextBytes: Buffer.byteLength(evidenceText),
    evidenceTextSha256: sha256(evidenceText),
    sourceBodySha256: sha256(Buffer.from(html, "utf8")),
    ...structuredJsonMetadata(large.structured),
    canonicalPageUrl: large.canonicalPageUrl,
    pageTitle: large.pageTitle,
    pageHeadMetadata: large.pageHeadMetadata,
    pageHeadMetadataCount: large.pageHeadMetadataCount,
    pageHeadMetadataSha256: large.pageHeadMetadataSha256,
    scriptsExecuted: false
  };
};

// Convert the complete DOM to compact semantic Markdown. Unlike article
// Readability, this retains header/footer contacts and valid structured data.
const extractSemanticMarkdown = ({ html, url = "https://invalid.test/" }) => {
  if (typeof html !== "string") throw new Error("html must be a string");
  if (html.length > LARGE_HTML_LINEAR_FALLBACK_CHARS) {
    return linearSemanticMarkdown({ html, url });
  }
  const { JSDOM, VirtualConsole } = require("jsdom");
  const { NodeHtmlMarkdown } = require("node-html-markdown");
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, runScripts: "outside-only", resources: undefined, virtualConsole });
  const { document } = dom.window;
  const structured = collectStructuredJson([...document.querySelectorAll("script")].map((node) => ({
    type: node.getAttribute("type") || "",
    id: node.getAttribute("id") || "",
    text: node.textContent || ""
  })));
  const canonicalPageUrl = resolveCanonicalPageUrl(
    document.querySelector('link[rel~="canonical" i]')?.getAttribute("href"), url
  );
  const pageTitle = document.title?.trim() || null;
  const headMetadata = auditedHeadMetadata({
    pageTitle,
    canonicalPageUrl,
    entries: [...document.querySelectorAll("head meta[name][content], head meta[property][content]")].map((node) => ({
      key: node.getAttribute("property") || node.getAttribute("name"),
      value: node.getAttribute("content")
    }))
  });

  for (const node of document.querySelectorAll("[aria-label]")) {
    const label = node.getAttribute("aria-label")?.trim();
    if (label && !String(node.textContent || "").includes(label)) {
      node.append(document.createTextNode(` [aria-label: ${label}]`));
    }
  }
  for (const node of document.querySelectorAll("meta[itemprop][content]")) {
    const itemprop = node.getAttribute("itemprop")?.trim();
    const content = node.getAttribute("content")?.trim();
    if (!itemprop || !content) continue;
    const semantic = document.createElement("span");
    semantic.textContent = ` [${itemprop}: ${content}]`;
    node.replaceWith(semantic);
  }
  for (const node of document.querySelectorAll("time[datetime]")) {
    const datetime = node.getAttribute("datetime")?.trim();
    if (datetime && !String(node.textContent || "").includes(datetime)) {
      node.append(document.createTextNode(` [datetime: ${datetime}]`));
    }
  }
  for (const selector of [
    "script", "style", "noscript", "svg", "canvas", "template", "iframe",
    "[hidden]", '[aria-hidden="true"]'
  ]) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }

  const markdown = NodeHtmlMarkdown.translate(document.body?.innerHTML || document.documentElement?.innerHTML || "", {
    bulletMarker: "-", codeBlockStyle: "fenced", emDelimiter: "_", keepDataImages: false, useInlineLinks: true
  });
  const evidenceText = canonicalizeMarkdown(`${markdown}${pageMetadataMarkdown(headMetadata)}${structuredJsonMarkdown(structured)}`);
  dom.window.close();
  return {
    extractorVersion: SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
    extractionMode: "jsdom_node_html_markdown",
    evidenceText,
    evidenceTextChars: evidenceText.length,
    evidenceTextBytes: Buffer.byteLength(evidenceText),
    evidenceTextSha256: sha256(evidenceText),
    sourceBodySha256: sha256(Buffer.from(html, "utf8")),
    ...structuredJsonMetadata(structured),
    canonicalPageUrl,
    pageTitle,
    ...headMetadata,
    scriptsExecuted: false
  };
};

// Offline normalization entry point for additive evaluator errata. `body` is
// the complete decompressed HTTP entity retained by the evidence collector;
// this function performs no fetch, script execution, truncation, or LLM call.
const normalizeSourceBody = ({
  body, contentType = "application/octet-stream", url = "https://invalid.test/", forceLinearHtml = false
}) => {
  if (!Buffer.isBuffer(body)) throw new Error("body must be a Buffer");
  if (body.length > FETCH_MAX_TRANSFER_BYTES) throw new Error(`body_exceeds_hard_limit:${body.length}`);
  // Gate containers and binary formats before any UTF-8 decode or HTML sniff.
  // In particular, OpenXML MIME strings contain the substring "xml" but an
  // XLSX entity is a ZIP container, not XML page evidence.
  const magic = binaryMagic(body);
  if (binaryContentType(contentType) || magic) return unavailableBinaryResult({ body, contentType, magic });
  const decoded = body.toString("utf8");
  const type = contentTypeEssence(contentType);
  if (type === "text/html" || type === "application/xhtml+xml" || type === "application/xml"
    || type.endsWith("+xml") || /<html|<!doctype/i.test(decoded.slice(0, 500))) {
    const semantic = forceLinearHtml
      ? linearSemanticMarkdown({ html: decoded, url, extractionMode: "parse5_linear_after_worker_timeout" })
      : extractSemanticMarkdown({ html: decoded, url });
    return { ...semantic, sourceBodySha256: sha256(body) };
  }
  if (type === "application/json" || type.endsWith("+json")) {
    try {
      const evidenceText = JSON.stringify(JSON.parse(decoded), null, 2);
      return {
        extractorVersion: SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
        extractionMode: "json_pretty",
        evidenceText,
        evidenceTextChars: evidenceText.length,
        evidenceTextBytes: Buffer.byteLength(evidenceText),
        evidenceTextSha256: sha256(evidenceText),
        ...emptyStructuredJsonMetadata(),
        canonicalPageUrl: null,
        pageTitle: null,
        pageHeadMetadata: [],
        pageHeadMetadataCount: 0,
        pageHeadMetadataSha256: sha256("[]"),
        sourceBodySha256: sha256(body),
        scriptsExecuted: false
      };
    } catch {
      // Preserve the complete malformed response as plain text, matching the
      // historical collector behavior instead of silently discarding it.
    }
  }
  if (!textContentType(type) && decoded.includes("\u0000")) return null;
  return {
    extractorVersion: SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
    extractionMode: "plain_text",
    evidenceText: decoded,
    evidenceTextChars: decoded.length,
    evidenceTextBytes: body.length,
    evidenceTextSha256: sha256(decoded),
    ...emptyStructuredJsonMetadata(),
    canonicalPageUrl: null,
    pageTitle: null,
    pageHeadMetadata: [],
    pageHeadMetadataCount: 0,
    pageHeadMetadataSha256: sha256("[]"),
    sourceBodySha256: sha256(body),
    scriptsExecuted: false
  };
};

class SemanticMarkdownWorkerPool {
  constructor({ size = 4, timeoutMs = 20_000 } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 32) throw new Error("semantic worker size must be 1..32");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("semantic worker timeout must be at least 1000ms");
    this.size = size;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.workers = [];
    this.nextId = 1;
    this.closed = false;
    for (let index = 0; index < size; index += 1) this.workers.push(this.spawn(index));
  }

  spawn(index) {
    const state = { index, worker: new Worker(__filename, { workerData: { semanticMarkdownWorker: true } }), active: null, retiring: false };
    state.worker.on("message", (message) => this.complete(state, message));
    state.worker.on("error", (error) => this.fail(state, error));
    state.worker.on("exit", (code) => {
      if (state.active) this.fail(state, new Error(`semantic_worker_exit_${code}`));
      if (!this.closed && this.workers[index] === state && (state.retiring || code !== 0)) {
        this.workers[index] = this.spawn(index);
        this.dispatch();
      }
    });
    return state;
  }

  extract({ html, url }) {
    if (this.closed) return Promise.reject(new Error("semantic worker pool is closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, kind: "extract", html, url, resolve, reject, timer: null });
      this.dispatch();
    });
  }

  normalize({ body, contentType, url }) {
    if (this.closed) return Promise.reject(new Error("semantic worker pool is closed"));
    if (!Buffer.isBuffer(body)) return Promise.reject(new Error("body must be a Buffer"));
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextId++, kind: "normalize", body: Buffer.from(body), contentType, url,
        resolve, reject, timer: null
      });
      this.dispatch();
    });
  }

  dispatch() {
    for (const state of this.workers) {
      if (state.active || state.retiring || !this.queue.length) continue;
      const task = this.queue.shift();
      state.active = task;
      task.timer = setTimeout(() => {
        if (state.active !== task) return;
        state.active = null;
        state.retiring = true;
        task.resolve(task.kind === "normalize"
          ? normalizeSourceBody({ body: task.body, contentType: task.contentType, url: task.url, forceLinearHtml: true })
          : linearSemanticMarkdown({
            html: task.html,
            url: task.url,
            extractionMode: "parse5_linear_after_worker_timeout"
          }));
        state.worker.terminate();
      }, this.timeoutMs);
      state.worker.postMessage(task.kind === "normalize"
        ? { id: task.id, kind: task.kind, body: task.body, contentType: task.contentType, url: task.url }
        : { id: task.id, kind: task.kind, html: task.html, url: task.url });
    }
  }

  complete(state, message) {
    const task = state.active;
    if (!task || message?.id !== task.id) return;
    clearTimeout(task.timer);
    state.active = null;
    if (message.error) {
      task.resolve(task.kind === "normalize"
        ? normalizeSourceBody({ body: task.body, contentType: task.contentType, url: task.url, forceLinearHtml: true })
        : linearSemanticMarkdown({
          html: task.html,
          url: task.url,
          extractionMode: `parse5_linear_after_worker_error:${String(message.error).slice(0, 120)}`
        }));
    } else task.resolve(message.result);
    this.dispatch();
  }

  fail(state, error) {
    const task = state.active;
    if (!task) return;
    clearTimeout(task.timer);
    state.active = null;
    state.retiring = true;
    task.resolve(task.kind === "normalize"
      ? normalizeSourceBody({ body: task.body, contentType: task.contentType, url: task.url, forceLinearHtml: true })
      : linearSemanticMarkdown({
        html: task.html,
        url: task.url,
        extractionMode: `parse5_linear_after_worker_error:${String(error?.message || error).slice(0, 120)}`
      }));
    state.worker.terminate();
  }

  async close() {
    this.closed = true;
    const queued = this.queue.splice(0);
    for (const task of queued) task.reject(new Error("semantic worker pool closed before task started"));
    await Promise.allSettled(this.workers.map((state) => state.worker.terminate()));
  }
}

if (!isMainThread && workerData?.semanticMarkdownWorker) {
  parentPort.on("message", ({ id, kind, html, body, contentType, url }) => {
    try {
      const result = kind === "normalize"
        ? normalizeSourceBody({ body: Buffer.from(body), contentType, url })
        : extractSemanticMarkdown({ html, url });
      parentPort.postMessage({ id, result });
    }
    catch (error) { parentPort.postMessage({ id, error: String(error?.stack || error?.message || error) }); }
  });
}

module.exports = {
  FETCH_MAX_TRANSFER_BYTES,
  SEMANTIC_MARKDOWN_EXTRACTOR_VERSION,
  LARGE_HTML_LINEAR_FALLBACK_CHARS,
  DOCUMENTED_CONTEXT_TOKENS,
  DEFAULT_OUTPUT_REASONING_RESERVE_TOKENS,
  LOCAL_TOKENIZER_ENCODING,
  LOCAL_TOKEN_SAFETY_MULTIPLIER,
  LOCAL_TOKEN_FIXED_RESERVE,
  CONTEXT_OVERFLOW,
  sha256,
  contentTypeEssence,
  binaryMagic,
  binaryContentType,
  textContentType,
  decodeTransferBody,
  normalizeSourceBody,
  extractSemanticMarkdown,
  linearSemanticMarkdown,
  SemanticMarkdownWorkerPool,
  directEvidenceMode,
  requestSansReasoningEffort,
  requestSansReasoningSha256,
  assertReasoningOnlyRequestDifference,
  assertTruncationDisabled,
  localTokenPreflight
};

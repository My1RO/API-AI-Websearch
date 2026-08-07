"use strict";

const crypto = require("node:crypto");
const FORMAT_POLICY = require("./source_format_policy.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const canonicalUrl = (value) => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const assertCompleteSource = (source) => {
  if (!source || typeof source.sourceId !== "string" || !source.sourceId) {
    throw new Error("Every source must have a sourceId.");
  }
  if (source.silentlyTruncated === true || (source.omittedRanges || []).length > 0) {
    throw new Error(`Source ${source.sourceId} is truncated; no silent or excerpted input is allowed.`);
  }
  if (source.snapshotCoverage === "full_normalized_snapshot") {
    const content = String(source.deliveredContent || "");
    if (!content || source.deliveredChars !== content.replace(/^\[CHAR_RANGE[^\n]*\]\n/, "").length) {
      throw new Error(`Source ${source.sourceId} does not contain its declared complete normalized snapshot.`);
    }
  }
};

const sourceRoles = (packet) => {
  const cited = new Set([
    ...(packet.claims || []).map((item) => item.sourceId),
    ...(packet.preSanitizerCandidates || []).map((item) => item.sourceId)
  ].filter(Boolean));
  const opened = new Set();
  const foundInPage = new Set();
  const consulted = new Set();
  const annotation = new Set((packet.actionTrace?.annotations || []).map((item) => item.sourceId).filter(Boolean));
  for (const call of packet.actionTrace?.calls || []) {
    const target = call.type === "open_page" ? opened
      : call.type === "find_in_page" ? foundInPage : consulted;
    for (const sourceId of call.sourceIds || []) target.add(sourceId);
    const callUrl = canonicalUrl(call.url);
    if (callUrl) {
      const match = (packet.sources || []).find((source) => canonicalUrl(source.url) === callUrl);
      if (match) target.add(match.sourceId);
    }
  }
  return new Map((packet.sources || []).map((source) => {
    const roles = [];
    if (cited.has(source.sourceId)) roles.push("fact_cited");
    if (annotation.has(source.sourceId)) roles.push("native_url_citation");
    if (opened.has(source.sourceId)) roles.push("explicitly_opened");
    if (foundInPage.has(source.sourceId)) roles.push("find_in_page");
    if (consulted.has(source.sourceId)) roles.push("consulted_search_source");
    if (!roles.length) roles.push("arm_returned_source");
    return [source.sourceId, roles];
  }));
};

const auditDescriptor = (source, roles) => ({
  sourceId: source.sourceId,
  url: source.url,
  finalUrl: source.finalUrl || null,
  roles,
  hostReadStatus: source.hostReadStatus,
  httpStatus: source.httpStatus ?? null,
  snapshotCoverage: source.snapshotCoverage,
  originalChars: source.originalChars ?? null,
  deliveredChars: source.deliveredChars ?? null,
  fullTextSha256: source.fullTextSha256 || null,
  bodyBytes: source.hostFetch?.bytesRetained ?? null,
  bodySha256: source.bodySha256 || null
});

const NATIVE_CONTENT_ROLES = new Set([
  "fact_cited", "native_url_citation", "explicitly_opened", "find_in_page"
]);

/*
 * This alternate selection is intentionally opt-in. Azure/OpenAI describe
 * action.sources as consulted URLs, so removing search-only sources changes
 * the legacy "all arm-found evidence" estimand. It can be useful for an audit
 * of native cited/opened evidence because a later host fetch exposes full-page
 * text that was not preserved in the trace (the trace omitted action.results
 * snippets), but it must never masquerade as a transport-only optimization.
 */
const selectNativeContentEvidence = (packet, { acknowledgeEstimandChange = false } = {}) => {
  if (!acknowledgeEstimandChange) {
    throw new Error("Native-content-only selection changes source credit; set acknowledgeEstimandChange=true.");
  }
  const roles = sourceRoles(packet);
  const included = [];
  const excludedSearchOnlyAudit = [];
  for (const source of packet.sources || []) {
    assertCompleteSource(source);
    const sourceRoleList = roles.get(source.sourceId) || ["arm_returned_source"];
    if (sourceRoleList.some((role) => NATIVE_CONTENT_ROLES.has(role))) included.push(source);
    else excludedSearchOnlyAudit.push({
      ...auditDescriptor(source, sourceRoleList),
      exclusionReasonCode: "CONSULTED_SEARCH_ONLY_WITHOUT_PRESERVED_NATIVE_RESULT_CONTENT",
      semanticCreditInThisMode: false
    });
  }
  return {
    mode: "native_cited_opened_content_only",
    changesLegacyEstimand: true,
    included,
    excludedSearchOnlyAudit,
    manifest: {
      sourceCount: (packet.sources || []).length,
      includedCount: included.length,
      excludedSearchOnlyCount: excludedSearchOnlyAudit.length,
      includedCompleteChars: included.reduce((sum, source) => sum + (source.deliveredChars || 0), 0),
      excludedCompleteChars: excludedSearchOnlyAudit.reduce((sum, source) => sum + (source.deliveredChars || 0), 0),
      noUnionEvidence: true,
      extractionLlm: false,
      silentTruncation: false
    }
  };
};

/*
 * Partition complete source snapshots into bounded, independently auditable
 * shards. This is a transport planner, not a semantic filter: every source is
 * assigned exactly once. A source that is individually too large is reported
 * as an honest no-call instead of being truncated or sent to an extraction LLM.
 *
 * The evaluator must use an atomic source/claim-support schema for these shards
 * and deterministically reduce the categorical results. Legacy whole-case
 * field judgments cannot simply be concatenated across shards.
 */
const planEvidenceShards = (packet, {
  countTokens,
  maximumSourceTokens = 200_000
} = {}) => {
  if (typeof countTokens !== "function") throw new Error("countTokens is required.");
  if (!Number.isSafeInteger(maximumSourceTokens) || maximumSourceTokens <= 0) {
    throw new Error("maximumSourceTokens must be a positive safe integer.");
  }
  const roles = sourceRoles(packet);
  const rows = (packet.sources || []).map((source) => {
    assertCompleteSource(source);
    const serialized = JSON.stringify(source);
    return {
      source,
      sourceId: source.sourceId,
      tokens: countTokens(serialized),
      sha256: sha256(serialized),
      roles: roles.get(source.sourceId) || ["arm_returned_source"]
    };
  });
  const oversizeSources = rows.filter((row) => row.tokens > maximumSourceTokens).map((row) => ({
    ...auditDescriptor(row.source, row.roles),
    serializedTokens: row.tokens,
    reasonCode: "COMPLETE_SOURCE_EXCEEDS_ATOMIC_SHARD_BUDGET",
    disposition: "HONEST_NO_CALL_NO_TRUNCATION"
  }));
  const eligible = rows.filter((row) => row.tokens <= maximumSourceTokens)
    .sort((left, right) => right.tokens - left.tokens || left.sourceId.localeCompare(right.sourceId));
  const shards = [];
  for (const row of eligible) {
    let shard = shards.find((candidate) => candidate.sourceTokens + row.tokens <= maximumSourceTokens);
    if (!shard) {
      shard = { shardIndex: shards.length, sourceTokens: 0, rows: [] };
      shards.push(shard);
    }
    shard.rows.push(row);
    shard.sourceTokens += row.tokens;
  }
  const allAudit = rows.map((row) => auditDescriptor(row.source, row.roles));
  const planned = shards.map((shard) => {
    const included = new Set(shard.rows.map((row) => row.sourceId));
    return {
      shardIndex: shard.shardIndex,
      sourceTokens: shard.sourceTokens,
      sourceIds: [...included],
      sources: shard.rows.map((row) => row.source),
      excludedFromThisShardAudit: allAudit.filter((item) => !included.has(item.sourceId)),
      completeSnapshotHashes: Object.fromEntries(shard.rows.map((row) => [row.sourceId, row.sha256]))
    };
  });
  const manifest = {
    schemaVersion: 1,
    packetSha256: packet.packetSha256 || sha256(JSON.stringify(packet)),
    policy: "credit_preserving_complete_snapshot_shards",
    semanticFiltering: false,
    extractionLlm: false,
    silentTruncation: false,
    maximumSourceTokens,
    sourceCount: rows.length,
    plannedSourceCount: eligible.length,
    oversizeSourceCount: oversizeSources.length,
    shardCount: planned.length,
    roleCounts: [...roles.values()].flat().reduce((counts, role) => ({ ...counts, [role]: (counts[role] || 0) + 1 }), {}),
    sources: allAudit,
    oversizeSources
  };
  verifyPlan(packet, { shards: planned, manifest });
  return { shards: planned, manifest };
};

const verifyPlan = (packet, plan) => {
  const expected = new Map((packet.sources || []).map((source) => [source.sourceId, sha256(JSON.stringify(source))]));
  const observed = new Map();
  for (const shard of plan.shards || []) {
    for (const source of shard.sources || []) {
      if (observed.has(source.sourceId)) throw new Error(`Source ${source.sourceId} appears in multiple shards.`);
      observed.set(source.sourceId, sha256(JSON.stringify(source)));
    }
  }
  const oversize = new Set((plan.manifest?.oversizeSources || []).map((source) => source.sourceId));
  for (const [sourceId, hash] of expected) {
    if (observed.get(sourceId) !== hash && !oversize.has(sourceId)) {
      throw new Error(`Source ${sourceId} was lost or changed by shard planning.`);
    }
  }
  if (observed.size + oversize.size !== expected.size) throw new Error("Shard plan source cardinality mismatch.");
  return true;
};

const semanticText = (source) => String(source.deliveredContent || "")
  .replace(/^\[CHAR_RANGE[^\n]*\]\n/, "");

const normalizedLookupValue = (value) => String(value ?? "").toLowerCase()
  .normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const factValueText = (value) => value && typeof value === "object"
  ? Object.values(value).filter((item) => item != null && item !== "").join(" ") : String(value ?? "");
const workbookQueryTerms = (packet) => {
  const request = packet.identityContext?.request || {};
  const npi = String(request.npi || request.providerId || "").replace(/\D/g, "");
  const terms = [];
  if (/^\d{10}$/.test(npi)) terms.push({ kind: "requested_npi", value: npi, normalized: npi });
  const name = normalizedLookupValue(request.name);
  if (name) terms.push({ kind: "requested_name", value: request.name, normalized: name });
  for (const [kind, items] of [["claim_value", packet.claims || []],
    ["candidate_value", packet.preSanitizerCandidates || []]]) {
    for (const item of items) {
      const value = factValueText(item.value);
      const normalized = normalizedLookupValue(value);
      if (normalized.length >= 4) terms.push({ kind, value, normalized });
    }
  }
  return [...new Map(terms.map((term) => [`${term.kind}\0${term.normalized}`, term])).values()];
};

const parseWorkbookRow = (line, sheet, lineIndex) => {
  const matched = /^ROW (\d+): (.*)$/.exec(line);
  if (!matched) return null;
  const cells = matched[2].split(" | ").map((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) return null;
    const coordinate = entry.slice(0, separator);
    try { return { coordinate, value: JSON.parse(entry.slice(separator + 1)) }; }
    catch { return { coordinate, value: entry.slice(separator + 1) }; }
  }).filter(Boolean);
  return { sheet, rowNumber: Number(matched[1]), lineIndex, line, cells };
};

const planWorkbookProjection = (source, packet, { headerRowsPerSheet = 5 } = {}) => {
  if (source.normalizationFormat !== "workbook_rows_v1") return { source, applied: false, audit: null };
  const fullText = semanticText(source);
  const lines = fullText.split("\n");
  const rows = [];
  const sheets = new Map();
  let sheet = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const heading = /^## Sheet: (.*)$/.exec(lines[lineIndex]);
    if (heading) {
      sheet = heading[1];
      if (!sheets.has(sheet)) sheets.set(sheet, { headingLineIndex: lineIndex, rows: [] });
      continue;
    }
    const row = parseWorkbookRow(lines[lineIndex], sheet, lineIndex);
    if (!row) continue;
    rows.push(row);
    if (!sheets.has(sheet)) sheets.set(sheet, { headingLineIndex: lineIndex, rows: [] });
    sheets.get(sheet).rows.push(row);
  }
  const queries = workbookQueryTerms(packet);
  const matches = [];
  let scannedCells = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      scannedCells += 1;
      const scalar = cell.value && typeof cell.value === "object"
        ? [cell.value.formula, cell.value.cachedDisplayedValue].filter((value) => value != null)
        : [cell.value];
      for (const value of scalar) {
        const normalized = normalizedLookupValue(value);
        for (const query of queries) {
          if (normalized === query.normalized) matches.push({ sheet: row.sheet, rowNumber: row.rowNumber,
            coordinate: cell.coordinate, queryKind: query.kind, queryValue: query.value, row });
        }
      }
    }
  }
  const identityMatches = matches.filter((match) => ["requested_npi", "requested_name"].includes(match.queryKind));
  const candidateOnlyMatches = matches.filter((match) => !["requested_npi", "requested_name"].includes(match.queryKind));
  const npiColumnsBySheet = new Map();
  const npiHeaderLabels = new Set(["npi", "npi number", "provider npi", "provider npi number",
    "national provider identifier", "national provider identifier number", "individual npi",
    "practitioner npi", "rendering provider npi"]);
  const tableHeaderLabels = new Set([...npiHeaderLabels, "name", "provider name", "practitioner name",
    "phone", "phone number", "fax", "address", "street address", "city", "state", "zip",
    "zip code", "specialty", "taxonomy", "provider type", "facility", "location", "type"]);
  const npiRegionsBySheet = new Map();
  for (const [sheetName, sheetState] of sheets) {
    const columns = new Set();
    const headers = [];
    // Exact header vocabulary may repeat after section breaks or follow long
    // title blocks. Scan every row, but never infer an NPI column from a
    // merely numeric value or fuzzy substring.
    for (const row of sheetState.rows) {
      const normalizedCells = row.cells.map((cell) => normalizedLookupValue(cell.value));
      const rowColumns = row.cells.filter((cell) => npiHeaderLabels.has(normalizedLookupValue(cell.value)))
        .map((cell) => String(cell.coordinate).replace(/\d+$/, ""));
      const tableHeaderSignalCount = normalizedCells.filter((value) => tableHeaderLabels.has(value)).length;
      const nonNpiHeaderInKnownNpiColumn = row.cells.some((cell) => {
        const value = normalizedLookupValue(cell.value);
        const column = String(cell.coordinate).replace(/\d+$/, "");
        return columns.has(column) && tableHeaderLabels.has(value) && !npiHeaderLabels.has(value);
      });
      if (rowColumns.length || tableHeaderSignalCount >= 2 || nonNpiHeaderInKnownNpiColumn) {
        headers.push({ headerRow: row.rowNumber,
        columns: [...new Set(rowColumns)].sort(), containsNpiHeader: rowColumns.length > 0,
        tableHeaderSignalCount, nonNpiHeaderInKnownNpiColumn });
      }
      for (const column of rowColumns) columns.add(column);
    }
    npiColumnsBySheet.set(sheetName, columns);
    npiRegionsBySheet.set(sheetName, headers.filter((header) => header.containsNpiHeader).map((header) => ({
      ...header, startRow: header.headerRow + 1,
      endRowExclusive: headers.find((candidate) => candidate.headerRow > header.headerRow)?.headerRow ?? null
    })));
  }
  const npiColumnsForRow = (row) => {
    const region = (npiRegionsBySheet.get(row.sheet) || []).find((candidate) =>
      row.rowNumber >= candidate.startRow
      && (candidate.endRowExclusive == null || row.rowNumber < candidate.endRowExclusive));
    return new Set(region?.columns || []);
  };
  const rowNpis = (row) => row.cells.flatMap((cell) => {
    const column = String(cell.coordinate).replace(/\d+$/, "");
    if (!npiColumnsForRow(row).has(column)) return [];
    const digits = String(cell.value ?? "").replace(/\D/g, "");
    return /^\d{10}$/.test(digits) ? [digits] : [];
  });
  const identityNpis = [...new Set(identityMatches.flatMap((match) => rowNpis(match.row)))];
  const requestedNpi = queries.find((query) => query.kind === "requested_npi")?.normalized || null;
  const recognizedNpiColumnCount = [...npiColumnsBySheet.values()]
    .reduce((count, columns) => count + columns.size, 0);
  const ambiguousIdentity = identityNpis.length > 1
    && (!requestedNpi || identityNpis.some((npi) => npi !== requestedNpi));
  const exactRequestedNpiColumnMatches = matches.filter((match) => {
    if (match.queryKind !== "requested_npi") return false;
    const column = String(match.coordinate).replace(/\d+$/, "");
    return npiColumnsForRow(match.row).has(column);
  });
  const requestedNpiOutsideRegions = matches.filter((match) => match.queryKind === "requested_npi"
    && !npiColumnsForRow(match.row).has(String(match.coordinate).replace(/\d+$/, "")));
  // A workbook is automatically admissible only when its own labeled NPI
  // column contains the exact requested NPI. Name-only, unlabeled-number, and
  // zero-match projections are retrieval leads, not sufficient identity.
  const missingExactRequestedNpiAnchor = exactRequestedNpiColumnMatches.length === 0;
  const normalizationSignals = source.normalization?.manualReviewSignals || [];
  const formattedCells = new Set((source.normalization?.nonGeneralNumberFormats || [])
    .map((item) => `${item.sheet}\0${item.coordinate}`));
  const matchedFormattedCells = matches.filter((match) => formattedCells.has(`${match.sheet}\0${match.coordinate}`));
  const manualReviewReasons = [...new Set([
    ...(ambiguousIdentity ? ["MULTIPLE_DISTINCT_NPI_IDENTITY_MATCHES"] : []),
    ...(missingExactRequestedNpiAnchor ? ["NO_EXACT_REQUESTED_NPI_IN_RECOGNIZED_NPI_COLUMN"] : []),
    ...(requestedNpiOutsideRegions.length ? ["REQUESTED_NPI_OUTSIDE_RECOGNIZED_TABLE_REGION"] : []),
    ...normalizationSignals,
    ...(matchedFormattedCells.length ? ["UNMODELED_DISPLAY_FORMAT_NEEDED"] : [])
  ])];
  const requiresManualReview = manualReviewReasons.length > 0;
  const selectedLineIndices = new Set();
  for (const sheetState of sheets.values()) {
    selectedLineIndices.add(sheetState.headingLineIndex);
    for (const row of sheetState.rows.slice(0, headerRowsPerSheet)) selectedLineIndices.add(row.lineIndex);
  }
  for (const match of matches) selectedLineIndices.add(match.row.lineIndex);
  const selectedRows = [...selectedLineIndices].sort((a, b) => a - b).map((index) => lines[index]);
  const lineRanges = [];
  let lineStart = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineEnd = lineStart + lines[index].length + (index < lines.length - 1 ? 1 : 0);
    if (selectedLineIndices.has(index)) lineRanges.push([lineStart, lineEnd]);
    lineStart = lineEnd;
  }
  const selectedOriginalRanges = [];
  for (const range of lineRanges) {
    const previous = selectedOriginalRanges.at(-1);
    if (previous && previous[1] === range[0]) previous[1] = range[1];
    else selectedOriginalRanges.push([...range]);
  }
  const omittedOriginalRanges = [];
  let originalCursor = 0;
  for (const [start, end] of selectedOriginalRanges) {
    if (start > originalCursor) omittedOriginalRanges.push([originalCursor, start]);
    originalCursor = end;
  }
  if (originalCursor < fullText.length) omittedOriginalRanges.push([originalCursor, fullText.length]);
  const selectedRecords = [...new Map(matches.map((match) => [
    `${match.row.sheet}\0${match.row.rowNumber}`,
    { sheet: match.row.sheet, rowNumber: match.row.rowNumber,
      firstCoordinate: match.row.cells[0]?.coordinate || null,
      lastCoordinate: match.row.cells.at(-1)?.coordinate || null,
      cellCount: match.row.cells.length, completeRowSha256: sha256(match.row.line) }
  ])).values()];
  const audit = {
    schemaVersion: 1,
    policy: "complete_workbook_exact_value_index_v1",
    fullSourceTextSha256: sha256(fullText),
    fullSourceChars: fullText.length,
    scannedSheets: sheets.size,
    scannedRows: rows.length,
    scannedCells,
    npiColumnsBySheet: Object.fromEntries([...npiColumnsBySheet].map(([name, columns]) => [name, [...columns].sort()])),
    npiRegionsBySheet: Object.fromEntries(npiRegionsBySheet),
    recognizedNpiColumnCount,
    npiHeaderLabels: [...npiHeaderLabels],
    tableHeaderLabels: [...tableHeaderLabels],
    exactRequestedNpiColumnMatches: exactRequestedNpiColumnMatches.map(({ row: _row, ...match }) => match),
    requestedNpiOutsideRegions: requestedNpiOutsideRegions.map(({ row: _row, ...match }) => match),
    queryTerms: queries.map(({ kind, value, normalized }) => ({ kind, value, normalized })),
    exactMatches: matches.map(({ row: _row, ...match }) => match),
    selectedRowCount: new Set(matches.map((match) => `${match.sheet}\0${match.rowNumber}`)).size,
    selectedRecords,
    headerRowsPerSheet,
    ambiguousIdentity,
    requiresManualReview,
    manualReviewReason: manualReviewReasons[0] || null,
    manualReviewReasons,
    matchedFormattedCells: matchedFormattedCells.map(({ row: _row, ...match }) => match),
    semanticAdjudicationByHost: false,
    exhaustiveExactEqualityScan: true,
    modelFacingCoverage: "deterministic_index_projection_not_full_source",
    selectedOriginalRanges,
    omittedOriginalRanges
  };
  const projection = ["# Complete workbook exact-value index projection",
    `WORKBOOK_SCAN_AUDIT ${JSON.stringify(audit)}`, ...selectedRows].join("\n");
  const projectionHash = sha256(projection);
  return {
    applied: true,
    audit,
    source: {
      ...source,
      deliveredContent: `[CHAR_RANGE 0:${projection.length}; complete_workbook_index_projection]\n${projection}`,
      deliveredChars: projection.length,
      originalChars: fullText.length,
      fullTextSha256: sha256(fullText),
      projectionTextSha256: projectionHash,
      snapshotCoverage: "deterministic_index_projection_from_complete_workbook",
      deliveryMode: "complete_workbook_exact_value_index_projection",
      workbookRetrievalAudit: audit,
      omittedRanges: [],
      omittedOriginalRanges,
      fullOriginalSourceModelRead: false,
      silentlyTruncated: false
    }
  };
};

const validateNormalization = (source) => {
  const content = semanticText(source);
  const format = FORMAT_POLICY.inspectSourceFormat({
    url: source.url,
    contentType: source.contentType,
    extractionMode: source.extractionMode,
    evidenceText: content,
    normalization: {
      extractionMode: source.extractionMode || source.normalization?.extractionMode,
      evidenceText: content
    }
  });
  const declaredWorkbook = source.normalizationFormat === "workbook_rows_v1";
  const defects = [...format.defects];
  if (format.isWorkbook && !declaredWorkbook
    && !defects.includes("BINARY_WORKBOOK_ENTERED_TEXT_OR_HTML_NORMALIZER")) {
    defects.push("WORKBOOK_NORMALIZATION_FORMAT_UNDECLARED");
  }
  return { valid: defects.length === 0, defects, format };
};

const markdownBoundaries = (text) => {
  const boundaries = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") boundaries.push(index + 1);
  }
  if (boundaries.at(-1) !== text.length) boundaries.push(text.length);
  return [...new Set(boundaries)].sort((a, b) => a - b);
};

const firstGreaterThan = (values, target) => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
};

const verifyIntervalCoverage = (length, chunks) => {
  if (length === 0) return true;
  const cores = [...chunks].sort((a, b) => a.coreStart - b.coreStart || a.coreEnd - b.coreEnd);
  if (!cores.length || cores[0].coreStart !== 0 || cores.at(-1).coreEnd !== length) {
    throw new Error("Chunk core intervals do not cover both source endpoints.");
  }
  let cursor = 0;
  for (const chunk of cores) {
    if (chunk.coreStart !== cursor || chunk.coreEnd <= chunk.coreStart) {
      throw new Error(`Chunk core interval gap/overlap at ${cursor}.`);
    }
    if (chunk.deliveredStart > chunk.coreStart || chunk.deliveredEnd < chunk.coreEnd) {
      throw new Error("Delivered interval does not contain its core interval.");
    }
    cursor = chunk.coreEnd;
  }
  return true;
};

const planSourceChunks = (source, {
  countTokens,
  maximumChunkTokens = 180_000,
  maximumChunkChars = 120_000,
  overlapChars = 1_000,
  wrapperTokens = 2_000
} = {}) => {
  assertCompleteSource(source);
  if (typeof countTokens !== "function") throw new Error("countTokens is required.");
  const normalization = validateNormalization(source);
  if (!normalization.valid) return {
    sourceId: source.sourceId,
    status: "INVALID_NORMALIZATION",
    defects: normalization.defects,
    format: normalization.format,
    chunks: []
  };
  const text = semanticText(source);
  if (text.length === 0) {
    const textHash = sha256(text);
    return {
      sourceId: source.sourceId,
      status: "chunked",
      sourceChars: 0,
      sourceTextSha256: textHash,
      chunks: [{
        sourceId: source.sourceId,
        chunkIndex: 0,
        coreStart: 0,
        coreEnd: 0,
        deliveredStart: 0,
        deliveredEnd: 0,
        overlapPrefixChars: 0,
        serializedTokens: wrapperTokens,
        sourceTextSha256: textHash,
        deliveredTextSha256: textHash,
        deliveredContent: `[SOURCE ${source.sourceId}; ABS_CHAR_RANGE 0:0; CORE 0:0; SHA256 ${textHash}]\n`
      }],
      intervalUnionVerified: true,
      overlapChars
    };
  }
  const boundaries = markdownBoundaries(text);
  const chunks = [];
  let coreStart = 0;
  while (coreStart < text.length) {
    const deliveredStartTarget = Math.max(0, coreStart - overlapChars);
    // Core cuts remain row/Markdown-line boundaries. The declared overlap is
    // an exact character window so a single long preceding row cannot consume
    // the next chunk's entire budget.
    const deliveredStart = deliveredStartTarget;
    const begin = firstGreaterThan(boundaries, coreStart);
    const endExclusive = firstGreaterThan(boundaries, coreStart + maximumChunkChars);
    const candidates = boundaries.slice(begin, endExclusive);
    let candidateIndex = candidates.length - 1;
    let selected = null;
    while (candidateIndex >= 0) {
      const end = candidates[candidateIndex];
      const tokens = countTokens(text.slice(deliveredStart, end)) + wrapperTokens;
      if (tokens <= maximumChunkTokens) { selected = { end, tokens }; break; }
      candidateIndex = Math.min(candidateIndex - 1,
        Math.floor(candidateIndex * Math.max(0.1, maximumChunkTokens / tokens) * 0.95));
    }
    // Rendered HTML can contain a very long non-semantic JSON/CSS line even
    // after script removal. Preserve it losslessly by falling back to a
    // bounded character cut. Workbook rows remain indivisible because their
    // row/coordinate boundary is part of the deterministic retrieval audit.
    if (!selected && !normalization.format.isWorkbook) {
      let low = coreStart + 1;
      let high = Math.min(text.length, coreStart + maximumChunkChars);
      let fitted = null;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const tokens = countTokens(text.slice(deliveredStart, middle)) + wrapperTokens;
        if (tokens <= maximumChunkTokens) {
          fitted = { end: middle, tokens, boundaryMode: "lossless_character_fallback" };
          low = middle + 1;
        } else high = middle - 1;
      }
      if (fitted && fitted.end < text.length
        && /[\uD800-\uDBFF]/.test(text[fitted.end - 1])
        && /[\uDC00-\uDFFF]/.test(text[fitted.end])) {
        fitted.end -= 1;
        fitted.tokens = countTokens(text.slice(deliveredStart, fitted.end)) + wrapperTokens;
      }
      if (fitted?.end > coreStart) selected = fitted;
    }
    if (!selected) return {
      sourceId: source.sourceId,
      status: "UNSPLITTABLE_BLOCK_EXCEEDS_CHUNK_BUDGET",
      defects: [],
      format: normalization.format,
      chunks
    };
    const chunk = {
      sourceId: source.sourceId,
      chunkIndex: chunks.length,
      coreStart,
      coreEnd: selected.end,
      deliveredStart,
      deliveredEnd: selected.end,
      overlapPrefixChars: coreStart - deliveredStart,
      serializedTokens: selected.tokens,
      sourceTextSha256: sha256(text),
      deliveredTextSha256: sha256(text.slice(deliveredStart, selected.end)),
      boundaryMode: selected.boundaryMode || "markdown_line",
      deliveredContent: `[SOURCE ${source.sourceId}; ABS_CHAR_RANGE ${deliveredStart}:${selected.end}; CORE ${coreStart}:${selected.end}; SHA256 ${sha256(text)}]\n${text.slice(deliveredStart, selected.end)}`
    };
    chunks.push(chunk);
    coreStart = selected.end;
  }
  verifyIntervalCoverage(text.length, chunks);
  return {
    sourceId: source.sourceId,
    status: "chunked",
    sourceChars: text.length,
    sourceTextSha256: sha256(text),
    chunks,
    intervalUnionVerified: true,
    overlapChars
  };
};

const stableDedupeEvidence = (evidence) => {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = [item.sourceId, item.absoluteStart, item.absoluteEnd, item.quote].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

module.exports = {
  auditDescriptor,
  canonicalUrl,
  planEvidenceShards,
  planSourceChunks,
  planWorkbookProjection,
  workbookQueryTerms,
  selectNativeContentEvidence,
  sha256,
  sourceRoles,
  stableDedupeEvidence,
  validateNormalization,
  verifyIntervalCoverage,
  verifyPlan
};

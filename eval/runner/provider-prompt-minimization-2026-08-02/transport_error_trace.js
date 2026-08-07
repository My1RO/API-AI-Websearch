"use strict";

const serializeTransportError = (error, depth = 0, seen = new Set()) => {
  if (error == null || depth > 8) return null;
  if ((typeof error === "object" || typeof error === "function") && seen.has(error)) {
    return { circular: true };
  }
  if (typeof error === "object" || typeof error === "function") seen.add(error);
  const value = typeof error === "object" || typeof error === "function" ? error : { message: String(error) };
  return {
    constructorName: value?.constructor?.name || null,
    name: value?.name || null,
    status: value?.status ?? null,
    code: value?.code ?? null,
    message: String(value?.message || error).slice(0, 1200),
    cause: value?.cause == null ? null : serializeTransportError(value.cause, depth + 1, seen)
  };
};

module.exports = { serializeTransportError };

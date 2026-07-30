import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { AiProviderAttempt } from "./usage-telemetry";

export interface AiTransportErrorMetadata {
  name: string;
  code: string | null;
}

export interface AiTransportHttpAttempt {
  semanticAttemptId: string;
  semanticAttemptKind: AiProviderAttempt;
  httpAttemptOrdinal: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: number | null;
  responseRequestIdHeader: string | null;
  responseRequestId: string | null;
  transportError: AiTransportErrorMetadata | null;
}

export interface AiTransportSemanticAttemptTrace {
  semanticAttemptId: string;
  semanticAttemptKind: AiProviderAttempt;
  httpAttempts: AiTransportHttpAttempt[];
}

interface MutableAiTransportSemanticAttemptTrace extends AiTransportSemanticAttemptTrace {
  nextHttpAttemptOrdinal: number;
}

type FetchFunction = typeof globalThis.fetch;

const MAX_BUFFERED_HTTP_ATTEMPTS = 2_048;
const contextStorage = new AsyncLocalStorage<MutableAiTransportSemanticAttemptTrace>();
const bufferedHttpAttempts: AiTransportHttpAttempt[] = [];
const requestIdHeaders = ["x-request-id", "apim-request-id", "x-ms-request-id", "request-id"] as const;

const cloneAttempt = (attempt: AiTransportHttpAttempt): AiTransportHttpAttempt => ({
  ...attempt,
  transportError: attempt.transportError ? { ...attempt.transportError } : null
});

const sanitizedToken = (value: unknown, fallback: string | null = null): string | null => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : fallback;
};

const sanitizedTransportError = (error: unknown): AiTransportErrorMetadata => {
  const shaped = error !== null && typeof error === "object"
    ? error as { name?: unknown; code?: unknown }
    : undefined;

  return {
    name: sanitizedToken(shaped?.name, "TransportError") as string,
    code: sanitizedToken(shaped?.code)
  };
};

const responseRequestId = (response: Response): {
  responseRequestIdHeader: string | null;
  responseRequestId: string | null;
} => {
  for (const header of requestIdHeaders) {
    const value = sanitizedToken(response.headers.get(header));
    if (value) {
      return { responseRequestIdHeader: header, responseRequestId: value };
    }
  }

  return { responseRequestIdHeader: null, responseRequestId: null };
};

const persistHttpAttempt = (
  context: MutableAiTransportSemanticAttemptTrace,
  attempt: AiTransportHttpAttempt
): void => {
  context.httpAttempts.push(attempt);
  bufferedHttpAttempts.push(attempt);
  if (bufferedHttpAttempts.length > MAX_BUFFERED_HTTP_ATTEMPTS) {
    bufferedHttpAttempts.splice(0, bufferedHttpAttempts.length - MAX_BUFFERED_HTTP_ATTEMPTS);
  }

  console.log("AI provider HTTP attempt telemetry", cloneAttempt(attempt));
};

export const createAiTransportSemanticAttemptTrace = (
  semanticAttemptKind: AiProviderAttempt
): AiTransportSemanticAttemptTrace => ({
  semanticAttemptId: randomUUID(),
  semanticAttemptKind,
  httpAttempts: [],
  nextHttpAttemptOrdinal: 0
} as MutableAiTransportSemanticAttemptTrace);

export const runWithAiTransportSemanticAttempt = async <T>(
  trace: AiTransportSemanticAttemptTrace,
  callback: () => Promise<T>
): Promise<T> => contextStorage.run(trace as MutableAiTransportSemanticAttemptTrace, callback);

export const createAiTransportTracingFetch = (
  baseFetch: FetchFunction = globalThis.fetch
): FetchFunction => {
  if (typeof baseFetch !== "function") {
    throw new Error("A fetch implementation is required for Azure OpenAI transport telemetry.");
  }

  return async (input, init) => {
    const context = contextStorage.getStore();
    if (!context) {
      return baseFetch(input, init);
    }

    const httpAttemptOrdinal = ++context.nextHttpAttemptOrdinal;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();

    try {
      const response = await baseFetch(input, init);
      const endedAtMs = Date.now();
      const ids = responseRequestId(response);
      persistHttpAttempt(context, {
        semanticAttemptId: context.semanticAttemptId,
        semanticAttemptKind: context.semanticAttemptKind,
        httpAttemptOrdinal,
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: Math.max(0, endedAtMs - startedAtMs),
        status: response.status,
        ...ids,
        transportError: null
      });
      return response;
    } catch (error) {
      const endedAtMs = Date.now();
      persistHttpAttempt(context, {
        semanticAttemptId: context.semanticAttemptId,
        semanticAttemptKind: context.semanticAttemptKind,
        httpAttemptOrdinal,
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: Math.max(0, endedAtMs - startedAtMs),
        status: null,
        responseRequestIdHeader: null,
        responseRequestId: null,
        transportError: sanitizedTransportError(error)
      });
      throw error;
    }
  };
};

const groupedAttempts = (attempts: AiTransportHttpAttempt[]): AiTransportSemanticAttemptTrace[] => {
  const traces = new Map<string, AiTransportSemanticAttemptTrace>();
  for (const attempt of attempts) {
    let trace = traces.get(attempt.semanticAttemptId);
    if (!trace) {
      trace = {
        semanticAttemptId: attempt.semanticAttemptId,
        semanticAttemptKind: attempt.semanticAttemptKind,
        httpAttempts: []
      };
      traces.set(attempt.semanticAttemptId, trace);
    }
    trace.httpAttempts.push(cloneAttempt(attempt));
  }

  return [...traces.values()];
};

// Evaluation hook: records are already privacy-safe and keyed by opaque semantic-call ID.
export const getAiTransportAttemptTraces = (): AiTransportSemanticAttemptTrace[] => (
  groupedAttempts(bufferedHttpAttempts)
);

export const drainAiTransportAttemptTraces = (): AiTransportSemanticAttemptTrace[] => {
  const traces = groupedAttempts(bufferedHttpAttempts);
  bufferedHttpAttempts.splice(0, bufferedHttpAttempts.length);
  return traces;
};

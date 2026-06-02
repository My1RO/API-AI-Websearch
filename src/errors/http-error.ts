export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, detail: string, code = "REQUEST_FAILED") {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

export class AiProviderError extends Error {
  constructor(detail = "AI provider profile search failed.") {
    super(detail);
  }
}

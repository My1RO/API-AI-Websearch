import { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { AiProviderError, HttpError } from "../errors/http-error";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, "Route not found.", "ROUTE_NOT_FOUND"));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      status: error.status,
      detail: error.message,
      code: error.code
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      status: 400,
      detail: "Request validation failed.",
      code: "VALIDATION_FAILED",
      error_details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message
      }))
    });
    return;
  }

  if (error instanceof AiProviderError) {
    response.status(502).json({
      status: 502,
      detail: error.message,
      code: "AI_PROVIDER_FAILED"
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      status: 400,
      detail: "Malformed JSON request body.",
      code: "MALFORMED_JSON"
    });
    return;
  }

  console.error("Unhandled API-AI-Websearch error", {
    name: error instanceof Error ? error.name : "UnknownError"
  });

  response.status(500).json({
    status: 500,
    detail: "Request process failed.",
    code: "INTERNAL_ERROR"
  });
};

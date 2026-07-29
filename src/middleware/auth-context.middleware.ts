import { randomUUID } from "node:crypto";

import { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { HttpError } from "../errors/http-error";

export interface AuthContext {
  requestId: string;
  subdomain?: string;
  userClass?: string;
}

declare global {
  namespace Express {
    interface Request {
      authContext: AuthContext;
    }
  }
}

const safeHeader = (request: Request, name: string, maxLength = 255): string | undefined => {
  const value = request.header(name);
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
};

const requiresPublicApiContext = (): boolean => {
  return env.nodeEnv === "production";
};

export const authContextMiddleware = (request: Request, _response: Response, next: NextFunction): void => {
  const subdomain = safeHeader(request, "Lifecycle-Subdomain", 120);
  const userClass = safeHeader(request, "Lifecycle-User-Class", 32);

  request.authContext = {
    requestId: safeHeader(request, "X-Request-Id", 120) || randomUUID(),
    subdomain,
    userClass
  };

  if (requiresPublicApiContext() && !subdomain) {
    throw new HttpError(401, "Missing Public-API request context.", "MISSING_PUBLIC_API_CONTEXT");
  }

  next();
};

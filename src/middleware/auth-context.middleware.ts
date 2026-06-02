import { randomUUID } from "node:crypto";

import { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { HttpError } from "../errors/http-error";

export interface AuthContext {
  requestId: string;
  userId?: string;
  subdomain?: string;
  ipAddress?: string;
  origin?: string;
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

const firstForwardedIp = (value?: string): string | undefined => {
  return value?.split(",")[0]?.trim().slice(0, 64) || undefined;
};

const requiresPublicApiContext = (): boolean => {
  return env.nodeEnv === "production";
};

export const authContextMiddleware = (request: Request, _response: Response, next: NextFunction): void => {
  const userId = safeHeader(request, "Lifecycle-User-Id") || safeHeader(request, "User-Id");
  const subdomain = safeHeader(request, "Lifecycle-Subdomain", 120);

  request.authContext = {
    requestId: safeHeader(request, "X-Request-Id", 120) || randomUUID(),
    userId,
    subdomain,
    ipAddress: firstForwardedIp(safeHeader(request, "X-Forwarded-For")) || safeHeader(request, "Ip-Address", 64),
    origin: safeHeader(request, "Origin", 255)
  };

  if (requiresPublicApiContext() && (!userId || !subdomain)) {
    throw new HttpError(401, "Missing Public-API request context.", "MISSING_PUBLIC_API_CONTEXT");
  }

  next();
};

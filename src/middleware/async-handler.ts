import { NextFunction, Request, Response } from "express";

export const asyncHandler = (
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) => {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
};

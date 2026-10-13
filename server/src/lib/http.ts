import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Session locked or expired') => new HttpError(401, m, 'unauthorized');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');
export const upstream = (m: string, details?: unknown) => new HttpError(502, m, 'upstream_error', details);
export const notConfigured = (m: string) => new HttpError(412, m, 'provider_not_configured');

/** Wraps an async handler so rejections reach the Express error middleware. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const sendJson = (res: Response, status: number, body: unknown) => {
  res.status(status).json(body);
};

export const ok = <T>(res: Response, data: T) => res.status(200).json({ ok: true, data });

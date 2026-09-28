import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { badRequest } from './errors';

/** Wraps an async route so rejected promises reach the error handler. */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parseId(value: string | undefined, what = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${what}`);
  return n;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

/** Escapes LIKE wildcards; use with `ESCAPE '\'`. */
export function likePattern(term: string, mode: 'contains' | 'prefix' = 'contains'): string {
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  return mode === 'prefix' ? `${escaped}%` : `%${escaped}%`;
}

/** Comma-separated query value → array. */
export function csv(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

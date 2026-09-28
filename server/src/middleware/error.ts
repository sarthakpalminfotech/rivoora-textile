import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@rivoora/shared';
import { HttpError } from '../lib/errors';
import { UnsupportedImageError } from '../storage/types';

function send(res: Parameters<ErrorRequestHandler>[2], status: number, message: string, field?: string) {
  const body: ApiErrorBody = { error: field ? { message, field } : { message } };
  res.status(status).json(body);
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  send(res, 404, 'Not found');
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    send(res, err.status, err.message, err.field);
    return;
  }
  if (err instanceof UnsupportedImageError) {
    send(res, 400, err.message, 'file');
    return;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    send(res, 400, issue?.message ?? 'Invalid input', issue?.path.join('.') || undefined);
    return;
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large. Maximum size is 10 MB.'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field. Upload a single image in the "file" field.'
          : err.message;
    send(res, 400, message, 'file');
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    send(res, 400, 'Invalid JSON body');
    return;
  }
  const text = String((err as Error)?.message ?? err);
  if (/UNIQUE constraint failed/i.test(text)) {
    send(res, 409, 'A record with the same value already exists');
    return;
  }
  console.error('[error]', err);
  send(res, 500, 'Something went wrong. Please try again.');
};

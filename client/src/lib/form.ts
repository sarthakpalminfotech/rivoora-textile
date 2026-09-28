import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Shows a server validation error inline on the matching field.
 * Returns true when it was handled (so no toast is needed).
 */
export function applyServerFieldError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
  aliases: Record<string, string> = {},
): boolean {
  if (!(err instanceof ApiError) || !err.field) return false;
  const name = aliases[err.field] ?? err.field;
  if (!fields.includes(name)) return false;
  setError(name as Path<T>, { type: 'server', message: err.message }, { shouldFocus: true });
  return true;
}

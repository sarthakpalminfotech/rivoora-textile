import type { RequestHandler } from 'express';
import { can, isRoleKey, ROLE_HEADER, type RoleKey, type RolePermissions } from '../config/roles';
import { HttpError, forbidden } from '../lib/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      role: RoleKey;
    }
  }
}

/** Reads the acting role from the X-Role header (no login in this sprint). */
export const roleMiddleware: RequestHandler = (req, _res, next) => {
  const raw = req.header(ROLE_HEADER)?.trim().toLowerCase();
  if (!isRoleKey(raw)) {
    next(new HttpError(400, `Missing or invalid ${ROLE_HEADER} header`));
    return;
  }
  req.role = raw;
  next();
};

export function requirePermission(...permissions: (keyof RolePermissions)[]): RequestHandler {
  return (req, _res, next) => {
    // Any one of the listed permissions is enough.
    if (permissions.some((p) => can(req.role, p))) next();
    else next(forbidden());
  };
}

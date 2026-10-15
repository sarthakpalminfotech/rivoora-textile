import type { RequestHandler } from 'express';
import { ACT_AS_HEADER, resolveActingRole, type AuthUser } from '@rivoora/shared';
import { can, type RoleKey, type RolePermissions } from '../config/roles';
import { HttpError, forbidden } from '../lib/errors';
import { runWithUser } from '../lib/request-context';
import { SESSION_COOKIE, userForToken } from '../services/auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The ACTING role: the user's own role, or the role a switching user (Jenish / Gaurang) acts as. */
      role: RoleKey;
      /** The logged-in user (their own role, never the acted-as one). */
      user: AuthUser;
      userId: number;
    }
  }
}

/** Reads one cookie from the Cookie header (no cookie-parser dependency). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Every /api route behind this needs a valid session. `req.role` comes from the logged-in user; only users whose role
 * has `canSwitchRoles` may act as another role (X-Act-As) — for everyone else the header is ignored. History rows
 * keep the acting role and, via the request context, the real user id.
 */
export const authMiddleware: RequestHandler = (req, _res, next) => {
  userForToken(readCookie(req.headers.cookie, SESSION_COOKIE))
    .then((user) => {
      if (!user) {
        next(new HttpError(401, 'Please log in'));
        return;
      }
      req.user = user;
      req.userId = user.id;
      req.role = resolveActingRole(user.role, req.header(ACT_AS_HEADER)).role;
      runWithUser(user.id, () => next());
    })
    .catch(next);
};

export function requirePermission(...permissions: (keyof RolePermissions)[]): RequestHandler {
  return (req, _res, next) => {
    // Any one of the listed permissions is enough.
    if (permissions.some((p) => can(req.role, p))) next();
    else next(forbidden());
  };
}

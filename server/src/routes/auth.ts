import { Router } from 'express';
import { env } from '../env';
import { ah } from '../lib/http';
import { authMiddleware, readCookie } from '../middleware/role';
import { login, logout, SESSION_COOKIE } from '../services/auth';

/** Login / me / logout. Login is the only public /api route (besides /health). */
export const authRouter = Router();

const secure = env.isProduction || Boolean(process.env.VERCEL);

function setCookie(value: string, maxAgeMs: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

authRouter.post(
  '/login',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const result = await login(req.body, req.ip ?? 'unknown');
    res.setHeader('Set-Cookie', setCookie(result.token, result.maxAgeMs));
    res.json({ user: result.user });
  }),
);

authRouter.get('/me', authMiddleware, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user });
});

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    await logout(readCookie(req.headers.cookie, SESSION_COOKIE));
    res.setHeader('Set-Cookie', setCookie('', 0));
    res.json({ ok: true });
  }),
);

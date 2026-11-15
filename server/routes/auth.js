import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { ApiError, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/util.js';

export const COOKIE = 'sms_token';

// Fixed hash so unknown-email logins cost the same as wrong-password logins (timing equalisation).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export function authRouter({ db, config }) {
  const r = Router();
  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionHours * 3600 * 1000, path: '/' };
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.loginRateLimit, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in a few minutes.' } }),
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      audit(db, null, 'login_failed', 'user', null, { email });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    const token = jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
    res.cookie(COOKIE, token, cookieOpts);
    audit(db, user, 'login', 'user', user.id);
    res.json({ data: publicUser(user) });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
    res.json({ data: { ok: true } });
  });

  return r;
}

export function authMiddleware({ db, config }) {
  return (req, _res, next) => {
    const raw = (req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    if (!raw) return next();
    try {
      const payload = jwt.verify(decodeURIComponent(raw.slice(COOKIE.length + 1)), config.jwtSecret);
      const user = db.prepare('SELECT id, name, email, role, active, token_version FROM users WHERE id = ?').get(payload.sub);
      if (user && user.active && user.token_version === payload.tv) req.user = user;
    } catch { /* invalid/expired token => anonymous */ }
    next();
  };
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export function accountRouter({ db }) {
  const r = Router();
  r.get('/me', (req, res) => res.json({ data: publicUser(req.user) }));
  r.post('/change-password', async (req, res) => {
    const body = z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(8, 'At least 8 characters').max(100)
        .regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
    }).parse(req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await bcrypt.compare(body.current_password, row.password_hash))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Current password is incorrect', { fields: { current_password: 'Incorrect password' } });
    }
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(await bcrypt.hash(body.new_password, 10), req.user.id);
    audit(db, req.user, 'change_password', 'user', req.user.id);
    res.json({ data: { ok: true, relogin: true } });
  });
  return r;
}

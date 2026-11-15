import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, normalizeError, notFound } from './lib/errors.js';
import { authMiddleware, authRouter, accountRouter, requireAuth } from './routes/auth.js';
import { academicsRouter } from './routes/academics.js';
import { peopleRouter } from './routes/people.js';
import { attendanceRouter } from './routes/attendance.js';
import { examsRouter } from './routes/exams.js';
import { feesRouter } from './routes/fees.js';
import { reportsRouter, auditRouter } from './routes/reports.js';
import { openApiSpec, docsHtml } from './openapi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(here, '..', 'client', 'dist');

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET (at least 32 characters) is required when NODE_ENV=production');
  }
  return {
    production,
    port: Number(env.PORT) || 3000,
    dbPath: env.DB_PATH || path.join(here, '..', 'data', 'school.db'),
    jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
    sessionHours: Number(env.SESSION_HOURS) || 8,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT) || 20,
  };
}

export function createApp({ db, config = loadConfig() }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'style-src': ["'self'", "'unsafe-inline'"], 'script-src': ["'self'"], 'frame-ancestors': ["'none'"] } } }));
  app.use(express.json({ limit: '200kb' }));

  // CSRF defence in depth (cookie is SameSite=Lax): state-changing requests must be same-origin if an Origin header is sent.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return next(new ApiError(403, 'CSRF', 'Cross-origin request blocked'));
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ data: { status: 'ok', time: new Date().toISOString() } }); });
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));
  app.get('/api/docs', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self'");
    res.type('html').send(docsHtml);
  });

  const ctx = { db, config };
  app.use('/api', authMiddleware(ctx));
  app.use('/api/auth', authRouter(ctx));
  app.use('/api', requireAuth); // everything below needs a valid session
  app.use('/api/auth', accountRouter(ctx));
  app.use('/api', academicsRouter(ctx));
  app.use('/api', peopleRouter(ctx));
  app.use('/api/attendance', attendanceRouter(ctx));
  app.use('/api', examsRouter(ctx));
  app.use('/api/fees', feesRouter(ctx));
  app.use('/api/reports', reportsRouter(ctx));
  app.use('/api/audit', auditRouter(ctx));
  app.use('/api', (_req, _res, next) => next(notFound('Unknown API endpoint')));

  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(clientDist, 'index.html')) : next()));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const known = normalizeError(err);
    if (known) {
      return res.status(known.status).json({ error: { code: known.code, message: known.message, ...(known.details ? { details: known.details } : {}) } });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  });
  return app;
}

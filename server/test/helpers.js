import { createApp, loadConfig } from '../app.js';
import { migrate, openDb } from '../lib/db.js';
import { DEMO_PASSWORD, seed } from '../seed.js';

export async function startTestServer() {
  const db = openDb(':memory:');
  migrate(db);
  seed(db);
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-12', LOGIN_RATE_LIMIT: '10000' });
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** Minimal API client with its own cookie jar. */
  const client = () => {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(`${base}/api${path}`, {
        method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() ?? [];
      const token = set.find((c) => c.startsWith('sms_token='));
      if (token) cookie = token.split(';')[0];
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* csv etc */ }
      return { status: res.status, body: json, text, headers: res.headers };
    };
    return {
      get: (p, h) => call('GET', p, undefined, h), post: (p, b = {}, h) => call('POST', p, b, h),
      put: (p, b, h) => call('PUT', p, b, h), patch: (p, b, h) => call('PATCH', p, b, h), delete: (p) => call('DELETE', p),
      login: async (email, password = DEMO_PASSWORD) => { const r = await call('POST', '/auth/login', { email, password }); if (r.status !== 200) throw new Error(`login failed ${r.status}`); return r; },
    };
  };
  const as = async (email) => { const c = client(); await c.login(email); return c; };
  return { db, base, client, as, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

export const today = () => new Date().toISOString().slice(0, 10);

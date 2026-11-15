export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'Something went wrong');
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.fields = body?.error?.details?.fields ?? {};
    this.details = body?.error?.details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' } });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, json);
  }
  return json;
}

export const api = {
  get: (p) => request('GET', p), post: (p, b = {}, h) => request('POST', p, b, h), put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b), del: (p) => request('DELETE', p),
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n ?? 0);
export const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fmtDateTime = (d) => (d ? new Date(`${String(d).replace(' ', 'T')}Z`).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');

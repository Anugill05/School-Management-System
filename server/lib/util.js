import { z } from 'zod';

export const audit = (db, user, action, entity, entityId, details) =>
  db.prepare('INSERT INTO audit_log (actor_id, actor_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)')
    .run(user?.id ?? null, user?.name ?? 'system', action, entity, entityId == null ? null : String(entityId),
      details === undefined ? null : JSON.stringify(details));

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Not a valid date');

export const id = z.coerce.number().int().positive();
export const trimmed = (max = 120) => z.string().trim().min(1, 'Required').max(max);

export const todayStr = () => new Date().toISOString().slice(0, 10);

export function paging(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const pageMeta = ({ page, pageSize }, total) => ({ page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) });

/** LIKE pattern with escaped wildcards. */
export const like = (s) => `%${String(s).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

export function sendRows(req, res, rows, columns, filename) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows, columns));
  }
  return res.json({ data: rows });
}

export function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

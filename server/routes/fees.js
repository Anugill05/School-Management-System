import { Router } from 'express';
import { z } from 'zod';
import { assertStudentAccess, guardianStudents, requireRole } from '../lib/access.js';
import { tx } from '../lib/db.js';
import { ApiError, badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { fromCents, invoiceStatus, toCents } from '../lib/money.js';
import { audit, dateStr, id, like, pageMeta, paging, todayStr, trimmed } from '../lib/util.js';

const admin = requireRole('admin');
const amountField = z.union([z.number(), z.string()]).transform((v, ctx) => {
  try { return toCents(v); } catch (e) { ctx.addIssue({ code: 'custom', message: e.message }); return z.NEVER; }
});

export function feesRouter({ db }) {
  const r = Router();

  // Invoice with ledger-derived money. paid/voided/outstanding always come from fee_ledger, never from a stored counter.
  const invoiceSql = `SELECT i.id, i.number, i.student_id, i.title, i.due_date, i.status, i.void_reason, i.created_at,
      i.amount_cents,
      COALESCE(-(SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id = i.id AND l.entry_type='payment'),0) AS paid_cents,
      COALESCE(-(SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id = i.id AND l.entry_type='void'),0) AS voided_cents,
      COALESCE((SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id = i.id),0) AS outstanding_cents,
      s.first_name || ' ' || s.last_name AS student_name, s.admission_no, sec.id AS section_id, c.name || ' - ' || sec.name AS section_label
    FROM fee_invoices i JOIN students s ON s.id = i.student_id JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id`;

  const shape = (x) => ({
    ...x, amount: fromCents(x.amount_cents), paid: fromCents(x.paid_cents), voided: fromCents(x.voided_cents),
    outstanding: fromCents(x.outstanding_cents),
    overdue: x.outstanding_cents > 0 && x.status !== 'void' && x.due_date < todayStr(),
  });

  r.get('/invoices', requireRole('admin', 'guardian'), (req, res) => {
    const pg = paging(req.query);
    const where = [];
    const params = [];
    if (req.user.role === 'guardian') {
      const ids = guardianStudents(db, req.user);
      if (!ids.length) return res.json({ data: [], meta: pageMeta(pg, 0) });
      where.push(`i.student_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids);
    }
    if (req.query.student_id) { where.push('i.student_id = ?'); params.push(Number(req.query.student_id)); }
    if (req.query.section_id) { where.push('s.section_id = ?'); params.push(Number(req.query.section_id)); }
    if (['issued', 'partial', 'paid', 'void'].includes(req.query.status)) { where.push('i.status = ?'); params.push(req.query.status); }
    if (req.query.overdue === '1') { where.push("i.status IN ('issued','partial') AND i.due_date < ?"); params.push(todayStr()); }
    if (req.query.q) { where.push("(i.number LIKE ? ESCAPE '\\' OR s.first_name LIKE ? ESCAPE '\\' OR s.last_name LIKE ? ESCAPE '\\' OR s.admission_no LIKE ? ESCAPE '\\' OR i.title LIKE ? ESCAPE '\\')"); const p = like(req.query.q); params.push(p, p, p, p, p); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM fee_invoices i JOIN students s ON s.id = i.student_id ${w}`).get(...params).c;
    const rows = db.prepare(`${invoiceSql} ${w} ORDER BY i.due_date DESC, i.id DESC LIMIT ? OFFSET ?`).all(...params, pg.pageSize, pg.offset);
    res.json({ data: rows.map(shape), meta: pageMeta(pg, total) });
  });

  r.get('/invoices/:id', requireRole('admin', 'guardian'), (req, res) => {
    const inv = db.prepare(`${invoiceSql} WHERE i.id = ?`).get(id.parse(req.params.id));
    if (!inv) throw notFound('Invoice not found');
    assertStudentAccess(db, req.user, inv.student_id);
    const ledger = db.prepare(`SELECT l.id, l.entry_type, l.amount_cents, l.method, l.reference, l.created_at, u.name AS created_by_name
      FROM fee_ledger l LEFT JOIN users u ON u.id = l.created_by WHERE l.invoice_id = ? ORDER BY l.id`).all(inv.id);
    res.json({ data: { ...shape(inv), ledger: ledger.map((l) => ({ ...l, amount: fromCents(l.amount_cents) })) } });
  });

  // Create one invoice (student_id) or one per active student of a section/class.
  r.post('/invoices', admin, (req, res) => {
    const b = z.object({
      student_id: id.optional(), section_id: id.optional(), class_id: id.optional(),
      title: trimmed(120), amount: amountField, due_date: dateStr,
    }).refine((v) => [v.student_id, v.section_id, v.class_id].filter(Boolean).length === 1, 'Choose exactly one of student, section or class').parse(req.body);

    const created = tx(db, () => {
      let students;
      if (b.student_id) students = db.prepare("SELECT id FROM students WHERE id=? AND status='active'").all(b.student_id);
      else if (b.section_id) students = db.prepare("SELECT id FROM students WHERE section_id=? AND status='active'").all(b.section_id);
      else students = db.prepare("SELECT s.id FROM students s JOIN sections sec ON sec.id = s.section_id WHERE sec.class_id=? AND s.status='active'").all(b.class_id);
      if (!students.length) throw unprocessable('No active students match this selection', undefined, 'NO_STUDENTS');
      // Guard against double-click / re-submit creating the same bulk charge twice.
      const dup = db.prepare(`SELECT COUNT(*) c FROM fee_invoices WHERE title=? AND due_date=? AND amount_cents=? AND status != 'void'
          AND student_id IN (${students.map(() => '?').join(',')})`).get(b.title, b.due_date, b.amount, ...students.map((s) => s.id)).c;
      if (dup) throw conflict(`${dup} matching invoice(s) with this title, amount and due date already exist`, { duplicates: dup }, 'DUPLICATE_INVOICE');

      let next = db.prepare('SELECT COALESCE(MAX(id),0) + 1 AS n FROM fee_invoices').get().n;
      const year = new Date().getUTCFullYear();
      const insInv = db.prepare('INSERT INTO fee_invoices (number, student_id, title, due_date, amount_cents, created_by) VALUES (?,?,?,?,?,?)');
      const insLedger = db.prepare("INSERT INTO fee_ledger (invoice_id, student_id, entry_type, amount_cents, created_by) VALUES (?,?,'charge',?,?)");
      const ids = [];
      for (const s of students) {
        const inv = insInv.run(`INV-${year}-${String(next++).padStart(5, '0')}`, s.id, b.title, b.due_date, b.amount, req.user.id);
        insLedger.run(inv.lastInsertRowid, s.id, b.amount, req.user.id);
        ids.push(Number(inv.lastInsertRowid));
      }
      audit(db, req.user, 'create_invoices', 'invoice', ids[0], { count: ids.length, title: b.title, amount_cents: b.amount, scope: b.student_id ? 'student' : b.section_id ? 'section' : 'class' });
      return ids;
    });
    res.status(201).json({ data: { created: created.length, invoice_ids: created } });
  });

  r.post('/invoices/:id/void', admin, (req, res) => {
    const iid = id.parse(req.params.id);
    const b = z.object({ reason: trimmed(200) }).parse(req.body);
    tx(db, () => {
      const inv = db.prepare(`${invoiceSql} WHERE i.id = ?`).get(iid);
      if (!inv) throw notFound('Invoice not found');
      if (inv.status === 'void') throw conflict('Invoice is already void', undefined, 'INVALID_STATE');
      if (inv.paid_cents > 0) throw conflict('Invoices with payments cannot be voided', undefined, 'INVALID_STATE');
      db.prepare("INSERT INTO fee_ledger (invoice_id, student_id, entry_type, amount_cents, reference, created_by) VALUES (?,?,'void',?,?,?)")
        .run(iid, inv.student_id, -inv.outstanding_cents, b.reason, req.user.id);
      db.prepare("UPDATE fee_invoices SET status='void', void_reason=? WHERE id=?").run(b.reason, iid);
      audit(db, req.user, 'void_invoice', 'invoice', iid, b);
    });
    res.json({ data: shape(db.prepare(`${invoiceSql} WHERE i.id = ?`).get(iid)) });
  });

  // Simulated payment. No card data is accepted or stored. Requires an Idempotency-Key header.
  r.post('/invoices/:id/payments', requireRole('admin', 'guardian'), (req, res) => {
    const iid = id.parse(req.params.id);
    const key = String(req.get('Idempotency-Key') ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw badRequest('An Idempotency-Key header (8-64 chars: letters, digits, - or _) is required');
    const b = z.object({ amount: amountField, method: z.enum(['card', 'bank_transfer', 'cash', 'upi']), reference: z.string().trim().max(80).optional().nullable() }).parse(req.body);
    if (req.user.role === 'guardian' && b.method === 'cash') throw forbidden('Cash payments are recorded by the school office');

    const out = tx(db, () => {
      const inv = db.prepare(`${invoiceSql} WHERE i.id = ?`).get(iid);
      if (!inv) throw notFound('Invoice not found');
      assertStudentAccess(db, req.user, inv.student_id);

      const prior = db.prepare('SELECT * FROM fee_ledger WHERE idempotency_key = ?').get(key);
      if (prior) {
        if (prior.invoice_id !== iid || -prior.amount_cents !== b.amount) throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
        return { replayed: true, payment_id: prior.id };
      }
      if (inv.status === 'void') throw conflict('This invoice has been voided', undefined, 'INVALID_STATE');
      if (inv.outstanding_cents <= 0) throw conflict('This invoice is already fully paid', undefined, 'ALREADY_PAID');
      if (b.amount > inv.outstanding_cents) throw conflict(`Payment exceeds the outstanding balance of ${fromCents(inv.outstanding_cents).toFixed(2)}`, { outstanding: fromCents(inv.outstanding_cents) }, 'OVERPAYMENT');

      const ref = b.reference || `SIM-${Date.now().toString(36).toUpperCase()}`;
      const p = db.prepare("INSERT INTO fee_ledger (invoice_id, student_id, entry_type, amount_cents, method, reference, idempotency_key, created_by) VALUES (?,?,'payment',?,?,?,?,?)")
        .run(iid, inv.student_id, -b.amount, b.method, ref, key, req.user.id);
      const outstanding = inv.outstanding_cents - b.amount;
      db.prepare('UPDATE fee_invoices SET status=? WHERE id=?').run(invoiceStatus({ amount_cents: inv.amount_cents, outstanding_cents: outstanding }), iid);
      audit(db, req.user, 'record_payment', 'invoice', iid, { amount_cents: b.amount, method: b.method, reference: ref });
      return { replayed: false, payment_id: Number(p.lastInsertRowid) };
    });
    res.status(out.replayed ? 200 : 201).json({ data: { ...out, invoice: shape(db.prepare(`${invoiceSql} WHERE i.id = ?`).get(iid)) } });
  });

  // Student ledger with totals that reconcile: invoiced - paid - voided = outstanding.
  r.get('/students/:id/ledger', requireRole('admin', 'guardian'), (req, res) => {
    const student = assertStudentAccess(db, req.user, id.parse(req.params.id));
    const entries = db.prepare(`SELECT l.id, l.invoice_id, i.number, i.title, l.entry_type, l.amount_cents, l.method, l.reference, l.created_at
      FROM fee_ledger l JOIN fee_invoices i ON i.id = l.invoice_id WHERE l.student_id = ? ORDER BY l.id`).all(student.id);
    const sum = (t) => entries.filter((e) => e.entry_type === t).reduce((a, e) => a + e.amount_cents, 0);
    const invoiced = sum('charge'); const paid = -sum('payment'); const voided = -sum('void');
    const outstanding = entries.reduce((a, e) => a + e.amount_cents, 0);
    res.json({ data: {
      entries: entries.map((e) => ({ ...e, amount: fromCents(e.amount_cents) })),
      totals: { invoiced: fromCents(invoiced), paid: fromCents(paid), voided: fromCents(voided), outstanding: fromCents(outstanding), reconciled: invoiced - paid - voided === outstanding },
    } });
  });

  r.get('/summary', admin, (_req, res) => {
    const t = db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_type='charge' THEN amount_cents END),0) AS invoiced,
        COALESCE(-SUM(CASE WHEN entry_type='payment' THEN amount_cents END),0) AS paid,
        COALESCE(-SUM(CASE WHEN entry_type='void' THEN amount_cents END),0) AS voided, COALESCE(SUM(amount_cents),0) AS outstanding FROM fee_ledger`).get();
    const overdue = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o),0) AS cents FROM (SELECT (SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id=i.id) AS o
        FROM fee_invoices i WHERE i.status IN ('issued','partial') AND i.due_date < ?)`).get(todayStr());
    const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM fee_invoices GROUP BY status').all();
    res.json({ data: { invoiced: fromCents(t.invoiced), paid: fromCents(t.paid), voided: fromCents(t.voided), outstanding: fromCents(t.outstanding),
      collection_rate: t.invoiced - t.voided > 0 ? Math.round((t.paid / (t.invoiced - t.voided)) * 1000) / 10 : null,
      overdue_count: overdue.n, overdue_amount: fromCents(overdue.cents), by_status: byStatus } });
  });

  return r;
}

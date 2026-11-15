import { Router } from 'express';
import { z } from 'zod';
import { assertSection, assertStudentAccess, requireRole } from '../lib/access.js';
import { tx } from '../lib/db.js';
import { unprocessable } from '../lib/errors.js';
import { audit, dateStr, id, todayStr } from '../lib/util.js';

const SESSIONS = ['morning', 'afternoon'];
const STATUSES = ['present', 'absent', 'late', 'excused'];

/** Attendance % = (present + late) / (present + late + absent). Excused days are excluded from the denominator. */
export function attendanceRate(c) {
  const denom = c.present + c.late + c.absent;
  return denom === 0 ? null : Math.round(((c.present + c.late) / denom) * 1000) / 10;
}

export function attendanceRouter({ db }) {
  const r = Router();

  r.get('/roster', requireRole('admin', 'teacher'), (req, res) => {
    const q = z.object({ section_id: id, date: dateStr, session: z.enum(SESSIONS).default('morning') }).parse(req.query);
    assertSection(db, req.user, q.section_id);
    const rows = db.prepare(`SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, a.status, a.note
      FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ? AND a.session = ?
      WHERE s.section_id = ? AND s.status = 'active' ORDER BY s.last_name, s.first_name`).all(q.date, q.session, q.section_id);
    res.json({ data: rows, meta: { marked: rows.filter((x) => x.status).length, total: rows.length } });
  });

  // Idempotent bulk save: UNIQUE(student_id,date,session) + UPSERT => a second submission updates, never duplicates.
  r.put('/', requireRole('admin', 'teacher'), (req, res) => {
    const b = z.object({
      section_id: id, date: dateStr, session: z.enum(SESSIONS),
      records: z.array(z.object({ student_id: id, status: z.enum(STATUSES), note: z.string().trim().max(200).optional().nullable() })).min(1).max(200),
    }).parse(req.body);
    if (b.date > todayStr()) throw unprocessable('Attendance cannot be recorded for a future date', { fields: { date: 'Future date' } }, 'FUTURE_DATE');
    assertSection(db, req.user, b.section_id);

    const seen = new Set();
    for (const rec of b.records) {
      if (seen.has(rec.student_id)) throw unprocessable(`Student ${rec.student_id} appears more than once in this request`, undefined, 'DUPLICATE_IN_REQUEST');
      seen.add(rec.student_id);
    }
    const result = tx(db, () => {
      const inSection = new Set(db.prepare("SELECT id FROM students WHERE section_id=? AND status='active'").all(b.section_id).map((s) => s.id));
      const stranger = b.records.find((x) => !inSection.has(x.student_id));
      if (stranger) throw unprocessable(`Student ${stranger.student_id} is not an active student of this section`, undefined, 'STUDENT_NOT_IN_SECTION');
      const existing = db.prepare('SELECT student_id, status FROM attendance WHERE section_id=? AND date=? AND session=?').all(b.section_id, b.date, b.session);
      const before = new Map(existing.map((e) => [e.student_id, e.status]));
      const up = db.prepare(`INSERT INTO attendance (student_id, section_id, date, session, status, note, marked_by)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(student_id, date, session)
        DO UPDATE SET status=excluded.status, note=excluded.note, marked_by=excluded.marked_by, updated_at=datetime('now')`);
      let created = 0; let updated = 0; let unchanged = 0;
      for (const rec of b.records) {
        const prev = before.get(rec.student_id);
        if (prev === undefined) created++; else if (prev !== rec.status) updated++; else unchanged++;
        up.run(rec.student_id, b.section_id, b.date, b.session, rec.status, rec.note ?? null, req.user.id);
      }
      audit(db, req.user, 'mark_attendance', 'section', b.section_id, { date: b.date, session: b.session, created, updated, unchanged });
      return { created, updated, unchanged };
    });
    res.json({ data: result });
  });

  const rangeQ = z.object({ from: dateStr.optional(), to: dateStr.optional() });
  const monthStart = () => `${todayStr().slice(0, 8)}01`;

  r.get('/summary', requireRole('admin', 'teacher'), (req, res) => {
    const q = rangeQ.extend({ section_id: id }).parse(req.query);
    assertSection(db, req.user, q.section_id);
    const from = q.from ?? monthStart();
    const to = q.to ?? todayStr();
    const rows = db.prepare(`SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name,
        COALESCE(SUM(a.status='present'),0) AS present, COALESCE(SUM(a.status='absent'),0) AS absent,
        COALESCE(SUM(a.status='late'),0) AS late, COALESCE(SUM(a.status='excused'),0) AS excused
      FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
      WHERE s.section_id = ? AND s.status='active' GROUP BY s.id ORDER BY s.last_name, s.first_name`).all(from, to, q.section_id)
      .map((x) => ({ ...x, rate: attendanceRate(x) }));
    const tot = rows.reduce((a, x) => ({ present: a.present + x.present, absent: a.absent + x.absent, late: a.late + x.late, excused: a.excused + x.excused }), { present: 0, absent: 0, late: 0, excused: 0 });
    res.json({ data: rows, meta: { from, to, totals: { ...tot, rate: attendanceRate(tot) } } });
  });

  r.get('/student/:id', (req, res) => {
    const student = assertStudentAccess(db, req.user, id.parse(req.params.id));
    const q = rangeQ.parse(req.query);
    const from = q.from ?? '1970-01-01';
    const to = q.to ?? todayStr();
    const c = db.prepare(`SELECT COALESCE(SUM(status='present'),0) AS present, COALESCE(SUM(status='absent'),0) AS absent,
        COALESCE(SUM(status='late'),0) AS late, COALESCE(SUM(status='excused'),0) AS excused
      FROM attendance WHERE student_id = ? AND date BETWEEN ? AND ?`).get(student.id, from, to);
    const recent = db.prepare(`SELECT date, session, status, note FROM attendance WHERE student_id=? AND date BETWEEN ? AND ?
      ORDER BY date DESC, session LIMIT 60`).all(student.id, from, to);
    res.json({ data: { summary: { ...c, rate: attendanceRate(c) }, records: recent } });
  });

  return r;
}

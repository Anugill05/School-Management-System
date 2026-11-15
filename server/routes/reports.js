import { Router } from 'express';
import { z } from 'zod';
import { guardianStudents, requireRole, teacherSections } from '../lib/access.js';
import { ApiError } from '../lib/errors.js';
import { assignRanks, computeResult } from '../lib/grading.js';
import { fromCents } from '../lib/money.js';
import { audit, dateStr, id, like, pageMeta, paging, sendRows, todayStr } from '../lib/util.js';
import { attendanceRate } from './attendance.js';

export function reportsRouter({ db }) {
  const r = Router();

  const scopedSections = (user) => (user.role === 'admin' ? null : teacherSections(db, user));
  const inList = (col, list) => ({ sql: `${col} IN (${list.map(() => '?').join(',') || 'NULL'})`, params: list });

  // DASHBOARD (role specific) ---------------------------------------------------
  r.get('/dashboard', (req, res) => {
    const u = req.user;
    const today = todayStr();
    if (u.role === 'admin') {
      const count = (sql, ...p) => db.prepare(sql).get(...p).c;
      const att = db.prepare(`SELECT COALESCE(SUM(status='present'),0) present, COALESCE(SUM(status='late'),0) late, COALESCE(SUM(status='absent'),0) absent
        FROM attendance WHERE date >= date(?, '-6 day')`).get(today);
      const trend = db.prepare(`SELECT date, COALESCE(SUM(status IN ('present','late')),0) attended, COALESCE(SUM(status IN ('present','late','absent')),0) denom
        FROM attendance WHERE date >= date(?, '-13 day') GROUP BY date ORDER BY date`).all(today)
        .map((x) => ({ date: x.date, rate: x.denom ? Math.round((x.attended / x.denom) * 1000) / 10 : null }));
      const fees = db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_type='charge' THEN amount_cents END),0) invoiced,
        COALESCE(-SUM(CASE WHEN entry_type='payment' THEN amount_cents END),0) paid, COALESCE(SUM(amount_cents),0) outstanding FROM fee_ledger`).get();
      return res.json({ data: { role: 'admin',
        stats: { students: count("SELECT COUNT(*) c FROM students WHERE status='active'"), teachers: count('SELECT COUNT(*) c FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.active=1'),
          classes: count('SELECT COUNT(*) c FROM sections'), open_exams: count("SELECT COUNT(*) c FROM exams WHERE status='open'") },
        attendance_7d: { ...att, rate: attendanceRate(att) }, attendance_trend: trend,
        fees: { invoiced: fromCents(fees.invoiced), paid: fromCents(fees.paid), outstanding: fromCents(fees.outstanding) },
        overdue_invoices: count("SELECT COUNT(*) c FROM fee_invoices WHERE status IN ('issued','partial') AND due_date < ?", today),
        recent_activity: db.prepare('SELECT id, actor_name, action, entity, entity_id, created_at FROM audit_log ORDER BY id DESC LIMIT 8').all() } });
    }
    if (u.role === 'teacher') {
      const secs = db.prepare(`SELECT s.id, c.name || ' - ' || s.name AS label, (SELECT COUNT(*) FROM students st WHERE st.section_id = s.id AND st.status='active') AS students,
          GROUP_CONCAT(sub.name, ', ') AS subjects,
          (SELECT COUNT(DISTINCT a.session) FROM attendance a WHERE a.section_id = s.id AND a.date = ?) AS sessions_marked_today
        FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id JOIN sections s ON s.id = ta.section_id JOIN classes c ON c.id = s.class_id
        JOIN subjects sub ON sub.id = ta.subject_id WHERE t.user_id = ? GROUP BY s.id ORDER BY c.name, s.name`).all(today, u.id);
      const pendingMarks = db.prepare(`SELECT e.id AS exam_id, e.name AS exam, sub.id AS subject_id, sub.name AS subject, s.id AS section_id, c.name || ' - ' || s.name AS section,
          (SELECT COUNT(*) FROM students st WHERE st.section_id = s.id AND st.status='active') AS students,
          (SELECT COUNT(*) FROM marks m JOIN students st ON st.id = m.student_id WHERE m.exam_id = e.id AND m.subject_id = sub.id AND st.section_id = s.id AND st.status='active'
             AND (m.is_absent=1 OR m.marks_obtained IS NOT NULL)) AS entered
        FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id JOIN sections s ON s.id = ta.section_id JOIN classes c ON c.id = s.class_id
        JOIN exams e ON e.class_id = c.id AND e.status = 'open' JOIN exam_subjects es ON es.exam_id = e.id AND es.subject_id = ta.subject_id JOIN subjects sub ON sub.id = ta.subject_id
        WHERE t.user_id = ?`).all(u.id).filter((x) => x.entered < x.students);
      return res.json({ data: { role: 'teacher', sections: secs, pending_marks: pendingMarks } });
    }
    const ids = guardianStudents(db, u);
    const children = ids.length ? db.prepare(`SELECT s.id, s.first_name || ' ' || s.last_name AS name, s.admission_no, c.name || ' - ' || sec.name AS section,
        COALESCE((SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.student_id = s.id),0) AS outstanding_cents,
        (SELECT COALESCE(SUM(status IN ('present','late')),0) FROM attendance a WHERE a.student_id = s.id) AS attended,
        (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.status != 'excused') AS total,
        (SELECT COUNT(*) FROM fee_invoices i WHERE i.student_id = s.id AND i.status IN ('issued','partial') AND i.due_date < ?) AS overdue
      FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id WHERE s.id IN (${ids.map(() => '?').join(',')})`).all(today, ...ids) : [];
    res.json({ data: { role: 'guardian', children: children.map((c) => ({ id: c.id, name: c.name, admission_no: c.admission_no, section: c.section,
      outstanding: fromCents(c.outstanding_cents), overdue_invoices: c.overdue, attendance_rate: c.total ? Math.round((c.attended / c.total) * 1000) / 10 : null })) } });
  });

  // ATTENDANCE REPORT ---------------------------------------------------------------
  r.get('/attendance', requireRole('admin', 'teacher'), (req, res) => {
    const q = z.object({ from: dateStr.optional(), to: dateStr.optional(), class_id: id.optional(), section_id: id.optional(), threshold: z.coerce.number().min(0).max(100).optional() }).parse(req.query);
    const from = q.from ?? `${todayStr().slice(0, 8)}01`;
    const to = q.to ?? todayStr();
    const where = ["st.status='active'"]; const params = [from, to];
    const scope = scopedSections(req.user);
    if (scope) { const l = inList('st.section_id', scope); where.push(l.sql); params.push(...l.params); }
    if (q.section_id) { where.push('st.section_id = ?'); params.push(q.section_id); }
    if (q.class_id) { where.push('sec.class_id = ?'); params.push(q.class_id); }
    const rows = db.prepare(`SELECT st.id AS student_id, st.admission_no, st.first_name || ' ' || st.last_name AS student, c.name || ' - ' || sec.name AS section,
        COALESCE(SUM(a.status='present'),0) AS present, COALESCE(SUM(a.status='late'),0) AS late, COALESCE(SUM(a.status='absent'),0) AS absent, COALESCE(SUM(a.status='excused'),0) AS excused
      FROM students st JOIN sections sec ON sec.id = st.section_id JOIN classes c ON c.id = sec.class_id
      LEFT JOIN attendance a ON a.student_id = st.id AND a.date BETWEEN ? AND ?
      WHERE ${where.join(' AND ')} GROUP BY st.id ORDER BY section, st.last_name`).all(...params)
      .map((x) => ({ ...x, rate: attendanceRate(x) }))
      .filter((x) => q.threshold === undefined || (x.rate !== null && x.rate < q.threshold));
    sendRows(req, res, rows, ['admission_no', 'student', 'section', 'present', 'late', 'absent', 'excused', 'rate'], `attendance-${from}-to-${to}`);
  });

  // ACADEMIC REPORT ----------------------------------------------------------------------
  r.get('/academic', requireRole('admin', 'teacher'), (req, res) => {
    const q = z.object({ exam_id: id, section_id: id.optional() }).parse(req.query);
    const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(q.exam_id);
    if (!exam || (req.user.role === 'teacher' && exam.status === 'draft')) throw new ApiError(404, 'NOT_FOUND', 'Exam not found');
    const rule = db.prepare('SELECT * FROM grading_rules WHERE id=?').get(exam.grading_rule_id);
    rule.bands = db.prepare('SELECT min_percent, grade, remark, gpa FROM grade_bands WHERE rule_id=?').all(rule.id);
    const subjects = db.prepare('SELECT es.*, s.name, s.code FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id WHERE es.exam_id=?').all(exam.id);
    const where = ["st.status='active'", 'sec.class_id = ?']; const params = [exam.class_id];
    const scope = scopedSections(req.user);
    if (scope) { const l = inList('st.section_id', scope); where.push(l.sql); params.push(...l.params); }
    if (q.section_id) { where.push('st.section_id = ?'); params.push(q.section_id); }
    const students = db.prepare(`SELECT st.id, st.admission_no, st.first_name || ' ' || st.last_name AS name, c.name || ' - ' || sec.name AS section FROM students st
      JOIN sections sec ON sec.id = st.section_id JOIN classes c ON c.id = sec.class_id WHERE ${where.join(' AND ')}`).all(...params);
    const marks = students.length ? db.prepare(`SELECT student_id, subject_id, marks_obtained, is_absent FROM marks WHERE exam_id=? AND student_id IN (${students.map(() => '?').join(',')})`).all(exam.id, ...students.map((s) => s.id)) : [];
    const results = students.map((s) => {
      const mm = new Map(marks.filter((m) => m.student_id === s.id).map((m) => [m.subject_id, m]));
      return { ...s, ...computeResult(subjects.map((sub) => ({ subject_id: sub.subject_id, name: sub.name, max_marks: sub.max_marks, pass_marks: sub.pass_marks,
        marks_obtained: mm.get(sub.subject_id)?.marks_obtained ?? null, is_absent: !!mm.get(sub.subject_id)?.is_absent })), rule) };
    });
    assignRanks(results);
    const complete = results.filter((x) => x.result !== 'INCOMPLETE');
    const dist = {}; complete.forEach((x) => { dist[x.grade] = (dist[x.grade] ?? 0) + 1; });
    const perSubject = subjects.map((sub) => {
      const entries = results.map((x) => x.subjects.find((y) => y.subject_id === sub.subject_id)).filter((y) => y && y.status !== 'pending');
      const pct = entries.map((y) => y.percent);
      return { subject_id: sub.subject_id, subject: sub.name, entered: entries.length, average: pct.length ? Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10 : null,
        highest: pct.length ? Math.max(...pct) : null, lowest: pct.length ? Math.min(...pct) : null, pass_rate: entries.length ? Math.round((entries.filter((y) => y.passed).length / entries.length) * 1000) / 10 : null };
    });
    const rows = results.map((x) => ({ admission_no: x.admission_no, student: x.name, section: x.section, total: x.total_obtained, max: x.total_max, percent: x.percent, grade: x.grade, result: x.result, rank: x.rank }));
    if (req.query.format === 'csv') return sendRows(req, res, rows, ['admission_no', 'student', 'section', 'total', 'max', 'percent', 'grade', 'result', 'rank'], `academic-${exam.id}`);
    res.json({ data: { exam: { id: exam.id, name: exam.name, status: exam.status }, summary: { students: results.length, complete: complete.length,
      pass_rate: complete.length ? Math.round((complete.filter((x) => x.result === 'PASS').length / complete.length) * 1000) / 10 : null,
      average_percent: complete.length ? Math.round((complete.reduce((a, x) => a + x.percent, 0) / complete.length) * 10) / 10 : null, grade_distribution: dist },
      per_subject: perSubject, toppers: [...complete].sort((a, b) => a.rank - b.rank).slice(0, 5).map((x) => ({ name: x.name, section: x.section, percent: x.percent, grade: x.grade, rank: x.rank })), rows } });
  });

  // FEE REPORT --------------------------------------------------------------------------------
  r.get('/fees', requireRole('admin'), (req, res) => {
    const q = z.object({ class_id: id.optional(), status: z.enum(['issued', 'partial', 'paid', 'void']).optional(), q: z.string().optional() }).parse(req.query);
    const where = ["i.status != 'void'"]; const params = [];
    if (q.class_id) { where.push('sec.class_id = ?'); params.push(q.class_id); }
    if (q.status) { where.splice(0, 1, 'i.status = ?'); params.unshift(q.status); }
    if (q.q) { where.push("(s.first_name || ' ' || s.last_name LIKE ? ESCAPE '\\' OR s.admission_no LIKE ? ESCAPE '\\')"); params.push(like(q.q), like(q.q)); }
    const rows = db.prepare(`SELECT s.admission_no, s.first_name || ' ' || s.last_name AS student, c.name || ' - ' || sec.name AS section,
        COUNT(i.id) AS invoices, SUM(i.amount_cents) AS invoiced,
        COALESCE(-SUM((SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id=i.id AND l.entry_type='payment')),0) AS paid,
        SUM((SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id=i.id)) AS outstanding,
        MIN(CASE WHEN i.status IN ('issued','partial') THEN i.due_date END) AS oldest_due
      FROM fee_invoices i JOIN students s ON s.id = i.student_id JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
      WHERE ${where.join(' AND ')} GROUP BY s.id ORDER BY outstanding DESC, s.last_name`).all(...params)
      .map((x) => ({ ...x, invoiced: fromCents(x.invoiced), paid: fromCents(x.paid), outstanding: fromCents(x.outstanding), overdue: !!x.oldest_due && x.oldest_due < todayStr() }));
    sendRows(req, res, rows, ['admission_no', 'student', 'section', 'invoices', 'invoiced', 'paid', 'outstanding', 'oldest_due'], 'fees-report');
  });

  return r;
}

export function auditRouter({ db }) {
  const r = Router();
  r.get('/', requireRole('admin'), (req, res) => {
    const pg = paging(req.query, { defaultSize: 25 });
    const where = []; const params = [];
    if (req.query.entity) { where.push('entity = ?'); params.push(String(req.query.entity)); }
    if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action)); }
    if (req.query.q) { where.push("(actor_name LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\' OR entity_id = ?)"); params.push(like(req.query.q), like(req.query.q), String(req.query.q)); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM audit_log ${w}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pg.pageSize, pg.offset)
      .map((x) => ({ ...x, details: x.details ? JSON.parse(x.details) : null }));
    const filters = { entities: db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').all().map((x) => x.entity), actions: db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map((x) => x.action) };
    res.json({ data: rows, meta: { ...pageMeta(pg, total), filters } });
  });
  return r;
}

void audit;

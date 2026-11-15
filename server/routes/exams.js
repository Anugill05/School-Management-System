import { Router } from 'express';
import { z } from 'zod';
import { assertSection, assertStudentAccess, guardianStudents, requireRole, teacherSections, teachesSubject } from '../lib/access.js';
import { tx } from '../lib/db.js';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { assignRanks, computeResult, validateBands } from '../lib/grading.js';
import { audit, dateStr, id, trimmed } from '../lib/util.js';

const admin = requireRole('admin');
const TRANSITIONS = { draft: ['open'], open: ['published', 'draft'], published: ['open'] };

export function examsRouter({ db }) {
  const r = Router();

  // GRADING RULES -------------------------------------------------------------
  const loadRule = (ruleId) => {
    const rule = db.prepare('SELECT * FROM grading_rules WHERE id=?').get(ruleId);
    if (!rule) return null;
    rule.bands = db.prepare('SELECT min_percent, grade, remark, gpa FROM grade_bands WHERE rule_id=? ORDER BY min_percent DESC').all(ruleId);
    return rule;
  };
  const bandSchema = z.object({ min_percent: z.coerce.number().min(0).max(100), grade: z.string().trim().min(1).max(4), remark: z.string().trim().max(40).optional().nullable(), gpa: z.coerce.number().min(0).max(10).default(0) });
  const ruleBody = z.object({ name: trimmed(60), pass_percent: z.coerce.number().min(0).max(100), is_default: z.boolean().default(false), bands: z.array(bandSchema).min(1).max(15) });
  const checkBands = (bands) => { try { validateBands(bands); } catch (e) { throw unprocessable(e.message, { fields: { bands: e.message } }, 'INVALID_GRADING_RULE'); } };
  const saveBands = (ruleId, bands) => {
    db.prepare('DELETE FROM grade_bands WHERE rule_id=?').run(ruleId);
    const ins = db.prepare('INSERT INTO grade_bands (rule_id, min_percent, grade, remark, gpa) VALUES (?,?,?,?,?)');
    for (const b of bands) ins.run(ruleId, b.min_percent, b.grade, b.remark ?? null, b.gpa);
  };

  r.get('/grading-rules', requireRole('admin', 'teacher'), (_req, res) => {
    const rules = db.prepare('SELECT id FROM grading_rules ORDER BY is_default DESC, name').all().map((x) => loadRule(x.id));
    const used = new Set(db.prepare('SELECT DISTINCT grading_rule_id AS id FROM exams').all().map((x) => x.id));
    res.json({ data: rules.map((x) => ({ ...x, in_use: used.has(x.id) })) });
  });
  r.post('/grading-rules', admin, (req, res) => {
    const b = ruleBody.parse(req.body);
    checkBands(b.bands);
    const rid = tx(db, () => {
      if (b.is_default) db.prepare('UPDATE grading_rules SET is_default=0').run();
      const x = db.prepare('INSERT INTO grading_rules (name, pass_percent, is_default) VALUES (?,?,?)').run(b.name, b.pass_percent, b.is_default ? 1 : 0);
      saveBands(x.lastInsertRowid, b.bands);
      audit(db, req.user, 'create', 'grading_rule', x.lastInsertRowid, b);
      return Number(x.lastInsertRowid);
    });
    res.status(201).json({ data: loadRule(rid) });
  });
  r.put('/grading-rules/:id', admin, (req, res) => {
    const rid = id.parse(req.params.id);
    const b = ruleBody.parse(req.body);
    checkBands(b.bands);
    tx(db, () => {
      if (!db.prepare('SELECT 1 FROM grading_rules WHERE id=?').get(rid)) throw notFound('Grading rule not found');
      if (db.prepare("SELECT 1 FROM exams WHERE grading_rule_id=? AND status='published'").get(rid)) {
        throw conflict('This rule is used by a published exam. Create a new rule instead of changing published results.', undefined, 'RULE_LOCKED');
      }
      if (b.is_default) db.prepare('UPDATE grading_rules SET is_default=0').run();
      db.prepare('UPDATE grading_rules SET name=?, pass_percent=?, is_default=? WHERE id=?').run(b.name, b.pass_percent, b.is_default ? 1 : 0, rid);
      saveBands(rid, b.bands);
      audit(db, req.user, 'update', 'grading_rule', rid, b);
    });
    res.json({ data: loadRule(rid) });
  });
  r.delete('/grading-rules/:id', admin, (req, res) => {
    const rid = id.parse(req.params.id);
    if (db.prepare('SELECT 1 FROM exams WHERE grading_rule_id=?').get(rid)) throw conflict('This rule is used by an exam');
    if (!db.prepare('DELETE FROM grading_rules WHERE id=?').run(rid).changes) throw notFound('Grading rule not found');
    audit(db, req.user, 'delete', 'grading_rule', rid);
    res.json({ data: { ok: true } });
  });

  // EXAMS ---------------------------------------------------------------------
  const examRow = (examId) => db.prepare(`SELECT e.*, c.name AS class_name, c.academic_year, gr.name AS rule_name,
      (SELECT COUNT(*) FROM exam_subjects es WHERE es.exam_id = e.id) AS subject_count
      FROM exams e JOIN classes c ON c.id = e.class_id JOIN grading_rules gr ON gr.id = e.grading_rule_id WHERE e.id = ?`).get(examId);
  const examSubjects = (examId) => db.prepare(`SELECT es.subject_id, es.max_marks, es.pass_marks, s.name, s.code
      FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id WHERE es.exam_id = ? ORDER BY s.name`).all(examId);

  /** Exam visible to this user? Guardians: published only, for their children's class. Teachers: non-draft in their classes. */
  function assertExamVisible(user, exam) {
    if (!exam) throw notFound('Exam not found');
    if (user.role === 'admin') return;
    if (user.role === 'teacher') {
      const secs = teacherSections(db, user);
      const classes = new Set(secs.map((s) => db.prepare('SELECT class_id FROM sections WHERE id=?').get(s)?.class_id));
      if (exam.status !== 'draft' && classes.has(exam.class_id)) return;
      throw notFound('Exam not found');
    }
    if (user.role === 'guardian' && exam.status === 'published') {
      const ids = guardianStudents(db, user);
      if (ids.length && db.prepare(`SELECT 1 FROM students s JOIN sections sec ON sec.id = s.section_id
          WHERE s.id IN (${ids.map(() => '?').join(',')}) AND sec.class_id = ?`).get(...ids, exam.class_id)) return;
    }
    throw notFound('Exam not found');
  }

  r.get('/exams', (req, res) => {
    let rows = db.prepare('SELECT id FROM exams ORDER BY created_at DESC, id DESC').all().map((x) => examRow(x.id));
    rows = rows.filter((e) => { try { assertExamVisible(req.user, e); return true; } catch { return false; } });
    if (req.query.class_id) rows = rows.filter((e) => e.class_id === Number(req.query.class_id));
    res.json({ data: rows });
  });

  r.get('/exams/:id', (req, res) => {
    const exam = examRow(id.parse(req.params.id));
    assertExamVisible(req.user, exam);
    res.json({ data: { ...exam, subjects: examSubjects(exam.id), rule: loadRule(exam.grading_rule_id) } });
  });

  const subjectsSchema = z.array(z.object({ subject_id: id, max_marks: z.coerce.number().positive().max(1000), pass_marks: z.coerce.number().min(0) })).min(1, 'Add at least one subject').max(20)
    .superRefine((arr, ctx) => {
      if (new Set(arr.map((x) => x.subject_id)).size !== arr.length) ctx.addIssue({ code: 'custom', message: 'A subject appears twice' });
      arr.forEach((x, i) => { if (x.pass_marks > x.max_marks) ctx.addIssue({ code: 'custom', path: [i, 'pass_marks'], message: 'Pass marks cannot exceed max marks' }); });
    });
  const examBody = z.object({ name: trimmed(80), term: trimmed(40).default('Term 1'), class_id: id, grading_rule_id: id, start_date: dateStr.optional().nullable(), subjects: subjectsSchema });

  r.post('/exams', admin, (req, res) => {
    const b = examBody.parse(req.body);
    const eid = tx(db, () => {
      if (!db.prepare('SELECT 1 FROM classes WHERE id=?').get(b.class_id)) throw notFound('Class not found');
      if (!db.prepare('SELECT 1 FROM grading_rules WHERE id=?').get(b.grading_rule_id)) throw notFound('Grading rule not found');
      const x = db.prepare('INSERT INTO exams (name, term, class_id, grading_rule_id, start_date, created_by) VALUES (?,?,?,?,?,?)')
        .run(b.name, b.term, b.class_id, b.grading_rule_id, b.start_date ?? null, req.user.id);
      const ins = db.prepare('INSERT INTO exam_subjects (exam_id, subject_id, max_marks, pass_marks) VALUES (?,?,?,?)');
      for (const s of b.subjects) ins.run(x.lastInsertRowid, s.subject_id, s.max_marks, s.pass_marks);
      audit(db, req.user, 'create', 'exam', x.lastInsertRowid, { name: b.name, class_id: b.class_id });
      return Number(x.lastInsertRowid);
    });
    res.status(201).json({ data: { ...examRow(eid), subjects: examSubjects(eid) } });
  });

  r.patch('/exams/:id', admin, (req, res) => {
    const eid = id.parse(req.params.id);
    const b = examBody.omit({ class_id: true }).parse(req.body);
    tx(db, () => {
      const e = db.prepare('SELECT * FROM exams WHERE id=?').get(eid);
      if (!e) throw notFound('Exam not found');
      if (e.status !== 'draft') throw conflict('Only draft exams can be edited. Move the exam back to draft first.', undefined, 'INVALID_STATE');
      db.prepare('UPDATE exams SET name=?, term=?, grading_rule_id=?, start_date=? WHERE id=?').run(b.name, b.term, b.grading_rule_id, b.start_date ?? null, eid);
      db.prepare('DELETE FROM exam_subjects WHERE exam_id=?').run(eid);
      const ins = db.prepare('INSERT INTO exam_subjects (exam_id, subject_id, max_marks, pass_marks) VALUES (?,?,?,?)');
      for (const s of b.subjects) ins.run(eid, s.subject_id, s.max_marks, s.pass_marks);
      audit(db, req.user, 'update', 'exam', eid, { name: b.name });
    });
    res.json({ data: { ...examRow(eid), subjects: examSubjects(eid) } });
  });

  r.delete('/exams/:id', admin, (req, res) => {
    const eid = id.parse(req.params.id);
    const e = db.prepare('SELECT status FROM exams WHERE id=?').get(eid);
    if (!e) throw notFound('Exam not found');
    if (e.status !== 'draft') throw conflict('Only draft exams can be deleted', undefined, 'INVALID_STATE');
    db.prepare('DELETE FROM exams WHERE id=?').run(eid);
    audit(db, req.user, 'delete', 'exam', eid);
    res.json({ data: { ok: true } });
  });

  const classStudents = (examId, sectionId = null) => db.prepare(`SELECT s.id, s.section_id FROM students s JOIN sections sec ON sec.id = s.section_id
      JOIN exams e ON e.class_id = sec.class_id WHERE e.id = ? AND s.status='active' ${sectionId ? 'AND s.section_id = ?' : ''}`).all(...(sectionId ? [examId, sectionId] : [examId]));

  function missingMarks(examId) {
    const subs = db.prepare('SELECT COUNT(*) c FROM exam_subjects WHERE exam_id=?').get(examId).c;
    const students = classStudents(examId).length;
    const filled = db.prepare(`SELECT COUNT(*) c FROM marks m JOIN students s ON s.id = m.student_id WHERE m.exam_id=? AND s.status='active'
        AND (m.is_absent = 1 OR m.marks_obtained IS NOT NULL)`).get(examId).c;
    return subs * students - filled;
  }

  r.post('/exams/:id/status', admin, (req, res) => {
    const eid = id.parse(req.params.id);
    const b = z.object({ status: z.enum(['draft', 'open', 'published']), force: z.boolean().optional() }).parse(req.body);
    tx(db, () => {
      const e = db.prepare('SELECT * FROM exams WHERE id=?').get(eid);
      if (!e) throw notFound('Exam not found');
      if (!TRANSITIONS[e.status].includes(b.status)) throw conflict(`Cannot move an exam from ${e.status} to ${b.status}`, { allowed: TRANSITIONS[e.status] }, 'INVALID_STATE');
      if (b.status === 'draft' && db.prepare('SELECT 1 FROM marks WHERE exam_id=? LIMIT 1').get(eid)) throw conflict('Marks have already been entered; the exam cannot go back to draft', undefined, 'INVALID_STATE');
      if (b.status === 'published') {
        const missing = missingMarks(eid);
        if (missing > 0 && !b.force) throw conflict(`${missing} mark entries are still missing. Complete them or publish with force.`, { missing }, 'MARKS_INCOMPLETE');
      }
      db.prepare('UPDATE exams SET status=? WHERE id=?').run(b.status, eid);
      audit(db, req.user, `exam_${b.status}`, 'exam', eid, { from: e.status, to: b.status, forced: !!b.force });
    });
    res.json({ data: examRow(eid) });
  });

  // MARKS ENTRY ---------------------------------------------------------------
  r.get('/exams/:id/marks', requireRole('admin', 'teacher'), (req, res) => {
    const eid = id.parse(req.params.id);
    const q = z.object({ section_id: id, subject_id: id }).parse(req.query);
    const exam = examRow(eid);
    assertExamVisible(req.user, exam);
    assertSection(db, req.user, q.section_id);
    if (!teachesSubject(db, req.user, q.section_id, q.subject_id)) throw forbidden('You do not teach this subject in this section');
    const es = db.prepare('SELECT * FROM exam_subjects WHERE exam_id=? AND subject_id=?').get(eid, q.subject_id);
    if (!es) throw notFound('Subject is not part of this exam');
    const rows = db.prepare(`SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, m.marks_obtained, COALESCE(m.is_absent,0) AS is_absent
      FROM students s LEFT JOIN marks m ON m.student_id = s.id AND m.exam_id = ? AND m.subject_id = ?
      WHERE s.section_id = ? AND s.status='active' ORDER BY s.last_name, s.first_name`).all(eid, q.subject_id, q.section_id);
    res.json({ data: rows, meta: { max_marks: es.max_marks, pass_marks: es.pass_marks, status: exam.status, editable: exam.status === 'open' } });
  });

  r.put('/exams/:id/marks', requireRole('admin', 'teacher'), (req, res) => {
    const eid = id.parse(req.params.id);
    const b = z.object({
      section_id: id, subject_id: id,
      entries: z.array(z.object({ student_id: id, marks_obtained: z.coerce.number().min(0).nullable().optional(), is_absent: z.boolean().default(false) })).min(1).max(200),
    }).parse(req.body);
    const exam = examRow(eid);
    assertExamVisible(req.user, exam);
    assertSection(db, req.user, b.section_id);
    if (!teachesSubject(db, req.user, b.section_id, b.subject_id)) throw forbidden('You do not teach this subject in this section');
    if (exam.status !== 'open') throw conflict(`Marks can only be entered while the exam is open (currently ${exam.status})`, undefined, 'INVALID_STATE');
    const es = db.prepare('SELECT * FROM exam_subjects WHERE exam_id=? AND subject_id=?').get(eid, b.subject_id);
    if (!es) throw notFound('Subject is not part of this exam');
    const section = db.prepare('SELECT class_id FROM sections WHERE id=?').get(b.section_id);
    if (section.class_id !== exam.class_id) throw unprocessable('This section does not belong to the exam\'s class', undefined, 'WRONG_CLASS');

    const fieldErrors = {};
    b.entries.forEach((e, i) => {
      if (e.is_absent && e.marks_obtained != null) fieldErrors[`entries.${i}`] = 'An absent student cannot have marks';
      else if (e.marks_obtained != null && e.marks_obtained > es.max_marks) fieldErrors[`entries.${i}`] = `Marks cannot exceed ${es.max_marks}`;
    });
    if (Object.keys(fieldErrors).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Some marks are invalid', { fields: fieldErrors });

    const saved = tx(db, () => {
      const inSection = new Set(db.prepare("SELECT id FROM students WHERE section_id=? AND status='active'").all(b.section_id).map((s) => s.id));
      const bad = b.entries.find((e) => !inSection.has(e.student_id));
      if (bad) throw unprocessable(`Student ${bad.student_id} is not an active student of this section`, undefined, 'STUDENT_NOT_IN_SECTION');
      const up = db.prepare(`INSERT INTO marks (exam_id, subject_id, student_id, marks_obtained, is_absent, entered_by) VALUES (?,?,?,?,?,?)
        ON CONFLICT(exam_id, subject_id, student_id) DO UPDATE SET marks_obtained=excluded.marks_obtained, is_absent=excluded.is_absent,
        entered_by=excluded.entered_by, updated_at=datetime('now')`);
      for (const e of b.entries) up.run(eid, b.subject_id, e.student_id, e.is_absent ? null : (e.marks_obtained ?? null), e.is_absent ? 1 : 0, req.user.id);
      audit(db, req.user, 'enter_marks', 'exam', eid, { section_id: b.section_id, subject_id: b.subject_id, count: b.entries.length });
      return b.entries.length;
    });
    res.json({ data: { saved } });
  });

  // RESULTS & REPORT CARDS -------------------------------------------------------
  function buildResults(exam, studentIds) {
    const subjects = examSubjects(exam.id);
    const rule = loadRule(exam.grading_rule_id);
    const marks = studentIds.length ? db.prepare(`SELECT student_id, subject_id, marks_obtained, is_absent FROM marks WHERE exam_id=? AND student_id IN (${studentIds.map(() => '?').join(',')})`).all(exam.id, ...studentIds) : [];
    const byStudent = new Map();
    for (const m of marks) { if (!byStudent.has(m.student_id)) byStudent.set(m.student_id, new Map()); byStudent.get(m.student_id).set(m.subject_id, m); }
    return studentIds.map((sid) => {
      const mm = byStudent.get(sid);
      const result = computeResult(subjects.map((s) => ({ subject_id: s.subject_id, name: s.name, code: s.code, max_marks: s.max_marks, pass_marks: s.pass_marks,
        marks_obtained: mm?.get(s.subject_id)?.marks_obtained ?? null, is_absent: !!mm?.get(s.subject_id)?.is_absent })), rule);
      return { student_id: sid, ...result };
    });
  }

  r.get('/exams/:id/results', requireRole('admin', 'teacher'), (req, res) => {
    const exam = examRow(id.parse(req.params.id));
    assertExamVisible(req.user, exam);
    const sectionId = id.parse(req.query.section_id);
    assertSection(db, req.user, sectionId);
    const students = db.prepare("SELECT id, admission_no, first_name, last_name FROM students WHERE section_id=? AND status='active' ORDER BY last_name, first_name").all(sectionId);
    const results = assignRanks(buildResults(exam, students.map((s) => s.id)));
    res.json({ data: students.map((s, i) => ({ ...s, ...results[i] })), meta: { exam: { id: exam.id, name: exam.name, status: exam.status } } });
  });

  r.get('/report-cards/:studentId', (req, res) => {
    const student = assertStudentAccess(db, req.user, id.parse(req.params.studentId));
    const sec = db.prepare('SELECT class_id FROM sections WHERE id=?').get(student.section_id);
    const visible = req.user.role === 'admin' ? "e.status != 'draft'" : req.user.role === 'teacher' ? "e.status != 'draft'" : "e.status = 'published'";
    res.json({ data: db.prepare(`SELECT e.id, e.name, e.term, e.status FROM exams e WHERE e.class_id = ? AND ${visible} ORDER BY e.created_at DESC, e.id DESC`).all(sec.class_id) });
  });

  r.get('/report-cards/:studentId/:examId', (req, res) => {
    const student = assertStudentAccess(db, req.user, id.parse(req.params.studentId));
    const exam = examRow(id.parse(req.params.examId));
    assertExamVisible(req.user, exam);
    const sec = db.prepare(`SELECT sec.id, sec.name, sec.class_id FROM sections sec WHERE sec.id = ?`).get(student.section_id);
    if (sec.class_id !== exam.class_id) throw notFound('This exam does not apply to the student');
    const classmates = db.prepare("SELECT id FROM students WHERE section_id=? AND status='active'").all(sec.id).map((x) => x.id);
    if (!classmates.includes(student.id)) classmates.push(student.id);
    const all = assignRanks(buildResults(exam, classmates));
    const mine = all.find((x) => x.student_id === student.id);
    const att = db.prepare(`SELECT COALESCE(SUM(status IN ('present','late')),0) AS attended, COUNT(*) AS total FROM attendance WHERE student_id=? AND status != 'excused'`).get(student.id);
    res.json({ data: {
      student: { id: student.id, admission_no: student.admission_no, name: `${student.first_name} ${student.last_name}`, dob: student.dob, section: sec.name },
      exam: { id: exam.id, name: exam.name, term: exam.term, class_name: exam.class_name, academic_year: exam.academic_year, status: exam.status, rule_name: exam.rule_name },
      ...mine, class_size: all.filter((x) => x.percent !== null).length,
      attendance_percent: att.total ? Math.round((att.attended / att.total) * 1000) / 10 : null,
      bands: loadRule(exam.grading_rule_id).bands, pass_percent: loadRule(exam.grading_rule_id).pass_percent,
      generated_at: new Date().toISOString(),
    } });
  });

  return r;
}

export { examsRouter as default };

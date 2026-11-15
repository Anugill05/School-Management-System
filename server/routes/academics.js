import { Router } from 'express';
import { z } from 'zod';
import { requireRole, teacherSections } from '../lib/access.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit, id, trimmed } from '../lib/util.js';

const admin = requireRole('admin');

export function academicsRouter({ db }) {
  const r = Router();

  // CLASSES + SECTIONS ------------------------------------------------------
  r.get('/classes', (req, res) => {
    const classes = db.prepare('SELECT * FROM classes ORDER BY academic_year DESC, name').all();
    let sections = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM students st WHERE st.section_id = s.id AND st.status='active') AS student_count
                               FROM sections s ORDER BY s.name`).all();
    if (req.user.role === 'teacher') {
      const mine = new Set(teacherSections(db, req.user));
      sections = sections.filter((s) => mine.has(s.id));
      const classIds = new Set(sections.map((s) => s.class_id));
      return res.json({ data: classes.filter((c) => classIds.has(c.id)).map((c) => ({ ...c, sections: sections.filter((s) => s.class_id === c.id) })) });
    }
    if (req.user.role === 'guardian') return res.json({ data: [] });
    res.json({ data: classes.map((c) => ({ ...c, sections: sections.filter((s) => s.class_id === c.id) })) });
  });

  const classBody = z.object({ name: trimmed(60), academic_year: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Use format 2025-2026') });
  r.post('/classes', admin, (req, res) => {
    const b = classBody.parse(req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO classes (name, academic_year) VALUES (?,?)').run(b.name, b.academic_year);
    audit(db, req.user, 'create', 'class', lastInsertRowid, b);
    res.status(201).json({ data: { id: Number(lastInsertRowid), ...b, sections: [] } });
  });
  r.patch('/classes/:id', admin, (req, res) => {
    const cid = id.parse(req.params.id);
    const b = classBody.parse(req.body);
    if (!db.prepare('UPDATE classes SET name=?, academic_year=? WHERE id=?').run(b.name, b.academic_year, cid).changes) throw notFound('Class not found');
    audit(db, req.user, 'update', 'class', cid, b);
    res.json({ data: { id: cid, ...b } });
  });
  r.delete('/classes/:id', admin, (req, res) => {
    const cid = id.parse(req.params.id);
    if (db.prepare('SELECT 1 FROM sections WHERE class_id=?').get(cid)) throw conflict('Delete this class\'s sections first');
    if (db.prepare('SELECT 1 FROM exams WHERE class_id=?').get(cid)) throw conflict('This class has exams and cannot be deleted');
    if (!db.prepare('DELETE FROM classes WHERE id=?').run(cid).changes) throw notFound('Class not found');
    audit(db, req.user, 'delete', 'class', cid);
    res.json({ data: { ok: true } });
  });

  const sectionBody = z.object({ class_id: id, name: trimmed(30), capacity: z.coerce.number().int().min(1).max(200).default(40) });
  r.post('/sections', admin, (req, res) => {
    const b = sectionBody.parse(req.body);
    if (!db.prepare('SELECT 1 FROM classes WHERE id=?').get(b.class_id)) throw notFound('Class not found');
    const { lastInsertRowid } = db.prepare('INSERT INTO sections (class_id, name, capacity) VALUES (?,?,?)').run(b.class_id, b.name, b.capacity);
    audit(db, req.user, 'create', 'section', lastInsertRowid, b);
    res.status(201).json({ data: { id: Number(lastInsertRowid), ...b } });
  });
  r.patch('/sections/:id', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    const b = sectionBody.omit({ class_id: true }).parse(req.body);
    const used = db.prepare("SELECT COUNT(*) c FROM students WHERE section_id=? AND status='active'").get(sid).c;
    if (b.capacity < used) throw conflict(`Capacity cannot be below the ${used} active students enrolled`);
    if (!db.prepare('UPDATE sections SET name=?, capacity=? WHERE id=?').run(b.name, b.capacity, sid).changes) throw notFound('Section not found');
    audit(db, req.user, 'update', 'section', sid, b);
    res.json({ data: { id: sid, ...b } });
  });
  r.delete('/sections/:id', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    if (db.prepare('SELECT 1 FROM students WHERE section_id=?').get(sid)) throw conflict('This section still has students');
    if (!db.prepare('DELETE FROM sections WHERE id=?').run(sid).changes) throw notFound('Section not found');
    audit(db, req.user, 'delete', 'section', sid);
    res.json({ data: { ok: true } });
  });

  // SUBJECTS ----------------------------------------------------------------
  r.get('/subjects', (_req, res) => res.json({ data: db.prepare('SELECT * FROM subjects ORDER BY name').all() }));
  const subjectBody = z.object({ code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'), name: trimmed(80) });
  r.post('/subjects', admin, (req, res) => {
    const b = subjectBody.parse(req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO subjects (code, name) VALUES (?,?)').run(b.code.toUpperCase(), b.name);
    audit(db, req.user, 'create', 'subject', lastInsertRowid, b);
    res.status(201).json({ data: { id: Number(lastInsertRowid), code: b.code.toUpperCase(), name: b.name } });
  });
  r.patch('/subjects/:id', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    const b = subjectBody.parse(req.body);
    if (!db.prepare('UPDATE subjects SET code=?, name=? WHERE id=?').run(b.code.toUpperCase(), b.name, sid).changes) throw notFound('Subject not found');
    audit(db, req.user, 'update', 'subject', sid, b);
    res.json({ data: { id: sid, code: b.code.toUpperCase(), name: b.name } });
  });
  r.delete('/subjects/:id', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    if (db.prepare('SELECT 1 FROM exam_subjects WHERE subject_id=?').get(sid)) throw conflict('This subject is used by an exam');
    if (!db.prepare('DELETE FROM subjects WHERE id=?').run(sid).changes) throw notFound('Subject not found');
    audit(db, req.user, 'delete', 'subject', sid);
    res.json({ data: { ok: true } });
  });

  // TEACHER ASSIGNMENTS -----------------------------------------------------
  const assignmentSql = `SELECT ta.id, ta.teacher_id, ta.section_id, ta.subject_id, u.name AS teacher_name,
      c.name || ' - ' || s.name AS section_label, c.id AS class_id, sub.name AS subject_name, sub.code AS subject_code
      FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id JOIN users u ON u.id = t.user_id
      JOIN sections s ON s.id = ta.section_id JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = ta.subject_id`;

  r.get('/assignments', requireRole('admin', 'teacher'), (req, res) => {
    const where = [];
    const params = [];
    if (req.user.role === 'teacher') { where.push('t.user_id = ?'); params.push(req.user.id); }
    if (req.query.teacher_id && req.user.role === 'admin') { where.push('ta.teacher_id = ?'); params.push(Number(req.query.teacher_id)); }
    if (req.query.section_id) { where.push('ta.section_id = ?'); params.push(Number(req.query.section_id)); }
    const sql = `${assignmentSql} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.name, s.name, sub.name`;
    res.json({ data: db.prepare(sql).all(...params) });
  });
  r.post('/assignments', admin, (req, res) => {
    const b = z.object({ teacher_id: id, section_id: id, subject_id: id }).parse(req.body);
    if (!db.prepare('SELECT 1 FROM teachers WHERE id=?').get(b.teacher_id)) throw notFound('Teacher not found');
    if (!db.prepare('SELECT 1 FROM sections WHERE id=?').get(b.section_id)) throw notFound('Section not found');
    if (!db.prepare('SELECT 1 FROM subjects WHERE id=?').get(b.subject_id)) throw notFound('Subject not found');
    const { lastInsertRowid } = db.prepare('INSERT INTO teacher_assignments (teacher_id, section_id, subject_id) VALUES (?,?,?)').run(b.teacher_id, b.section_id, b.subject_id);
    audit(db, req.user, 'assign_teacher', 'assignment', lastInsertRowid, b);
    res.status(201).json({ data: db.prepare(`${assignmentSql} WHERE ta.id = ?`).get(lastInsertRowid) });
  });
  r.delete('/assignments/:id', admin, (req, res) => {
    const aid = id.parse(req.params.id);
    const row = db.prepare('SELECT * FROM teacher_assignments WHERE id=?').get(aid);
    if (!row) throw notFound('Assignment not found');
    db.prepare('DELETE FROM teacher_assignments WHERE id=?').run(aid);
    audit(db, req.user, 'unassign_teacher', 'assignment', aid, row);
    res.json({ data: { ok: true } });
  });

  return r;
}

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { assertStudentAccess, guardianStudents, requireRole, teacherSections } from '../lib/access.js';
import { tx } from '../lib/db.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { audit, dateStr, id, like, pageMeta, paging, todayStr, trimmed } from '../lib/util.js';

const admin = requireRole('admin');
const password = z.string().min(8, 'At least 8 characters').max(100).regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number');
const phone = z.string().trim().max(30).optional().nullable().transform((v) => v || null);

export function peopleRouter({ db }) {
  const r = Router();

  // TEACHERS & GUARDIANS (same shape; separate profile tables) ------------------
  for (const kind of ['teacher', 'guardian']) {
    const table = `${kind}s`;
    const extra = kind === 'teacher' ? 'employee_no' : 'address';
    const base = {
      name: trimmed(100), email: z.string().trim().toLowerCase().email().max(120), phone,
      [extra]: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
    };
    const select = `SELECT p.id, p.user_id, u.name, u.email, u.active, p.phone, p.${extra} AS ${extra}
      ${kind === 'guardian' ? ', (SELECT COUNT(*) FROM student_guardians sg WHERE sg.guardian_id = p.id) AS children' : ', (SELECT COUNT(*) FROM teacher_assignments ta WHERE ta.teacher_id = p.id) AS assignments'}
      FROM ${table} p JOIN users u ON u.id = p.user_id`;

    r.get(`/${table}`, requireRole('admin', ...(kind === 'guardian' ? ['teacher'] : [])), (req, res) => {
      if (req.user.role === 'teacher') {
        // teachers may only look up guardians of students in their own sections
        const secs = teacherSections(db, req.user);
        if (!secs.length) return res.json({ data: [], meta: pageMeta({ page: 1, pageSize: 20 }, 0) });
        const rows = db.prepare(`${select} WHERE p.id IN (SELECT sg.guardian_id FROM student_guardians sg JOIN students s ON s.id = sg.student_id
          WHERE s.section_id IN (${secs.map(() => '?').join(',')})) ORDER BY u.name`).all(...secs);
        return res.json({ data: rows.map(({ address, ...x }) => x), meta: pageMeta({ page: 1, pageSize: rows.length || 1 }, rows.length) });
      }
      const pg = paging(req.query);
      const where = [];
      const params = [];
      if (req.query.q) { where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')"); params.push(like(req.query.q), like(req.query.q)); }
      if (req.query.active === '1' || req.query.active === '0') { where.push('u.active = ?'); params.push(Number(req.query.active)); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT COUNT(*) c FROM ${table} p JOIN users u ON u.id = p.user_id ${w}`).get(...params).c;
      const rows = db.prepare(`${select} ${w} ORDER BY u.name LIMIT ? OFFSET ?`).all(...params, pg.pageSize, pg.offset);
      res.json({ data: rows, meta: pageMeta(pg, total) });
    });

    r.post(`/${table}`, admin, async (req, res) => {
      const b = z.object({ ...base, password }).parse(req.body);
      const hash = await bcrypt.hash(b.password, 10);
      const newId = tx(db, () => {
        const u = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)').run(b.email, hash, b.name, kind);
        const p = db.prepare(`INSERT INTO ${table} (user_id, phone, ${extra}) VALUES (?,?,?)`).run(u.lastInsertRowid, b.phone, b[extra]);
        audit(db, req.user, 'create', kind, p.lastInsertRowid, { name: b.name, email: b.email });
        return Number(p.lastInsertRowid);
      });
      res.status(201).json({ data: db.prepare(`${select} WHERE p.id = ?`).get(newId) });
    });

    r.patch(`/${table}/:id`, admin, (req, res) => {
      const pid = id.parse(req.params.id);
      const b = z.object({ ...base, active: z.boolean() }).partial().parse(req.body);
      const cur = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(pid);
      if (!cur) throw notFound(`${kind} not found`);
      tx(db, () => {
        if (b.name !== undefined || b.email !== undefined || b.active !== undefined) {
          const u = db.prepare('SELECT * FROM users WHERE id = ?').get(cur.user_id);
          db.prepare('UPDATE users SET name=?, email=?, active=?, token_version = token_version + ? WHERE id=?')
            .run(b.name ?? u.name, b.email ?? u.email, b.active === undefined ? u.active : (b.active ? 1 : 0), b.active === false ? 1 : 0, u.id);
        }
        db.prepare(`UPDATE ${table} SET phone=?, ${extra}=? WHERE id=?`)
          .run(b.phone === undefined ? cur.phone : b.phone, b[extra] === undefined ? cur[extra] : b[extra], pid);
        audit(db, req.user, 'update', kind, pid, b);
      });
      res.json({ data: db.prepare(`${select} WHERE p.id = ?`).get(pid) });
    });

    r.post(`/${table}/:id/reset-password`, admin, async (req, res) => {
      const pid = id.parse(req.params.id);
      const b = z.object({ password }).parse(req.body);
      const cur = db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).get(pid);
      if (!cur) throw notFound(`${kind} not found`);
      db.prepare('UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?').run(await bcrypt.hash(b.password, 10), cur.user_id);
      audit(db, req.user, 'reset_password', kind, pid);
      res.json({ data: { ok: true } });
    });
  }

  // STUDENTS ----------------------------------------------------------------
  const studentSelect = `SELECT s.id, s.admission_no, s.first_name, s.last_name, s.dob, s.gender, s.status, s.section_id,
      sec.name AS section_name, c.id AS class_id, c.name AS class_name, c.academic_year
      FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id`;

  r.get('/students', (req, res) => {
    const pg = paging(req.query);
    const where = [];
    const params = [];
    if (req.user.role === 'teacher') {
      const secs = teacherSections(db, req.user);
      if (!secs.length) return res.json({ data: [], meta: pageMeta(pg, 0) });
      where.push(`s.section_id IN (${secs.map(() => '?').join(',')})`); params.push(...secs);
    } else if (req.user.role === 'guardian') {
      const ids = guardianStudents(db, req.user);
      if (!ids.length) return res.json({ data: [], meta: pageMeta(pg, 0) });
      where.push(`s.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids);
    }
    if (req.query.q) {
      where.push("(s.first_name LIKE ? ESCAPE '\\' OR s.last_name LIKE ? ESCAPE '\\' OR s.admission_no LIKE ? ESCAPE '\\' OR (s.first_name || ' ' || s.last_name) LIKE ? ESCAPE '\\')");
      const p = like(req.query.q); params.push(p, p, p, p);
    }
    if (req.query.section_id) { where.push('s.section_id = ?'); params.push(Number(req.query.section_id)); }
    if (req.query.class_id) { where.push('sec.class_id = ?'); params.push(Number(req.query.class_id)); }
    if (['active', 'inactive', 'graduated'].includes(req.query.status)) { where.push('s.status = ?'); params.push(req.query.status); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap = { name: 's.last_name, s.first_name', admission_no: 's.admission_no', class: 'c.name, sec.name, s.last_name' };
    const order = sortMap[req.query.sort] ?? sortMap.name;
    const total = db.prepare(`SELECT COUNT(*) c FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id ${w}`).get(...params).c;
    const rows = db.prepare(`${studentSelect} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, pg.pageSize, pg.offset);
    res.json({ data: rows, meta: pageMeta(pg, total) });
  });

  const guardiansOf = (studentId, viewer) => {
    const rows = db.prepare(`SELECT g.id, u.name, u.email, g.phone, sg.relation, u.id AS user_id FROM student_guardians sg
      JOIN guardians g ON g.id = sg.guardian_id JOIN users u ON u.id = g.user_id WHERE sg.student_id = ? ORDER BY u.name`).all(studentId);
    // a guardian only sees their own record, never co-guardians' contact details
    return rows.filter((g) => viewer.role !== 'guardian' || g.user_id === viewer.id).map(({ user_id, ...g }) => g);
  };

  r.get('/students/:id', (req, res) => {
    const s = assertStudentAccess(db, req.user, id.parse(req.params.id));
    res.json({ data: { ...db.prepare(`${studentSelect} WHERE s.id = ?`).get(s.id), guardians: guardiansOf(s.id, req.user) } });
  });

  const studentBody = z.object({
    admission_no: z.string().trim().min(1).max(30), first_name: trimmed(60), last_name: trimmed(60),
    dob: dateStr.refine((d) => d < todayStr(), 'Date of birth must be in the past'),
    gender: z.enum(['female', 'male', 'other']), section_id: id,
    status: z.enum(['active', 'inactive', 'graduated']).default('active'),
    guardians: z.array(z.object({ guardian_id: id, relation: z.string().trim().min(1).max(30).default('parent') })).max(4).optional(),
  });

  const assertCapacity = (sectionId, excludeStudentId = null) => {
    const sec = db.prepare('SELECT capacity FROM sections WHERE id=?').get(sectionId);
    if (!sec) throw notFound('Section not found');
    const used = db.prepare("SELECT COUNT(*) c FROM students WHERE section_id=? AND status='active' AND id IS NOT ?").get(sectionId, excludeStudentId).c;
    if (used >= sec.capacity) throw conflict(`This section is full (${sec.capacity} students)`, undefined, 'SECTION_FULL');
  };

  r.post('/students', admin, (req, res) => {
    const b = studentBody.parse(req.body);
    const newId = tx(db, () => {
      if (b.status === 'active') assertCapacity(b.section_id);
      const s = db.prepare('INSERT INTO students (admission_no, first_name, last_name, dob, gender, section_id, status) VALUES (?,?,?,?,?,?,?)')
        .run(b.admission_no, b.first_name, b.last_name, b.dob, b.gender, b.section_id, b.status);
      for (const g of b.guardians ?? []) {
        if (!db.prepare('SELECT 1 FROM guardians WHERE id=?').get(g.guardian_id)) throw notFound('Guardian not found');
        db.prepare('INSERT INTO student_guardians (student_id, guardian_id, relation) VALUES (?,?,?)').run(s.lastInsertRowid, g.guardian_id, g.relation);
      }
      audit(db, req.user, 'create', 'student', s.lastInsertRowid, { admission_no: b.admission_no, section_id: b.section_id });
      return Number(s.lastInsertRowid);
    });
    res.status(201).json({ data: { ...db.prepare(`${studentSelect} WHERE s.id = ?`).get(newId), guardians: guardiansOf(newId, req.user) } });
  });

  r.patch('/students/:id', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    const b = studentBody.omit({ guardians: true }).partial().parse(req.body);
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM students WHERE id=?').get(sid);
      if (!cur) throw notFound('Student not found');
      const next = { ...cur, ...b };
      if (next.status === 'active' && (next.section_id !== cur.section_id || cur.status !== 'active')) assertCapacity(next.section_id, sid);
      db.prepare('UPDATE students SET admission_no=?, first_name=?, last_name=?, dob=?, gender=?, section_id=?, status=? WHERE id=?')
        .run(next.admission_no, next.first_name, next.last_name, next.dob, next.gender, next.section_id, next.status, sid);
      audit(db, req.user, 'update', 'student', sid, b);
    });
    res.json({ data: { ...db.prepare(`${studentSelect} WHERE s.id = ?`).get(sid), guardians: guardiansOf(sid, req.user) } });
  });

  r.post('/students/:id/guardians', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    const b = z.object({ guardian_id: id, relation: z.string().trim().min(1).max(30).default('parent') }).parse(req.body);
    if (!db.prepare('SELECT 1 FROM students WHERE id=?').get(sid)) throw notFound('Student not found');
    if (!db.prepare('SELECT 1 FROM guardians WHERE id=?').get(b.guardian_id)) throw notFound('Guardian not found');
    db.prepare('INSERT INTO student_guardians (student_id, guardian_id, relation) VALUES (?,?,?)').run(sid, b.guardian_id, b.relation);
    audit(db, req.user, 'link_guardian', 'student', sid, b);
    res.status(201).json({ data: guardiansOf(sid, req.user) });
  });

  r.delete('/students/:id/guardians/:gid', admin, (req, res) => {
    const sid = id.parse(req.params.id);
    const gid = id.parse(req.params.gid);
    if (!db.prepare('DELETE FROM student_guardians WHERE student_id=? AND guardian_id=?').run(sid, gid).changes) throw notFound('Link not found');
    audit(db, req.user, 'unlink_guardian', 'student', sid, { guardian_id: gid });
    res.json({ data: guardiansOf(sid, req.user) });
  });

  // Bulk promote active students of a section to another section (e.g. year rollover)
  r.post('/students/bulk-move', admin, (req, res) => {
    const b = z.object({ from_section_id: id, to_section_id: id }).refine((v) => v.from_section_id !== v.to_section_id, 'Choose a different target section').parse(req.body);
    const moved = tx(db, () => {
      const ids = db.prepare("SELECT id FROM students WHERE section_id=? AND status='active'").all(b.from_section_id).map((x) => x.id);
      const sec = db.prepare('SELECT capacity FROM sections WHERE id=?').get(b.to_section_id);
      if (!sec) throw notFound('Target section not found');
      const used = db.prepare("SELECT COUNT(*) c FROM students WHERE section_id=? AND status='active'").get(b.to_section_id).c;
      if (used + ids.length > sec.capacity) throw unprocessable(`Target section only has room for ${sec.capacity - used} more students`, undefined, 'SECTION_FULL');
      db.prepare("UPDATE students SET section_id=? WHERE section_id=? AND status='active'").run(b.to_section_id, b.from_section_id);
      audit(db, req.user, 'bulk_move', 'student', null, { ...b, count: ids.length });
      return ids.length;
    });
    res.json({ data: { moved } });
  });

  return r;
}

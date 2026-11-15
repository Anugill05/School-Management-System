// Server-side authorization helpers (RBAC + row-level scoping). UI hiding is never relied upon.
import { forbidden, notFound } from './errors.js';

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(forbidden());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export function teacherId(db, user) {
  return db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id)?.id ?? null;
}
export function guardianId(db, user) {
  return db.prepare('SELECT id FROM guardians WHERE user_id = ?').get(user.id)?.id ?? null;
}

/** Section ids a teacher is assigned to (any subject). */
export function teacherSections(db, user) {
  return db.prepare(`SELECT DISTINCT ta.section_id AS id FROM teacher_assignments ta
                     JOIN teachers t ON t.id = ta.teacher_id WHERE t.user_id = ?`).all(user.id).map((r) => r.id);
}
export function guardianStudents(db, user) {
  return db.prepare(`SELECT sg.student_id AS id FROM student_guardians sg
                     JOIN guardians g ON g.id = sg.guardian_id WHERE g.user_id = ?`).all(user.id).map((r) => r.id);
}

export function canAccessSection(db, user, sectionId) {
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return teacherSections(db, user).includes(Number(sectionId));
  return false;
}
export function assertSection(db, user, sectionId) {
  const exists = db.prepare('SELECT 1 FROM sections WHERE id = ?').get(sectionId);
  if (!exists) throw notFound('Section not found');
  if (!canAccessSection(db, user, sectionId)) throw forbidden('You are not assigned to this class section');
}

export function teachesSubject(db, user, sectionId, subjectId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;
  return !!db.prepare(`SELECT 1 FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
                       WHERE t.user_id = ? AND ta.section_id = ? AND ta.subject_id = ?`).get(user.id, sectionId, subjectId);
}

/** Returns the student row if the user may view it; otherwise 404 (do not leak existence) or 403. */
export function assertStudentAccess(db, user, studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) throw notFound('Student not found');
  if (user.role === 'admin') return student;
  if (user.role === 'teacher' && teacherSections(db, user).includes(student.section_id)) return student;
  if (user.role === 'guardian' && guardianStudents(db, user).includes(student.id)) return student;
  throw notFound('Student not found'); // identical response for "missing" and "not yours"
}

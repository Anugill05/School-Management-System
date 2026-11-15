import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, d) => new ApiError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') => new ApiError(401, 'UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Resource not found') => new ApiError(404, 'NOT_FOUND', m);
export const conflict = (m, d, code = 'CONFLICT') => new ApiError(409, code, m, d);
export const unprocessable = (m, d, code = 'UNPROCESSABLE') => new ApiError(422, code, m, d);

const FRIENDLY = {
  'students.admission_no': 'A student with this admission number already exists',
  'users.email': 'This email address is already in use',
  'subjects.code': 'A subject with this code already exists',
  'classes.name, classes.academic_year': 'This class already exists for the academic year',
  'sections.class_id, sections.name': 'This section already exists in the class',
  'teacher_assignments.section_id, teacher_assignments.subject_id': 'That subject already has a teacher in this section',
  'teachers.employee_no': 'This employee number is already in use',
  'exams.class_id, exams.name, exams.term': 'An exam with this name and term already exists for the class',
  'grading_rules.name': 'A grading rule with this name already exists',
  'student_guardians.student_id, student_guardians.guardian_id': 'This guardian is already linked to the student',
};

/** Translate low-level SQLite errors into predictable API errors. */
export function normalizeError(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    const fields = {};
    for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
    return new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { fields });
  }
  const msg = String(err?.message ?? '');
  if (err?.code === 'ERR_SQLITE_ERROR' || /constraint failed|append-only|exceed maximum/i.test(msg)) {
    let m;
    if ((m = msg.match(/UNIQUE constraint failed: (.+)$/))) {
      return new ApiError(409, 'CONFLICT', FRIENDLY[m[1]] ?? `Duplicate value (${m[1]})`);
    }
    if (/FOREIGN KEY constraint failed/.test(msg)) {
      return new ApiError(409, 'CONFLICT', 'This record is referenced by other records or references something that does not exist');
    }
    if (/CHECK constraint failed|exceed maximum/.test(msg)) {
      return new ApiError(400, 'VALIDATION_ERROR', /exceed/.test(msg) ? 'Marks exceed the maximum for this subject' : 'A value violates a data rule');
    }
    if (/append-only/.test(msg)) return new ApiError(409, 'IMMUTABLE', 'This record cannot be modified');
  }
  if (err?.type === 'entity.parse.failed') return new ApiError(400, 'BAD_JSON', 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large') return new ApiError(413, 'TOO_LARGE', 'Request body too large');
  return null;
}

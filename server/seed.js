// Deterministic SYNTHETIC demo data. No real people, no real contact details.
import bcrypt from 'bcryptjs';
import { tx } from './lib/db.js';

export const DEMO_PASSWORD = 'Demo@12345';

const FIRST = ['Aarav', 'Diya', 'Vivaan', 'Anaya', 'Reyansh', 'Myra', 'Arjun', 'Sara', 'Kabir', 'Ira', 'Ishaan', 'Zoya', 'Dev', 'Kiara', 'Rohan', 'Meera', 'Aditya', 'Navya', 'Krish', 'Tara'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Nair', 'Reddy', 'Khan', 'Mehta', 'Iyer', 'Bose', 'Kapoor', 'Singh', 'Das', 'Patel', 'Joshi', 'Menon', 'Rao', 'Chopra', 'Malik', 'Sinha', 'Banerjee'];
const PARENTS = ['Sunita', 'Rajesh', 'Kavita', 'Manoj', 'Lakshmi', 'Anil', 'Deepa', 'Vikram', 'Neha', 'Suresh', 'Pooja', 'Amit', 'Rekha', 'Naveen', 'Shilpa'];
const SUBJECTS =[['MATH', 'Mathematics'], ['ENG', 'English'], ['SCI', 'Science'], ['SST', 'Social Studies'], ['HIN', 'Hindi'], ['CS', 'Computer Science']];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

export function seed(db) {
  const rand = rng(20251114);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const counts = {};

  tx(db, () => {
    const user = (email, name, role) => Number(db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)').run(email, hash, name, role).lastInsertRowid);

    user('admin@school.test', 'Priya Administrator', 'admin');

    // teachers
    const teacherNames = ['Meera Krishnan', 'Rahul Deshmukh', 'Anita Fernandes', 'Sanjay Pillai'];
    const teachers = teacherNames.map((n, i) => {
      const uid = user(`teacher${i + 1}@school.test`, n, 'teacher');
      return Number(db.prepare('INSERT INTO teachers (user_id, employee_no, phone) VALUES (?,?,?)').run(uid, `EMP-${100 + i}`, `+91-90000-0010${i}`).lastInsertRowid);
    });
    counts.teachers = teachers.length;

    // classes, sections, subjects
    const sections = [];
    for (const g of [6, 7, 8]) {
      const cid = Number(db.prepare('INSERT INTO classes (name, academic_year) VALUES (?,?)').run(`Grade ${g}`, '2025-2026').lastInsertRowid);
      for (const s of ['A', 'B']) {
        const sid = Number(db.prepare('INSERT INTO sections (class_id, name, capacity) VALUES (?,?,?)').run(cid, s, 40).lastInsertRowid);
        sections.push({ id: sid, class_id: cid, grade: g, name: s });
      }
    }
    const subjects = SUBJECTS.map(([code, name]) => ({ code, name, id: Number(db.prepare('INSERT INTO subjects (code, name) VALUES (?,?)').run(code, name).lastInsertRowid) }));
    const sub = (code) => subjects.find((s) => s.code === code).id;

    // assignments: T1 -> Grade 6 Math+Science, T2 -> Grade 6 others, T3 -> Grade 7, T4 -> Grade 8
    const assignment = db.prepare('INSERT INTO teacher_assignments (teacher_id, section_id, subject_id) VALUES (?,?,?)');
    const sectionTeacher = new Map();
    for (const s of sections) {
      for (const sj of subjects) {
        const t = s.grade === 6 ? (['MATH', 'SCI'].includes(sj.code) ? teachers[0] : teachers[1]) : s.grade === 7 ? teachers[2] : teachers[3];
        assignment.run(t, s.id, sj.id);
        if (!sectionTeacher.has(s.id)) sectionTeacher.set(s.id, t);
      }
    }
    const teacherUser = (tid) => db.prepare('SELECT user_id FROM teachers WHERE id=?').get(tid).user_id;

    // students (10 per section) and guardians (40; 20 guardians have two children)
    const students = [];
    sections.forEach((sec, si) => {
      for (let k = 0; k < 10; k++) {
        const n = si * 10 + k;
        const first = FIRST[(n * 7 + 3) % FIRST.length];
        const last = n >= 40 ? students[n - 40].last : LAST[(n * 3 + 1) % LAST.length];
        const sid = Number(db.prepare('INSERT INTO students (admission_no, first_name, last_name, dob, gender, section_id) VALUES (?,?,?,?,?,?)')
          .run(`ADM2025-${String(n + 1).padStart(3, '0')}`, first, last, `${2025 - 5 - sec.grade}-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 27) + 1).padStart(2, '0')}`, n % 2 ? 'male' : 'female', sec.id).lastInsertRowid);
        students.push({ id: sid, section: sec, first, last, ability: 45 + rand() * 50 });
      }
    });
    counts.students = students.length;
    const guardianIds = [];
    for (let g = 0; g < 40; g++) {
      const uid = user(`guardian${g + 1}@school.test`, `${PARENTS[(g * 5 + 2) % PARENTS.length]} ${students[g].last}`, 'guardian');
      guardianIds.push(Number(db.prepare('INSERT INTO guardians (user_id, phone, address) VALUES (?,?,?)').run(uid, `+91-98000-${String(10000 + g)}`, `${g + 1} Sample Street, Demo City`).lastInsertRowid));
    }
    counts.guardians = guardianIds.length;
    students.forEach((s, n) => db.prepare('INSERT INTO student_guardians (student_id, guardian_id, relation) VALUES (?,?,?)').run(s.id, guardianIds[n % 40], n % 3 === 0 ? 'mother' : n % 3 === 1 ? 'father' : 'guardian'));

    // attendance for last 20 weekdays (today left unmarked on purpose)
    const att = db.prepare('INSERT INTO attendance (student_id, section_id, date, session, status, marked_by) VALUES (?,?,?,?,?,?)');
    let days = 0;
    for (let back = 1; days < 20; back++) {
      const d = addDays(today, -back);
      if ([0, 6].includes(d.getUTCDay())) continue;
      days++;
      for (const s of students) {
        const by = teacherUser(sectionTeacher.get(s.section.id));
        for (const session of days <= 10 ? ['morning', 'afternoon'] : ['morning']) {
          const x = rand();
          const status = x < (s.ability < 55 ? 0.8 : 0.9) ? 'present' : x < 0.94 ? 'late' : x < 0.985 ? 'absent' : 'excused';
          att.run(s.id, s.section.id, iso(d), session, status, by);
        }
      }
    }

    // grading rule
    const rule = Number(db.prepare('INSERT INTO grading_rules (name, pass_percent, is_default) VALUES (?,?,1)').run('Standard (A+ to F)', 40).lastInsertRowid);
    [[90, 'A+', 'Outstanding', 4], [80, 'A', 'Excellent', 4], [70, 'B', 'Very Good', 3], [60, 'C', 'Good', 2], [50, 'D', 'Satisfactory', 1], [0, 'F', 'Needs Improvement', 0]]
      .forEach(([m, g, r, p]) => db.prepare('INSERT INTO grade_bands (rule_id, min_percent, grade, remark, gpa) VALUES (?,?,?,?,?)').run(rule, m, g, r, p));
    const strict = Number(db.prepare('INSERT INTO grading_rules (name, pass_percent, is_default) VALUES (?,?,0)').run('Strict (pass 50%)', 50).lastInsertRowid);
    [[85, 'A', 'Excellent', 4], [70, 'B', 'Good', 3], [50, 'C', 'Pass', 2], [0, 'F', 'Fail', 0]]
      .forEach(([m, g, r, p]) => db.prepare('INSERT INTO grade_bands (rule_id, min_percent, grade, remark, gpa) VALUES (?,?,?,?,?)').run(strict, m, g, r, p));

    // exams
    const classes = [...new Set(sections.map((s) => s.class_id))];
    const exam = (name, term, classId, status, subjectCodes, max, pass, startOffset) => {
      const eid = Number(db.prepare('INSERT INTO exams (name, term, class_id, grading_rule_id, status, start_date) VALUES (?,?,?,?,?,?)').run(name, term, classId, rule, status, iso(addDays(today, startOffset))).lastInsertRowid);
      subjectCodes.forEach((c) => db.prepare('INSERT INTO exam_subjects (exam_id, subject_id, max_marks, pass_marks) VALUES (?,?,?,?)').run(eid, sub(c), max, pass));
      return eid;
    };
    const enter = (eid, codes, max, filter) => {
      const clsId = db.prepare('SELECT class_id FROM exams WHERE id=?').get(eid).class_id;
      for (const s of students.filter((x) => x.section.class_id === clsId && (!filter || filter(x)))) {
        for (const c of codes) {
          const absent = rand() < 0.01;
          const m = Math.max(3, Math.min(max, Math.round(((s.ability + (rand() - 0.5) * 30) / 100) * max)));
          const sec = s.section.id;
          const teacher = sectionTeacher.has(sec) ? teacherUser(db.prepare('SELECT teacher_id FROM teacher_assignments WHERE section_id=? AND subject_id=?').get(sec, sub(c)).teacher_id) : null;
          db.prepare('INSERT INTO marks (exam_id, subject_id, student_id, marks_obtained, is_absent, entered_by) VALUES (?,?,?,?,?,?)').run(eid, sub(c), s.id, absent ? null : m, absent ? 1 : 0, teacher);
        }
      }
    };
    const allCodes = SUBJECTS.map((s) => s[0]);
    const e6 = exam('Mid-Term Examination', 'Term 1', classes[0], 'open', allCodes, 100, 35, -60);
    const e7 = exam('Mid-Term Examination', 'Term 1', classes[1], 'open', allCodes, 100, 35, -60);
    enter(e6, allCodes, 100); enter(e7, allCodes, 100);
    db.prepare("UPDATE exams SET status='published' WHERE id IN (?,?)").run(e6, e7);
    const e8 = exam('Mid-Term Examination', 'Term 1', classes[2], 'open', allCodes, 100, 35, -60);
    enter(e8, ['MATH', 'ENG', 'SCI'], 100); // partially entered => cannot publish without force
    const ut = exam('Unit Test 2', 'Term 2', classes[0], 'open', ['MATH', 'SCI', 'ENG'], 50, 20, 7);
    enter(ut, ['MATH'], 50, (s) => s.section.name === 'A');

    // fees
    const inv = db.prepare('INSERT INTO fee_invoices (number, student_id, title, due_date, amount_cents) VALUES (?,?,?,?,?)');
    const led = db.prepare('INSERT INTO fee_ledger (invoice_id, student_id, entry_type, amount_cents, method, reference, idempotency_key) VALUES (?,?,?,?,?,?,?)');
    let n = 0; let pay = 0;
    const issue = (s, title, due, cents, paidFraction) => {
      n++;
      const iid = Number(inv.run(`INV-2025-${String(n).padStart(5, '0')}`, s.id, title, iso(addDays(today, due)), cents).lastInsertRowid);
      led.run(iid, s.id, 'charge', cents, null, null, null);
      if (paidFraction > 0) {
        const amt = Math.round(cents * paidFraction);
        led.run(iid, s.id, 'payment', -amt, pick(['card', 'bank_transfer', 'upi', 'cash']), `SEED-${++pay}`, `seed-payment-${pay}-key`);
        db.prepare('UPDATE fee_invoices SET status=? WHERE id=?').run(paidFraction >= 1 ? 'paid' : 'partial', iid);
      }
    };
    for (const s of students) {
      const x = rand();
      issue(s, 'Tuition Fee - Term 1', -45, 45000, x < 0.7 ? 1 : x < 0.85 ? 0.5 : 0);
      issue(s, 'Tuition Fee - Term 2', 30, 45000, rand() < 0.2 ? 1 : 0);
      if (rand() < 0.4) issue(s, 'Transport Fee - Term 2', 30, 6000, rand() < 0.5 ? 1 : 0);
    }
    counts.invoices = n;

    db.prepare("INSERT INTO audit_log (actor_name, action, entity, details) VALUES ('system','seed','database',?)").run(JSON.stringify(counts));
  });
  return counts;
}

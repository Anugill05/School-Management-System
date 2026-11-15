-- School Management System: initial schema
-- Money is stored as integer cents. Timestamps are UTC ISO strings (datetime('now')).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  role          TEXT NOT NULL CHECK (role IN ('admin','teacher','guardian')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE teachers (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_no TEXT UNIQUE,
  phone       TEXT
);

CREATE TABLE guardians (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone   TEXT,
  address TEXT
);

CREATE TABLE classes (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  academic_year TEXT NOT NULL,
  UNIQUE (name, academic_year)
);

CREATE TABLE sections (
  id       INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  name     TEXT NOT NULL CHECK (length(trim(name)) > 0),
  capacity INTEGER NOT NULL DEFAULT 40 CHECK (capacity > 0),
  UNIQUE (class_id, name)
);

CREATE TABLE subjects (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0)
);

CREATE TABLE students (
  id           INTEGER PRIMARY KEY,
  admission_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  dob          TEXT NOT NULL,
  gender       TEXT NOT NULL CHECK (gender IN ('female','male','other')),
  section_id   INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','graduated')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_students_section ON students(section_id, status);
CREATE INDEX idx_students_name ON students(last_name, first_name);

CREATE TABLE student_guardians (
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL DEFAULT 'parent',
  PRIMARY KEY (student_id, guardian_id)
);
CREATE INDEX idx_sg_guardian ON student_guardians(guardian_id);

-- One teacher per (section, subject).
CREATE TABLE teacher_assignments (
  id         INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE (section_id, subject_id)
);
CREATE INDEX idx_ta_teacher ON teacher_assignments(teacher_id);

-- ATTENDANCE ---------------------------------------------------------------
CREATE TABLE attendance (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  date       TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  session    TEXT NOT NULL CHECK (session IN ('morning','afternoon')),
  status     TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note       TEXT,
  marked_by  INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, date, session)
);
CREATE INDEX idx_att_section_date ON attendance(section_id, date);
CREATE INDEX idx_att_student ON attendance(student_id, date);

-- EXAMS --------------------------------------------------------------------
CREATE TABLE grading_rules (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  pass_percent REAL NOT NULL DEFAULT 40 CHECK (pass_percent BETWEEN 0 AND 100),
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1))
);
CREATE TABLE grade_bands (
  id          INTEGER PRIMARY KEY,
  rule_id     INTEGER NOT NULL REFERENCES grading_rules(id) ON DELETE CASCADE,
  min_percent REAL NOT NULL CHECK (min_percent BETWEEN 0 AND 100),
  grade       TEXT NOT NULL,
  remark      TEXT,
  gpa         REAL NOT NULL DEFAULT 0,
  UNIQUE (rule_id, min_percent),
  UNIQUE (rule_id, grade)
);

CREATE TABLE exams (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  term            TEXT NOT NULL DEFAULT 'Term 1',
  class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  grading_rule_id INTEGER NOT NULL REFERENCES grading_rules(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','published')),
  start_date      TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (class_id, name, term)
);
CREATE TABLE exam_subjects (
  exam_id    INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  max_marks  REAL NOT NULL CHECK (max_marks > 0),
  pass_marks REAL NOT NULL CHECK (pass_marks >= 0),
  PRIMARY KEY (exam_id, subject_id),
  CHECK (pass_marks <= max_marks)
);
CREATE TABLE marks (
  id             INTEGER PRIMARY KEY,
  exam_id        INTEGER NOT NULL,
  subject_id     INTEGER NOT NULL,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks_obtained REAL CHECK (marks_obtained IS NULL OR marks_obtained >= 0),
  is_absent      INTEGER NOT NULL DEFAULT 0 CHECK (is_absent IN (0,1)),
  entered_by     INTEGER REFERENCES users(id),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exam_id, subject_id, student_id),
  FOREIGN KEY (exam_id, subject_id) REFERENCES exam_subjects(exam_id, subject_id) ON DELETE CASCADE,
  CHECK (is_absent = 0 OR marks_obtained IS NULL)
);
CREATE INDEX idx_marks_student ON marks(student_id, exam_id);

CREATE TRIGGER trg_marks_max_ins BEFORE INSERT ON marks
WHEN NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained >
     (SELECT max_marks FROM exam_subjects WHERE exam_id = NEW.exam_id AND subject_id = NEW.subject_id)
BEGIN SELECT RAISE(ABORT, 'marks exceed maximum for subject'); END;

CREATE TRIGGER trg_marks_max_upd BEFORE UPDATE ON marks
WHEN NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained >
     (SELECT max_marks FROM exam_subjects WHERE exam_id = NEW.exam_id AND subject_id = NEW.subject_id)
BEGIN SELECT RAISE(ABORT, 'marks exceed maximum for subject'); END;

-- FEES ---------------------------------------------------------------------
CREATE TABLE fee_invoices (
  id           INTEGER PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
  due_date     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status       TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partial','paid','void')),
  void_reason  TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inv_student ON fee_invoices(student_id, status);
CREATE INDEX idx_inv_due ON fee_invoices(due_date, status);

-- Append-only ledger. charge > 0; payment and void < 0. balance = SUM(amount_cents).
CREATE TABLE fee_ledger (
  id              INTEGER PRIMARY KEY,
  invoice_id      INTEGER NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('charge','payment','void')),
  amount_cents    INTEGER NOT NULL,
  method          TEXT CHECK (method IS NULL OR method IN ('card','bank_transfer','cash','upi')),
  reference       TEXT,
  idempotency_key TEXT UNIQUE,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((entry_type = 'charge' AND amount_cents > 0) OR (entry_type IN ('payment','void') AND amount_cents < 0))
);
CREATE INDEX idx_ledger_invoice ON fee_ledger(invoice_id);
CREATE INDEX idx_ledger_student ON fee_ledger(student_id);

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON fee_ledger
BEGIN SELECT RAISE(ABORT, 'fee_ledger is append-only'); END;
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON fee_ledger
BEGIN SELECT RAISE(ABORT, 'fee_ledger is append-only'); END;

-- AUDIT --------------------------------------------------------------------
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  actor_id   INTEGER,
  actor_name TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

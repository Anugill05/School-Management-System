# Database schema (ER diagram)

SQLite, created by `server/migrations/001_init.sql`. Money is stored as integer cents. View this file in any Markdown viewer that renders Mermaid (GitHub, VS Code with the Mermaid extension).

```mermaid
erDiagram
  users ||--o| teachers : "profile"
  users ||--o| guardians : "profile"
  classes ||--|{ sections : has
  sections ||--o{ students : enrols
  guardians }o--o{ students : "student_guardians"
  teachers ||--o{ teacher_assignments : teaches
  sections ||--o{ teacher_assignments : "taught in"
  subjects ||--o{ teacher_assignments : "taught as"
  students ||--o{ attendance : "UNIQUE(student,date,session)"
  sections ||--o{ attendance : records
  grading_rules ||--|{ grade_bands : defines
  classes ||--o{ exams : sits
  grading_rules ||--o{ exams : "graded by"
  exams ||--|{ exam_subjects : "max/pass marks"
  subjects ||--o{ exam_subjects : in
  exam_subjects ||--o{ marks : "UNIQUE(exam,subject,student)"
  students ||--o{ marks : scores
  students ||--o{ fee_invoices : billed
  fee_invoices ||--|{ fee_ledger : "append-only entries"
  users ||--o{ audit_log : "actor"

  users { int id PK; text email UK; text role "admin|teacher|guardian"; int active; int token_version }
  teachers { int id PK; int user_id FK; text employee_no UK }
  guardians { int id PK; int user_id FK; text phone }
  classes { int id PK; text name; text academic_year "UNIQUE(name,year)" }
  sections { int id PK; int class_id FK; text name; int capacity }
  subjects { int id PK; text code UK; text name }
  students { int id PK; text admission_no UK; int section_id FK; text status }
  teacher_assignments { int id PK; int teacher_id FK; int section_id FK; int subject_id FK "UNIQUE(section,subject)" }
  attendance { int id PK; int student_id FK; text date; text session; text status; int marked_by FK }
  grading_rules { int id PK; text name UK; real pass_percent; int is_default }
  grade_bands { int id PK; int rule_id FK; real min_percent; text grade; real gpa }
  exams { int id PK; int class_id FK; int grading_rule_id FK; text status "draft|open|published" }
  exam_subjects { int exam_id PK; int subject_id PK; real max_marks; real pass_marks }
  marks { int id PK; int exam_id FK; int subject_id FK; int student_id FK; real marks_obtained; int is_absent }
  fee_invoices { int id PK; text number UK; int student_id FK; int amount_cents; text status "issued|partial|paid|void" }
  fee_ledger { int id PK; int invoice_id FK; text entry_type "charge|payment|void"; int amount_cents "signed"; text idempotency_key UK }
  audit_log { int id PK; int actor_id; text action; text entity; text details "JSON" }
```

## Integrity rules enforced by the database

| Rule | Mechanism |
|---|---|
| One attendance record per student / date / session | `UNIQUE (student_id, date, session)` + UPSERT in the API |
| Marks never exceed the subject maximum | `BEFORE INSERT/UPDATE` triggers on `marks`; absent students cannot carry marks (`CHECK`) |
| Only one teacher per subject per section | `UNIQUE (section_id, subject_id)` |
| Ledger is append-only and correctly signed | `BEFORE UPDATE/DELETE` triggers; `CHECK` (charge > 0, payment/void < 0) |
| A payment request is applied at most once | `UNIQUE (idempotency_key)` on `fee_ledger` |
| Audit trail cannot be rewritten | `BEFORE UPDATE` trigger on `audit_log` |
| Deleting referenced classes/sections/subjects is blocked | `ON DELETE RESTRICT` foreign keys (`PRAGMA foreign_keys=ON`) |
| Query performance | Indexes on `students(section_id,status)`, `attendance(section_id,date)`, `attendance(student_id,date)`, `fee_ledger(invoice_id)`, `fee_invoices(student_id,status)`, `audit_log(created_at)` and more |

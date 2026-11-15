# Greenfield School — School Management System

> Algions AI Labs Private Limited · Full-Stack Web Development assessment · Assigned project: **School Management System**

| | |
|---|---|
| **Candidate** | `<YOUR FULL NAME>` |
| **Registration no.** | `<YOUR REGISTRATION NUMBER>` |
| **Live demo** | https://school-management-system-backend-nixj.onrender.com |
| **API docs (Swagger UI)** | https://school-management-system-backend-nixj.onrender.com/api/docs |
| **Walkthrough video** | `<VIDEO LINK>` |
| **Repository / branch** | `<REPO URL>` · `main` |

A full-stack, database-backed school management application: academic administration, attendance, examinations and report cards, fee invoicing with a reconciling ledger, role-based access (admin / teacher / guardian), reports and an audit trail. **All data is synthetic.** Payments are **simulated only**; no real payment data or credentials are used anywhere.

---

## Table of contents

1. [Features](#1-features)
2. [Technology stack](#2-technology-stack)
3. [Architecture](#3-architecture)
4. [Database and ER diagram](#4-database-and-er-diagram)
5. [Local setup](#5-local-setup)
6. [Environment variables](#6-environment-variables)
7. [Database setup, migrations and seed data](#7-database-setup-migrations-and-seed-data)
8. [Demo credentials](#8-demo-credentials)
9. [Deployment (Render, free tier)](#9-deployment-render-free-tier)
10. [API documentation](#10-api-documentation)
11. [Acceptance tests from the brief](#11-acceptance-tests-from-the-brief)
12. [Business rules](#12-business-rules)
13. [Security and data integrity](#13-security-and-data-integrity)
14. [Testing](#14-testing)
15. [Project structure](#15-project-structure)
16. [Known limitations and assumptions](#16-known-limitations-and-assumptions)
17. [AI use and attribution](#17-ai-use-and-attribution)

---

## 1. Features

**Academic administration** — manage students, guardians, teachers, classes, sections, subjects and teacher ↔ section ↔ subject assignments. Section capacity is enforced, students can be bulk-moved between sections, and referenced records cannot be deleted.

**Attendance** — daily roster per section, date and session. Resubmitting safely updates (never duplicates) the record. Per-student and per-class summaries, with an attendance report that can flag students below a threshold.

**Examinations and results** — create exams with per-subject maximum and pass marks, configurable grading rules (grade bands plus overall pass %), enter marks, compute totals, grades, pass/fail and ranks, and generate a printable report card. Exams follow a `draft → open → published` lifecycle.

**Fee management** — single or bulk invoices (by student, section or class), simulated payments, and outstanding balances derived from an append-only ledger. Guardians can pay for their own children; admins see school-wide totals.

**Role-based access** — separate admin, teacher and guardian experiences. Authorization is enforced on the **server** (route-level roles plus row-level scoping), not just by hiding buttons.

**Reports, dashboards and audit** — role-specific dashboards, attendance / academic / fee reports (CSV export), and an append-only audit trail of material actions.

**UX** — responsive layout, search / filter / pagination on lists, skeleton loading, empty / success / error states, inline field errors, keyboard-accessible forms, print-ready report cards.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js **22.5+** |
| Backend | Express 5, Zod (validation), JWT (httpOnly cookie), bcryptjs, Helmet, express-rate-limit |
| Database | SQLite via Node's built-in `node:sqlite` (no native build step) |
| Frontend | React 18, React Router 6, Vite 6, lucide-react, Inter font |
| API docs | OpenAPI 3 + Swagger UI |
| Tests | `node:test` (unit + API integration) |
| Hosting | Render free tier (single web service) |

No Docker, no external services, no paid hosting.

---

## 3. Architecture

A **modular monolith**: one deployable process serves both the JSON API (`/api/*`) and the built React app, so the frontend uses relative `/api` URLs and needs no CORS configuration or frontend environment variables.

```
┌────────────────────┐   HTTPS / JSON    ┌──────────────────────────────────────┐
│  React SPA (Vite)  │ ────────────────► │  Express 5 app                       │
│  pages · ui · api  │ ◄──────────────── │                                      │
└────────────────────┘   httpOnly cookie │  routes/   HTTP layer, Zod, RBAC     │
                                         │  lib/      business rules (pure)     │
                                         │  SQLite    constraints & triggers    │
                                         └──────────────────┬───────────────────┘
                                                            │ node:sqlite (WAL)
                                                   ┌────────▼────────┐
                                                   │ data/school.db  │
                                                   └─────────────────┘
```

Layering:

- **UI** (`client/`) — pages, shared UI kit and a small fetch wrapper that maps API errors to inline field messages.
- **Routes** (`server/routes/`) — parse and validate input with Zod, enforce authorization, call business logic.
- **Business logic** (`server/lib/`) — `grading.js` (grades, results, ranks), `money.js` (integer-cents maths, invoice status), `access.js` (RBAC and row-level scoping). Mostly pure functions, which keeps them unit-testable.
- **Persistence** — SQLite schema in `server/migrations/`; constraints, unique indexes and triggers are the last line of defence.

Design decisions and trade-offs are explained in [`docs/TECHNICAL-REPORT.md`](docs/TECHNICAL-REPORT.md).

---

## 4. Database and ER diagram

There is **no separate database server to install or deploy**. The database is a single SQLite file (`DB_PATH`), created and migrated automatically on startup. Money is stored as **integer cents** to avoid floating-point errors.

The full ER diagram (Mermaid) and the list of database-enforced integrity rules are in [`docs/ER-DIAGRAM.md`](docs/ER-DIAGRAM.md). It renders on GitHub and in VS Code with a Mermaid extension.

Main tables: `users`, `teachers`, `guardians`, `classes`, `sections`, `subjects`, `students`, `student_guardians`, `teacher_assignments`, `attendance`, `grading_rules`, `grade_bands`, `exams`, `exam_subjects`, `marks`, `fee_invoices`, `fee_ledger`, `audit_log`.

Key database-level protections:

| Rule | Mechanism |
|---|---|
| One attendance row per student / date / session | `UNIQUE(student_id, date, session)` + `ON CONFLICT DO UPDATE` |
| Marks never exceed the subject maximum | `BEFORE INSERT/UPDATE` triggers; absent students cannot carry marks (`CHECK`) |
| One teacher per subject per section | `UNIQUE(section_id, subject_id)` |
| Ledger is append-only and signed correctly | `BEFORE UPDATE/DELETE` triggers; `CHECK` on entry sign |
| A payment request applies at most once | `UNIQUE(idempotency_key)` on `fee_ledger` |
| Audit trail cannot be rewritten | `BEFORE UPDATE` trigger on `audit_log` |
| Referenced records cannot be deleted | `ON DELETE RESTRICT` with `PRAGMA foreign_keys=ON` |
| Query performance | Indexes on students, attendance, marks, invoices, ledger and audit tables |

---

## 5. Local setup

**Prerequisite:** Node.js **22.5 or newer** (<https://nodejs.org>). Check with `node --version`.

```bash
git clone <REPO URL>
cd school-management-system

npm install
npm run db:reset      # create data/school.db, run migrations, load synthetic seed data
npm run build         # build the React app into client/dist
npm start             # → http://localhost:3000
```

Then open:

- App: <http://localhost:3000>
- API docs: <http://localhost:3000/api/docs>
- Health check: <http://localhost:3000/api/health>

**Development with hot reload** (API on :3000, UI on :5173 with an `/api` proxy):

```bash
npm run dev
```

**Windows shortcut:** double-click `start.bat`. It installs dependencies, seeds the database on first run, builds the UI and starts the server.

Optional: copy `.env.example` to `.env` to override defaults (see below). The app runs without one in development.

---

## 6. Environment variables

Copy `.env.example` to `.env` for local use. Never commit `.env`.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | — | Set to `production` to enforce a strong `JWT_SECRET` and secure cookies |
| `PORT` | `3000` | HTTP port (Render sets this automatically) |
| `DB_PATH` | `./data/school.db` | Location of the SQLite file (created automatically) |
| `JWT_SECRET` | dev-only value | **Required in production**, at least 32 random characters |
| `SESSION_HOURS` | `8` | Session lifetime |
| `COOKIE_SECURE` | `true` in production | Set `false` only for plain-HTTP LAN demos |
| `LOGIN_RATE_LIMIT` | `20` | Max login attempts per IP per 15 minutes |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Frontend variables:** none. The SPA calls the API on its own origin.

---

## 7. Database setup, migrations and seed data

| Command | Purpose |
|---|---|
| `npm run migrate` | Apply pending SQL migrations (idempotent, tracked in `schema_migrations`) |
| `npm run seed` | Load synthetic data into an **empty** database (skips if data exists) |
| `npm run db:reset` | Wipe, migrate and reseed (refuses in production without `--yes`) |

Migrations also run automatically each time the server starts.

The seed is deterministic and contains only synthetic data: **60 students, 40 guardians, 4 teachers**, classes and sections for Grades 6–8, subjects, teacher assignments, attendance history, exams with marks (including one exam with deliberately incomplete marks), grading rules, invoices, payments and audit entries.

---

## 8. Demo credentials

All accounts are dummy accounts. Password for **every** account: `Demo@12345`

| Role | Email | What to try |
|---|---|---|
| Admin | `admin@school.test` | Everything: students, classes, assignments, exams, fees, reports, audit |
| Teacher | `teacher1@school.test` | Grade 6 A/B only; marks only for Maths and Science |
| Teacher | `teacher2@school.test` | Grade 6 English, Hindi, Social Studies, Computer Science |
| Teacher | `teacher3@school.test` | Grade 7 only |
| Teacher | `teacher4@school.test` | Grade 8 only (its mid-term has incomplete marks) |
| Guardian | `guardian1@school.test` | One child; view attendance and report cards; pay a simulated fee |
| Guardian | `guardian2@school.test` | Two children in different sections |

The login page has one-click buttons for these accounts.

**Suggested reviewer walkthrough**

1. Log in as `teacher1` → open Attendance → mark a Grade 6 section → submit twice and see it update rather than duplicate. Try to open a Grade 7 section and get blocked.
2. Log in as `admin` → Exams → open an exam, review results, publish it. Check Audit for the entries.
3. Log in as `guardian1` → view the child's attendance and published report card, then pay an invoice (simulated). Confirm that other students are not reachable.
4. Back as `admin` → Fees / Reports → confirm the paid and outstanding totals match the ledger.

---

## 9. Deployment (Render, free tier)

The whole app deploys as **one Render Web Service**.

| Setting | Value |
|---|---|
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm run seed && npm start` |
| Health check path | `/api/health` |

Environment variables on Render:

| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a random 32+ character string |
| `COOKIE_SECURE` | `true` |
| `SESSION_HOURS` | `8` |
| `LOGIN_RATE_LIMIT` | `20` |
| `DB_PATH` | `./data/school.db` (free) or `/var/data/school.db` (with a Render Disk) |

Notes:

- `--include=dev` is needed because Vite is a dev dependency and `NODE_ENV=production` would otherwise skip it.
- `npm run seed` on every start is safe: it only seeds an empty database.
- On Render's **free tier the filesystem is ephemeral**: the database is recreated and reseeded on each restart or deploy, and the first request after idle may take 30–60 s. For persistent data, attach a Render Disk mounted at `/var/data` and set `DB_PATH=/var/data/school.db`.

---

## 10. API documentation

- **Swagger UI:** `/api/docs`
- **OpenAPI 3 JSON:** `/api/openapi.json`

Conventions:

- Success: `{ "data": ..., "meta": { "page", "pageSize", "total", "pages" } }`
- Error: `{ "error": { "code", "message", "details" } }`
- Stable error codes: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_STATE`, `OVERPAYMENT`, `IDEMPOTENCY_KEY_REUSED`, `RATE_LIMITED`
- Auth: `sms_token` httpOnly cookie, obtained via `POST /api/auth/login`
- All large lists support `page` and `pageSize`, plus search and filters where relevant

Endpoint groups:

| Group | Examples |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Academics | `/classes`, `/sections`, `/subjects`, `/assignments` |
| People | `/students` (search, filter, bulk move, guardian links), `/teachers`, `/guardians` |
| Attendance | `GET /attendance/roster`, `PUT /attendance` (bulk upsert), `/attendance/summary`, `/attendance/student/{id}` |
| Exams | `/grading-rules`, `/exams`, `POST /exams/{id}/status`, `/exams/{id}/marks`, `/exams/{id}/results`, `/report-cards/...` |
| Fees | `/fees/invoices`, `POST /fees/invoices/{id}/payments` (needs `Idempotency-Key`), `/fees/invoices/{id}/void`, `/fees/students/{id}/ledger`, `/fees/summary` |
| Reports | `/reports/dashboard`, `/reports/attendance`, `/reports/academic`, `/reports/fees` (CSV via `format=csv`) |
| Audit | `GET /audit` |
| System | `GET /health` |

---

## 11. Acceptance tests from the brief

| # | Requirement | How it is met | Automated test |
|---|---|---|---|
| 1 | A teacher can access only assigned classes and record attendance | `teacher_assignments` scope every roster, student, marks and report query; other sections return 403/404 | `ACCEPTANCE 1` |
| 2 | Duplicate attendance for the same student/session is rejected or safely updated | `UNIQUE(student, date, session)` + UPSERT; resubmitting updates; concurrent submits leave one row | `ACCEPTANCE 2` |
| 3 | Exam result is calculated correctly from configured marks and grading rules | Per-subject max/pass marks, configurable grade bands and overall pass %, absent = 0 and fail, ranks | `ACCEPTANCE 3` + `unit.test.js` |
| 4 | A guardian sees only the linked student's allowed information | Scoped lists; identical 404 for "not yours" and "missing"; only published report cards | `ACCEPTANCE 4` |
| 5 | Fee due and paid totals reconcile with the fee ledger | Invoice money is always derived from `fee_ledger`; `invoiced − paid − voided = outstanding`, verified per student and school-wide | `ACCEPTANCE 5` |

---

## 12. Business rules

- **Attendance %** = (present + late) ÷ (present + late + absent). Excused days are excluded. Future dates are rejected.
- **Exam lifecycle:** `draft → open → published`. Marks can be entered only while the exam is open. Publishing requires complete marks unless forced. Published exams lock their marks and grading rule.
- **Result:** a student passes only if **every** subject reaches its pass marks **and** the overall percentage reaches the grading rule's pass %. Absent counts as 0 and a fail. Ranks are computed per section.
- **Grading rules** are data (bands + pass %) and are locked once used by a published exam, so history cannot change retroactively.
- **Invoices:** created per student, section or class. A duplicate-batch guard prevents double submits. Status flows `issued → partial → paid`, or `void`. Paid invoices cannot be voided.
- **Payments (simulated):** require an `Idempotency-Key` header. A replay returns the original payment; reusing a key with a different amount returns 422; overpayment and paying void or paid invoices return 409. No card data is ever collected.
- **Capacity:** sections cannot exceed their capacity.

---

## 13. Security and data integrity

- **Authentication:** bcrypt password hashing, JWT in an httpOnly, SameSite=Lax cookie (`Secure` in production).
- **Session revocation:** each request reloads the user; deactivating an account or changing its password (`token_version`) invalidates existing sessions immediately.
- **Authorization:** `requireRole` on every route plus row-level scoping in `lib/access.js`. Unauthorized access to a record returns the same 404 as a missing record, so IDs cannot be probed.
- **Validation:** Zod on all inputs, with uniform per-field error messages. Database constraint failures are translated to clean 400/409 responses.
- **Transactions:** critical writes (attendance, marks, payments, invoices) use `BEGIN IMMEDIATE` transactions.
- **Idempotency and state machines:** payment idempotency keys, exam and invoice transitions, duplicate-batch guard.
- **Hardening:** login rate limiting with timing equalisation, Helmet with a strict CSP, same-origin check on state-changing requests (CSRF defence in depth), parameterised SQL only, `LIKE` wildcard escaping, CSV formula-injection guard.
- **Privacy:** synthetic data only; one guardian can never see another student's record.
- **Secrets:** no `.env`, passwords or tokens in the repository; only `.env.example`. Production refuses to start without a strong `JWT_SECRET`.
- **Audit trail:** append-only log of logins (including failures), attendance, marks, exam state changes, invoices, payments and account changes.

---

## 14. Testing

```bash
npm test
```

Runs **33 tests** against an in-memory database seeded by the real seed script (about 3 seconds):

- **12 unit tests** — grading boundaries, rounding, absent and incomplete marks, ranks, band validation, money maths, CSV escaping.
- **21 API integration tests** — the 5 acceptance scenarios plus negative and conflict cases: cross-section access, duplicate and concurrent attendance, marks above maximum, overpayment, idempotency-key reuse, void after payment, duplicate invoice batch, section capacity, CSRF rejection, malformed JSON, and database-level immutability of the ledger and audit log.

Test files: `server/test/unit.test.js`, `server/test/api.test.js`, `server/test/helpers.js`.

**Test evidence:** `<ADD A SCREENSHOT OR PASTE THE TERMINAL OUTPUT SHOWING 33 PASSING TESTS HERE>`

---

## 15. Project structure

```
client/                 React SPA
  src/pages/            Dashboard, Students, People, Academics, Attendance, Exams, Fees, Reports, Audit, Login, Landing
  src/ui.jsx            Shared UI components
  src/api.js            API client and formatters
  src/auth.js           Session handling
server/
  app.js                Express wiring: security headers, CSRF check, auth, routers, error envelope
  index.js              Entry point (migrate on start)
  routes/               auth, academics, people, attendance, exams, fees, reports
  lib/                  grading, money, access (RBAC), db, errors, util
  migrations/           SQL schema (001_init.sql)
  scripts/              migrate, seed, reset
  seed.js               Deterministic synthetic data
  openapi.js            OpenAPI 3 spec → /api/openapi.json and /api/docs
  test/                 Unit and integration tests
docs/
  ER-DIAGRAM.md         Schema diagram and integrity rules
  TECHNICAL-REPORT.md   Key design decisions
.env.example            Placeholder environment file
start.bat               One-click Windows launcher
```

---

## 16. Known limitations and assumptions

- **Guardian login only.** Students do not have their own accounts (the brief allows "guardian/student").
- **SQLite is single-node.** It suits one school on one instance. Scaling out would mean moving to PostgreSQL; SQL is standard and data access is isolated in the route files.
- **Free-tier demo data is ephemeral.** Without a persistent disk the hosted database resets on restart or redeploy, and the first request after idle is slow.
- **Currency is fixed to INR.** No taxes, discounts, late fees or refunds. Paid invoices cannot be voided or refunded.
- **Payments are simulated.** No payment gateway is integrated.
- **No email or SMS notifications, file uploads, timetable or multi-school tenancy.**
- **Password resets are done by an admin.** There is no self-service email reset because no mail service is used.
- **Swagger UI** loads its assets from a CDN (unpkg) on `/api/docs` only; the rest of the app is self-contained.
- **Demo credentials are public** (listed above) and the data is fake. Do not store real student data in this deployment.

---

## 17. AI use and attribution

AI assistance (Claude, by Anthropic) was used during development for: `<EDIT: e.g. scaffolding, test writing, documentation drafts>`, and for debugging and deployment setup on Render (environment variables, build/start commands, diagnosing a missing frontend build). All code was reviewed, tested and is understood by the author, who can explain and modify any part of it.

Libraries (all MIT/ISC licensed): Express, Zod, bcryptjs, jsonwebtoken, helmet, express-rate-limit, React, React Router, Vite, lucide-react, `@fontsource-variable/inter`. Swagger UI is loaded from a CDN. All data is synthetic and generated by `server/seed.js`. Photographs in `client/src/assets/` are `<EDIT: state the source/licence of the images, e.g. Unsplash/own>`.

---

## Declarations

I confirm that this project is my own work, that I can explain the code, that it contains no real sensitive data or secrets, and that all links in this document work.
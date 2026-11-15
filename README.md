# Greenfield School - School Management System

Full-stack school management application: academic administration, attendance, exams and report cards, fees with a reconciling ledger, role-based access (admin / teacher / guardian), reports and an audit trail. All data is **synthetic**.

- **Backend:** Node.js 22+ - Express 5 - SQLite (built-in `node:sqlite`, no native build step) - Zod validation - JWT in an httpOnly cookie
- **Frontend:** React 18 + Vite, responsive, light theme, Inter typeface, keyboard accessible
- **No Docker, no external services, no paid hosting.**

## Quick start (Windows / macOS / Linux)

Requires **Node.js 22.5 or newer** (https://nodejs.org).

```bash
npm install
npm run db:reset      # creates data/school.db, runs migrations, loads synthetic seed data
npm run build         # builds the React app into client/dist
npm start             # http://localhost:3000   (API docs: http://localhost:3000/api/docs)
```

Development with hot reload (API on :3000, UI on :5173):

```bash
npm run dev
```

### Demo credentials (dummy data, password for all: `Demo@12345`)

| Role | Email | What to try |
|---|---|---|
| Admin | `admin@school.test` | Everything: students, classes, assignments, exams, fees, reports, audit |
| Teacher (Grade 6: Maths + Science) | `teacher1@school.test` | Only Grade 6 A/B; marks only for Maths and Science |
| Teacher (Grade 6: other subjects) | `teacher2@school.test` | English, Hindi, Social Studies, CS in Grade 6 |
| Teacher (Grade 7) | `teacher3@school.test` | Only Grade 7 |
| Teacher (Grade 8) | `teacher4@school.test` | Only Grade 8 (its mid-term has incomplete marks) |
| Guardian (1 child) | `guardian1@school.test` | Sees only their child; pays a simulated fee |
| Guardian (2 children) | `guardian2@school.test` | Sibling view in different sections |

The login page has one-click buttons for these accounts.

### Environment variables (`.env`, see `.env.example`)

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | - | `production` enforces `JWT_SECRET` and secure cookies |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/school.db` | SQLite file; WAL mode |
| `JWT_SECRET` | dev value | **Required (32+ chars) in production** |
| `SESSION_HOURS` | `8` | |
| `COOKIE_SECURE` | `true` in production | Set `false` for plain-http LAN demos |
| `LOGIN_RATE_LIMIT` | `20` | per IP per 15 min |

### Commands

| Command | Purpose |
|---|---|
| `npm run migrate` | Apply pending SQL migrations (idempotent) |
| `npm run seed` | Seed synthetic data into an empty DB |
| `npm run db:reset` | Wipe, migrate and reseed (refuses in production without `--yes`) |
| `npm test` | 33 unit + API integration tests (in-memory DB, ~3 s) |
| `npm run build` / `npm start` | Production build / serve API + UI from one process |

## Architecture

Modular monolith, one deployable process:

```
client/                React SPA (pages, ui kit, API client)
server/
  app.js               Express wiring: security headers, CSRF origin check, auth, routers, error envelope
  routes/              HTTP layer per module (auth, academics, people, attendance, exams, fees, reports)
  lib/                 Business logic + helpers
    grading.js         pure grade / result / rank calculation (unit tested)
    money.js           integer-cents arithmetic, invoice status
    access.js          RBAC + row-level scoping (teacher sections, guardian children)
    db.js, errors.js, util.js
  migrations/*.sql     schema (constraints, indexes, triggers)
  seed.js              deterministic synthetic data
  openapi.js           OpenAPI 3 spec -> /api/openapi.json, Swagger UI -> /api/docs
  test/                node:test unit + integration tests
docs/                  ER diagram, technical report
```

Layering: **routes** parse/validate input (Zod) and enforce authorization -> **lib** holds rules -> **SQLite** enforces invariants as the last line of defence. Details and trade-offs are in [`docs/TECHNICAL-REPORT.md`](docs/TECHNICAL-REPORT.md); the schema is in [`docs/ER-DIAGRAM.md`](docs/ER-DIAGRAM.md).

## Acceptance tests from the brief - where they are demonstrated

| # | Requirement | How it works | Test |
|---|---|---|---|
| 1 | Teacher accesses only assigned classes and records attendance | `teacher_assignments` scope every roster, student, marks and report query; other sections return 403/404 | `ACCEPTANCE 1` |
| 2 | Duplicate attendance rejected or safely updated | `UNIQUE(student,date,session)` + UPSERT; resubmitting updates; concurrent submits leave one row | `ACCEPTANCE 2` |
| 3 | Exam result from configured marks and grading rules | per-subject max/pass marks, configurable grade bands + overall pass %, absent = 0 and fail, ranks | `ACCEPTANCE 3` + `unit.test.js` |
| 4 | Guardian sees only the linked student | scoped lists; identical 404 for "not yours" and "missing"; only published report cards | `ACCEPTANCE 4` |
| 5 | Fee due and paid reconcile with the ledger | invoice money is always derived from `fee_ledger`; `invoiced - paid - voided = outstanding` verified per student and school-wide | `ACCEPTANCE 5` |

## Key behaviours and rules

- **Attendance %** = (present + late) / (present + late + absent); excused days are excluded. Future dates are rejected.
- **Exam lifecycle:** `draft -> open -> published` (publish needs complete marks unless forced; published exams lock marks and their grading rule).
- **Result:** a student passes only if every subject reaches its pass marks **and** the overall percentage reaches the rule's pass %.
- **Payments (simulated):** need an `Idempotency-Key` header. Replays return the original payment; reusing a key with a different amount is a 422; overpayment and paying void/paid invoices are 409. No card data is ever collected.
- **Invoices:** bulk by class/section/student; a duplicate-batch guard prevents double-submits; paid invoices cannot be voided.
- **Audit trail** for logins (including failures), attendance, marks, exam state changes, invoices, payments, account changes.
- **Security:** bcrypt, httpOnly SameSite cookie, `token_version` revokes sessions on deactivation/password change, login rate limiting + timing equalisation, helmet CSP, same-origin check on mutations, parameterised SQL only, LIKE wildcard escaping, CSV formula-injection guard.
- **API conventions:** `{data, meta}` on success; `{error:{code,message,details}}` on failure; pagination on all large lists (`page`, `pageSize`).

## Known limitations / assumptions

- Guardian login only; students do not have their own accounts (the brief allows "guardian/student").
- SQLite single-writer is ideal for a single school instance; scaling out would mean swapping to PostgreSQL (SQL is standard, access is isolated in route files).
- Currency is fixed to INR; no taxes, discounts, late fees or refunds (paid invoices cannot be voided or refunded).
- No email/SMS notifications, file uploads, timetable or multi-school tenancy.
- Passwords are reset by an admin (no self-service email reset since no mail service is used).
- A public demo URL is not included (no paid hosting). Run locally with the steps above; to demo on a LAN set `COOKIE_SECURE=false`.

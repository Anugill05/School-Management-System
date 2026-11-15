# Technical report - key design decisions

## 1. Goals
A correct, explainable MVP of a school management system: every acceptance test in the brief is backed by an automated test, authorization is enforced on the server, and money and attendance cannot be corrupted by retries or races.

## 2. Architecture
A modular monolith (Express routers per domain + shared `lib/`) serving a React SPA from the same process. One process, one SQLite file: trivial to run locally, with no Docker and no external services.

**Why SQLite via `node:sqlite`?** Zero native compilation on Windows, transactional, supports foreign keys, triggers, CHECK constraints and partial features we rely on. `BEGIN IMMEDIATE` transactions serialise writers, which removes whole classes of race conditions for payments and attendance. Trade-off: single-node; PostgreSQL would be the next step.

**Why Express 5 + Zod?** Async handlers propagate errors natively; Zod gives one place for input validation and a uniform `VALIDATION_ERROR` shape with per-field messages the UI maps to inputs.

## 3. Authorization model
- Roles: `admin`, `teacher`, `guardian`, checked by `requireRole` middleware on every route (never UI-only).
- **Row-level scoping** in `lib/access.js`: teachers via `teacher_assignments` (section for attendance/students, section+subject for marks), guardians via `student_guardians`.
- Unauthorized access to a student returns **404** identical to a missing record, so IDs cannot be probed.
- Sessions: JWT in an httpOnly SameSite=Lax cookie; each request re-loads the user, so deactivation or a password change (`token_version`) revokes access immediately.

## 4. Data integrity
- **Attendance:** `UNIQUE(student, date, session)` + `INSERT ... ON CONFLICT DO UPDATE` inside one transaction; the response reports created/updated/unchanged. Tests fire 4 concurrent submits and assert one row.
- **Grades:** pure functions (`lib/grading.js`) with unit tests for boundaries, rounding, absent, incomplete, ranks and band validation. Rules are data (bands + pass %), and are locked once used by a published exam so history cannot change retroactively.
- **Fees:** an append-only double-entry-style ledger (`charge +`, `payment -`, `void -`). Outstanding/paid are always `SUM` over the ledger; the invoice `status` is a cache updated in the same transaction. Triggers forbid UPDATE/DELETE.
- **Idempotency:** payments need an `Idempotency-Key`; the key is `UNIQUE` in the ledger. Replays return the original result, a changed payload is rejected, and parallel duplicates yield exactly one payment (tested).
- **State machines:** exam `draft -> open -> published`; invoice `issued -> partial -> paid | void`. Invalid transitions return 409 `INVALID_STATE`.

## 5. API design
REST under `/api`, envelope `{data, meta}` / `{error:{code,message,details}}`, stable error codes, pagination/search/filter on lists, OpenAPI at `/api/openapi.json` with Swagger UI at `/api/docs`. SQLite constraint failures are translated to friendly 409/400 responses so clients never see raw database errors.

## 6. UI / UX
Task-oriented screens per role, skeleton loading, empty states with guidance, inline field errors tied via `aria-describedby`, toasts for success, focus-trapped modals with Esc, keyboard-operable attendance controls, print-ready report card, responsive layout with an off-canvas menu, `prefers-color-scheme` dark mode and reduced-motion support.

## 7. Testing
`npm test` runs 33 tests on an in-memory database seeded with the real seed script: 12 pure unit tests (grading, money, rates, CSV) and 21 API integration tests including negative/conflict cases (cross-section access, duplicate attendance, marks above max, overpayment, key reuse, void-after-payment, duplicate invoice batch, capacity, CSRF, bad JSON) plus DB-level immutability checks.

## 8. Security notes
bcrypt (cost 10), login rate limit and timing equalisation, helmet + CSP, same-origin check for state-changing requests, parameterised queries only, LIKE escaping, CSV formula-injection guard, no secrets in the repo (`.env.example` only), production refuses to start without a strong `JWT_SECRET`.

## 9. Known gaps
See README "Known limitations". The most material: no student logins, no refunds, INR only, single-node SQLite.

## 10. AI and attribution
Built with AI assistance (Claude) for scaffolding, tests and documentation; all design decisions above are documented so they can be explained and modified. Libraries: Express, Zod, bcryptjs, jsonwebtoken, helmet, express-rate-limit, React, React Router, Vite, lucide-react (all MIT/ISC licensed). Swagger UI is loaded from a CDN only on `/api/docs`.

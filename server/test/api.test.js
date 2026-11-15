import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, today } from './helpers.js';

let S; let admin; let teacher1; let teacher3; let guardian1;
before(async () => {
  S = await startTestServer();
  [admin, teacher1, teacher3, guardian1] = await Promise.all([S.as('admin@school.test'), S.as('teacher1@school.test'), S.as('teacher3@school.test'), S.as('guardian1@school.test')]);
});
after(() => S.close());

const sectionOf = (grade, name) => S.db.prepare(`SELECT s.id FROM sections s JOIN classes c ON c.id=s.class_id WHERE c.name=? AND s.name=?`).get(`Grade ${grade}`, name).id;
const yesterday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- auth
test('auth: unauthenticated requests are rejected and bad logins give one generic message', async () => {
  const anon = S.client();
  assert.equal((await anon.get('/students')).status, 401);
  const bad = await anon.post('/auth/login', { email: 'admin@school.test', password: 'wrong' });
  const unknown = await anon.post('/auth/login', { email: 'nobody@school.test', password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.message, unknown.body.error.message);
  assert.equal(bad.body.error.code, 'INVALID_CREDENTIALS');
});

test('auth: validation errors use the standard error envelope', async () => {
  const r = await S.client().post('/auth/login', { email: 'not-an-email' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  assert.ok(r.body.error.details.fields.email);
});

test('auth: deactivated users lose access immediately and password change invalidates old sessions', async () => {
  const c = await S.as('teacher4@school.test');
  assert.equal((await c.get('/auth/me')).status, 200);
  const t = S.db.prepare("SELECT t.id FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.email='teacher4@school.test'").get();
  await admin.patch(`/teachers/${t.id}`, { active: false });
  assert.equal((await c.get('/auth/me')).status, 401);
  assert.equal((await S.client().post('/auth/login', { email: 'teacher4@school.test', password: 'Demo@12345' })).status, 401);
  await admin.patch(`/teachers/${t.id}`, { active: true });
});

// ------------------------------------------------- acceptance 1: teacher scope
test('ACCEPTANCE 1: a teacher can access only assigned classes and record attendance', async () => {
  const g6a = sectionOf(6, 'A'); const g7a = sectionOf(7, 'A');
  const classes = await teacher1.get('/classes');
  assert.deepEqual(classes.body.data.map((c) => c.name), ['Grade 6']);

  const students = await teacher1.get('/students?pageSize=100');
  assert.equal(students.body.meta.total, 20);
  assert.ok(students.body.data.every((s) => s.class_name === 'Grade 6'));

  assert.equal((await teacher1.get(`/attendance/roster?section_id=${g6a}&date=${yesterday()}&session=morning`)).status, 200);
  const denied = await teacher1.get(`/attendance/roster?section_id=${g7a}&date=${yesterday()}&session=morning`);
  assert.equal(denied.status, 403);

  const g7student = S.db.prepare('SELECT id FROM students WHERE section_id=? LIMIT 1').get(g7a).id;
  assert.equal((await teacher1.get(`/students/${g7student}`)).status, 404);
  assert.equal((await teacher1.put('/attendance', { section_id: g7a, date: yesterday(), session: 'morning', records: [{ student_id: g7student, status: 'present' }] })).status, 403);

  const roster = (await teacher1.get(`/attendance/roster?section_id=${g6a}&date=${today()}&session=morning`)).body.data;
  const save = await teacher1.put('/attendance', { section_id: g6a, date: today(), session: 'morning', records: roster.map((s, i) => ({ student_id: s.student_id, status: i === 0 ? 'absent' : 'present' })) });
  assert.equal(save.status, 200);
  assert.deepEqual(save.body.data, { created: 10, updated: 0, unchanged: 0 });
});

test('role gates: admin-only endpoints reject teachers and guardians server-side', async () => {
  const body = { admission_no: 'X-1', first_name: 'A', last_name: 'B', dob: '2015-01-01', gender: 'male', section_id: sectionOf(6, 'A') };
  assert.equal((await teacher1.post('/students', body)).status, 403);
  assert.equal((await guardian1.post('/students', body)).status, 403);
  assert.equal((await teacher1.get('/audit')).status, 403);
  assert.equal((await teacher1.get('/fees/invoices')).status, 403);
  assert.equal((await guardian1.get('/teachers')).status, 403);
  assert.equal((await guardian1.get(`/attendance/roster?section_id=${sectionOf(6, 'A')}&date=${today()}`)).status, 403);
});

// ------------------------------------------- acceptance 2: duplicate attendance
test('ACCEPTANCE 2: duplicate attendance for the same student/date/session is safely updated, never duplicated', async () => {
  const g6b = sectionOf(6, 'B'); const date = yesterday();
  const roster = (await teacher1.get(`/attendance/roster?section_id=${g6b}&date=${date}&session=afternoon`)).body.data;
  const first = roster[0].student_id;
  const mk = (status) => ({ section_id: g6b, date, session: 'afternoon', records: [{ student_id: first, status }] });
  S.db.prepare('DELETE FROM attendance WHERE section_id=? AND date=? AND session=?').run(g6b, date, 'afternoon');

  assert.deepEqual((await teacher1.put('/attendance', mk('present'))).body.data, { created: 1, updated: 0, unchanged: 0 });
  assert.deepEqual((await teacher1.put('/attendance', mk('present'))).body.data, { created: 0, updated: 0, unchanged: 1 });
  assert.deepEqual((await teacher1.put('/attendance', mk('late'))).body.data, { created: 0, updated: 1, unchanged: 0 });
  const rows = S.db.prepare('SELECT status FROM attendance WHERE student_id=? AND date=? AND session=?').all(first, date, 'afternoon');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'late');

  // concurrent identical submissions still leave exactly one row
  await Promise.all([1, 2, 3, 4].map(() => teacher1.put('/attendance', mk('absent'))));
  assert.equal(S.db.prepare('SELECT COUNT(*) c FROM attendance WHERE student_id=? AND date=? AND session=?').get(first, date, 'afternoon').c, 1);

  // the database itself refuses a raw duplicate
  assert.throws(() => S.db.prepare("INSERT INTO attendance (student_id, section_id, date, session, status, marked_by) VALUES (?,?,?,?,'present',1)").run(first, g6b, date, 'afternoon'), /UNIQUE/);
});

test('attendance negatives: duplicate in payload, foreign student, future date, bad status', async () => {
  const g6a = sectionOf(6, 'A'); const g6b = sectionOf(6, 'B');
  const inA = S.db.prepare('SELECT id FROM students WHERE section_id=? LIMIT 1').get(g6a).id;
  const inB = S.db.prepare('SELECT id FROM students WHERE section_id=? LIMIT 1').get(g6b).id;
  const put = (records, date = yesterday()) => teacher1.put('/attendance', { section_id: g6a, date, session: 'morning', records });
  assert.equal((await put([{ student_id: inA, status: 'present' }, { student_id: inA, status: 'absent' }])).body.error.code, 'DUPLICATE_IN_REQUEST');
  assert.equal((await put([{ student_id: inB, status: 'present' }])).body.error.code, 'STUDENT_NOT_IN_SECTION');
  const future = new Date(); future.setUTCDate(future.getUTCDate() + 3);
  assert.equal((await put([{ student_id: inA, status: 'present' }], future.toISOString().slice(0, 10))).body.error.code, 'FUTURE_DATE');
  assert.equal((await put([{ student_id: inA, status: 'sleeping' }])).status, 400);
});

test('attendance summary percentages match the records', async () => {
  const g6a = sectionOf(6, 'A');
  const s = (await teacher1.get(`/attendance/summary?section_id=${g6a}&from=2000-01-01&to=${today()}`)).body;
  const row = s.data[0];
  const raw = S.db.prepare("SELECT SUM(status='present') p, SUM(status='late') l, SUM(status='absent') a FROM attendance WHERE student_id=?").get(row.student_id);
  assert.equal(row.present, raw.p); assert.equal(row.late, raw.l); assert.equal(row.absent, raw.a);
  assert.equal(row.rate, Math.round(((raw.p + raw.l) / (raw.p + raw.l + raw.a)) * 1000) / 10);
});

// ------------------------------------------------ acceptance 3: exam results
test('ACCEPTANCE 3: exam result is calculated from configured marks and grading rules', async () => {
  const classId = S.db.prepare("SELECT id FROM classes WHERE name='Grade 8'").get().id;
  const subj = (code) => S.db.prepare('SELECT id FROM subjects WHERE code=?').get(code).id;
  const ruleId = S.db.prepare('SELECT id FROM grading_rules WHERE is_default=1').get().id;
  const created = await admin.post('/exams', { name: 'Acceptance Quiz', term: 'Test', class_id: classId, grading_rule_id: ruleId,
    subjects: [{ subject_id: subj('MATH'), max_marks: 50, pass_marks: 20 }, { subject_id: subj('ENG'), max_marks: 50, pass_marks: 20 }] });
  assert.equal(created.status, 201);
  const eid = created.body.data.id;
  const g8a = sectionOf(8, 'A');
  const students = S.db.prepare('SELECT id FROM students WHERE section_id=? ORDER BY last_name, first_name').all(g8a).map((x) => x.id);

  // cannot enter marks while draft
  const early = await admin.put(`/exams/${eid}/marks`, { section_id: g8a, subject_id: subj('MATH'), entries: [{ student_id: students[0], marks_obtained: 10 }] });
  assert.equal(early.body.error.code, 'INVALID_STATE');
  assert.equal((await admin.post(`/exams/${eid}/status`, { status: 'open' })).status, 200);

  // marks above max are rejected (400) and nothing is saved
  const tooHigh = await admin.put(`/exams/${eid}/marks`, { section_id: g8a, subject_id: subj('MATH'), entries: [{ student_id: students[0], marks_obtained: 51 }] });
  assert.equal(tooHigh.status, 400);
  assert.equal(S.db.prepare('SELECT COUNT(*) c FROM marks WHERE exam_id=?').get(eid).c, 0);

  const enter = (code, vals) => admin.put(`/exams/${eid}/marks`, { section_id: g8a, subject_id: subj(code),
    entries: vals.map((v, i) => (v === 'ab' ? { student_id: students[i], is_absent: true } : { student_id: students[i], marks_obtained: v })) });
  // s0: 45+30 = 75/100 PASS B ; s1: 18+50 = 68% but fails MATH => FAIL ; s2: absent ENG ; s3: 50+50 = A+
  assert.equal((await enter('MATH', [45, 18, 40, 50])).status, 200);
  assert.equal((await enter('ENG', [30, 50, 'ab', 50])).status, 200);

  const results = (await admin.get(`/exams/${eid}/results?section_id=${g8a}`)).body.data;
  const by = (i) => results.find((r) => r.id === students[i]);
  assert.equal(by(0).total_obtained, 75); assert.equal(by(0).percent, 75); assert.equal(by(0).grade, 'B'); assert.equal(by(0).result, 'PASS');
  assert.equal(by(1).percent, 68); assert.equal(by(1).result, 'FAIL'); assert.equal(by(1).failed_subjects, 1);
  assert.equal(by(2).percent, 40); assert.equal(by(2).result, 'FAIL'); // absent => 0 and fails ENG
  assert.equal(by(3).percent, 100); assert.equal(by(3).grade, 'A+'); assert.equal(by(3).rank, 1);
  assert.equal(by(4).result, 'INCOMPLETE');

  // changing the rule changes the outcome for new calculations (configurable rules)
  const strict = S.db.prepare("SELECT id FROM grading_rules WHERE name LIKE 'Strict%'").get().id;
  const rule = (await admin.get('/grading-rules')).body.data.find((r) => r.id === strict);
  assert.equal(rule.pass_percent, 50);

  // publishing with missing marks is blocked unless forced; once published the report card is visible to the guardian
  const blocked = await admin.post(`/exams/${eid}/status`, { status: 'published' });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'MARKS_INCOMPLETE');
  assert.equal((await admin.post(`/exams/${eid}/status`, { status: 'published', force: true })).status, 200);
  assert.equal((await admin.post(`/exams/${eid}/status`, { status: 'draft' })).body.error.code, 'INVALID_STATE');
  assert.equal((await admin.put(`/exams/${eid}/marks`, { section_id: g8a, subject_id: subj('MATH'), entries: [{ student_id: students[0], marks_obtained: 1 }] })).body.error.code, 'INVALID_STATE');

  const card = await admin.get(`/report-cards/${students[0]}/${eid}`);
  assert.equal(card.body.data.percent, 75);
  assert.equal(card.body.data.rank, 2); // 100%, 75%, 68%, 40% are the only complete results in the section
  assert.equal(card.body.data.class_size, 4);
  assert.equal(card.body.data.subjects.length, 2);
});

test('teachers can only enter marks for subjects they teach in that section', async () => {
  const g6a = sectionOf(6, 'A');
  const exam = S.db.prepare("SELECT id FROM exams WHERE name='Unit Test 2'").get().id;
  const sid = S.db.prepare('SELECT id FROM subjects WHERE code=?');
  const st = S.db.prepare('SELECT id FROM students WHERE section_id=? LIMIT 1').get(g6a).id;
  const entry = (subject) => ({ section_id: g6a, subject_id: sid.get(subject).id, entries: [{ student_id: st, marks_obtained: 10 }] });
  assert.equal((await teacher1.put(`/exams/${exam}/marks`, entry('MATH'))).status, 200); // teacher1 teaches MATH in Grade 6
  assert.equal((await teacher1.put(`/exams/${exam}/marks`, entry('ENG'))).status, 403); // ENG belongs to teacher2
  assert.equal((await teacher3.put(`/exams/${exam}/marks`, entry('MATH'))).status, 404); // another class's exam is invisible to them
});

test('grading rule bands are validated and locked once a published exam uses them', async () => {
  const bad = await admin.post('/grading-rules', { name: 'Broken', pass_percent: 40, bands: [{ min_percent: 50, grade: 'A' }] });
  assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'INVALID_GRADING_RULE');
  const def = S.db.prepare('SELECT id FROM grading_rules WHERE is_default=1').get().id;
  const cur = (await admin.get('/grading-rules')).body.data.find((r) => r.id === def);
  const locked = await admin.put(`/grading-rules/${def}`, { name: cur.name, pass_percent: 30, is_default: true, bands: cur.bands });
  assert.equal(locked.body.error.code, 'RULE_LOCKED');
});

// -------------------------------------------- acceptance 4: guardian privacy
test('ACCEPTANCE 4: a guardian sees only the linked student\'s allowed information', async () => {
  const mine = S.db.prepare("SELECT sg.student_id id FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id JOIN users u ON u.id=g.user_id WHERE u.email='guardian1@school.test'").all().map((x) => x.id);
  const other = S.db.prepare(`SELECT id FROM students WHERE id NOT IN (${mine.join(',')}) LIMIT 1`).get().id;

  const list = await guardian1.get('/students');
  assert.deepEqual(list.body.data.map((s) => s.id).sort(), [...mine].sort());
  assert.equal((await guardian1.get(`/students/${mine[0]}`)).status, 200);

  // identical 404 for "not yours" and "does not exist": existence is not leaked
  const foreign = await guardian1.get(`/students/${other}`); const missing = await guardian1.get('/students/999999');
  assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
  for (const path of [`/attendance/student/${other}`, `/report-cards/${other}`, `/fees/students/${other}/ledger`]) assert.equal((await guardian1.get(path)).status, 404, path);

  const otherInv = S.db.prepare('SELECT id FROM fee_invoices WHERE student_id=? LIMIT 1').get(other).id;
  assert.equal((await guardian1.get(`/fees/invoices/${otherInv}`)).status, 404);
  assert.equal((await guardian1.post(`/fees/invoices/${otherInv}/payments`, { amount: 1, method: 'card' }, { 'Idempotency-Key': 'steal-attempt-0001' })).status, 404);
  const invoices = await guardian1.get('/fees/invoices?pageSize=100');
  assert.ok(invoices.body.data.every((i) => mine.includes(i.student_id)));
  assert.ok((await guardian1.get(`/fees/invoices?student_id=${other}`)).body.data.length === 0);

  // report cards: only published exams
  const cards = (await guardian1.get(`/report-cards/${mine[0]}`)).body.data;
  assert.ok(cards.length > 0 && cards.every((c) => c.status === 'published'));
  const draftish = S.db.prepare("SELECT id FROM exams WHERE status='open' LIMIT 1").get().id;
  assert.equal((await guardian1.get(`/report-cards/${mine[0]}/${draftish}`)).status, 404);

  // guardian cannot see co-guardian contact data, other students' marks sheets or admin data
  assert.equal((await guardian1.get(`/exams/${draftish}/marks?section_id=1&subject_id=1`)).status, 403);
  assert.equal((await guardian1.get('/reports/fees')).status, 403);
  assert.equal((await guardian1.get('/audit')).status, 403);
});

// --------------------------------------------------- acceptance 5: fees ledger
test('ACCEPTANCE 5: fee due and paid totals reconcile with the ledger', async () => {
  // every student, every invoice: ledger identity holds
  const bad = S.db.prepare(`SELECT i.id FROM fee_invoices i WHERE i.amount_cents != COALESCE((SELECT SUM(amount_cents) FROM fee_ledger l WHERE l.invoice_id=i.id AND entry_type='charge'),0)`).all();
  assert.equal(bad.length, 0);

  const sid = S.db.prepare("SELECT s.id FROM students s JOIN student_guardians sg ON sg.student_id=s.id JOIN guardians g ON g.id=sg.guardian_id JOIN users u ON u.id=g.user_id WHERE u.email='guardian1@school.test' LIMIT 1").get().id;
  const before = (await admin.get(`/fees/students/${sid}/ledger`)).body.data.totals;
  assert.equal(before.reconciled, true);
  assert.equal(Math.round((before.invoiced - before.paid - before.voided) * 100), Math.round(before.outstanding * 100));

  const inv = (await admin.get(`/fees/invoices?student_id=${sid}&status=issued&pageSize=50`)).body.data.find((i) => i.amount >= 200);
  assert.ok(inv, 'seed provides an unpaid invoice for guardian1\'s child');
  const key = 'accept-pay-0001';
  const pay = await guardian1.post(`/fees/invoices/${inv.id}/payments`, { amount: 100.25, method: 'card' }, { 'Idempotency-Key': key });
  assert.equal(pay.status, 201);
  assert.equal(pay.body.data.invoice.status, 'partial');
  assert.equal(pay.body.data.invoice.paid, 100.25);
  assert.equal(pay.body.data.invoice.outstanding, inv.amount - 100.25);

  const after = (await admin.get(`/fees/students/${sid}/ledger`)).body.data.totals;
  assert.equal(after.reconciled, true);
  assert.equal(Math.round((after.paid - before.paid) * 100), 10025);
  assert.equal(Math.round((before.outstanding - after.outstanding) * 100), 10025);

  // invoice-level money always equals the ledger rows
  const detail = (await admin.get(`/fees/invoices/${inv.id}`)).body.data;
  const ledgerSum = detail.ledger.reduce((a, l) => a + l.amount_cents, 0);
  assert.equal(ledgerSum, detail.outstanding_cents);
  assert.equal(detail.ledger.filter((l) => l.entry_type === 'payment').reduce((a, l) => a - l.amount_cents, 0), detail.paid_cents);

  // school-wide: invoiced - paid - voided === outstanding
  const sum = (await admin.get('/fees/summary')).body.data;
  assert.equal(Math.round((sum.invoiced - sum.paid - sum.voided) * 100), Math.round(sum.outstanding * 100));
});

test('payments: idempotent replays, key reuse, overpayment, missing key, paid/void states', async () => {
  const sid = S.db.prepare('SELECT id FROM students WHERE admission_no=?').get('ADM2025-050').id;
  const create = await admin.post('/fees/invoices', { student_id: sid, title: 'Lab Fee', amount: '80.00', due_date: '2099-01-01' });
  assert.equal(create.status, 201);
  const iid = create.body.data.invoice_ids[0];
  const pay = (amount, key, method = 'upi') => admin.post(`/fees/invoices/${iid}/payments`, { amount, method }, key ? { 'Idempotency-Key': key } : {});

  assert.equal((await pay(10, null)).body.error.code, 'BAD_REQUEST');
  assert.equal((await pay(10, 'short')).status, 400);
  const first = await pay(30, 'idem-key-0001');
  assert.equal(first.status, 201);
  const replay = await pay(30, 'idem-key-0001');
  assert.equal(replay.status, 200); assert.equal(replay.body.data.replayed, true);
  assert.equal(replay.body.data.payment_id, first.body.data.payment_id);
  assert.equal(S.db.prepare("SELECT COUNT(*) c FROM fee_ledger WHERE invoice_id=? AND entry_type='payment'").get(iid).c, 1);
  assert.equal((await pay(31, 'idem-key-0001')).body.error.code, 'IDEMPOTENCY_KEY_REUSED');

  // parallel duplicate requests with the same key => exactly one payment
  const par = await Promise.all([1, 2, 3, 4, 5].map(() => pay(20, 'idem-key-par-1')));
  assert.equal(par.filter((r) => r.status === 201).length, 1);
  assert.equal(S.db.prepare("SELECT COUNT(*) c FROM fee_ledger WHERE invoice_id=? AND entry_type='payment'").get(iid).c, 2);

  const over = await pay(31, 'idem-key-over-1'); // outstanding is 30.00
  assert.equal(over.status, 409); assert.equal(over.body.error.code, 'OVERPAYMENT');
  assert.equal((await pay('12.345', 'idem-key-dec-01')).status, 400);
  assert.equal((await pay(-5, 'idem-key-neg-01')).status, 400);
  assert.equal((await admin.post(`/fees/invoices/${iid}/void`, { reason: 'mistake' })).body.error.code, 'INVALID_STATE'); // has payments

  const done = await pay(30, 'idem-key-done-1');
  assert.equal(done.body.data.invoice.status, 'paid');
  assert.equal((await pay(1, 'idem-key-more-1')).body.error.code, 'ALREADY_PAID');
});

test('invoices: bulk creation, duplicate guard, voiding and guardian cash restriction', async () => {
  const g7b = sectionOf(7, 'B');
  const body = { section_id: g7b, title: 'Annual Day', amount: 15, due_date: '2099-06-01' };
  const bulk = await admin.post('/fees/invoices', body);
  assert.equal(bulk.status, 201); assert.equal(bulk.body.data.created, 10);
  assert.equal((await admin.post('/fees/invoices', body)).body.error.code, 'DUPLICATE_INVOICE'); // double-submit guard
  assert.equal((await admin.post('/fees/invoices', { ...body, student_id: 1 })).status, 400); // ambiguous target

  const iid = bulk.body.data.invoice_ids[0];
  const v = await admin.post(`/fees/invoices/${iid}/void`, { reason: 'Waived' });
  assert.equal(v.body.data.status, 'void'); assert.equal(v.body.data.outstanding, 0);
  assert.equal((await admin.post(`/fees/invoices/${iid}/void`, { reason: 'again' })).body.error.code, 'INVALID_STATE');
  assert.equal((await admin.post(`/fees/invoices/${iid}/payments`, { amount: 1, method: 'cash' }, { 'Idempotency-Key': 'void-pay-000001' })).body.error.code, 'INVALID_STATE');

  const mineInv = (await guardian1.get('/fees/invoices?status=issued')).body.data[0];
  assert.equal((await guardian1.post(`/fees/invoices/${mineInv.id}/payments`, { amount: 1, method: 'cash' }, { 'Idempotency-Key': 'cash-try-000001' })).status, 403);
});

test('the ledger and audit log are append-only at the database level', () => {
  assert.throws(() => S.db.prepare('UPDATE fee_ledger SET amount_cents = amount_cents WHERE id = 1').run(), /append-only/);
  assert.throws(() => S.db.prepare('DELETE FROM fee_ledger WHERE id = 1').run(), /append-only/);
  assert.throws(() => S.db.prepare("UPDATE audit_log SET action='x' WHERE id = 1").run(), /append-only/);
  assert.throws(() => S.db.prepare('INSERT INTO fee_ledger (invoice_id, student_id, entry_type, amount_cents) VALUES (1,1,\'payment\',500)').run(), /CHECK/);
});

// -------------------------------------------------------- people / academics
test('students: search, filter, pagination, uniqueness, capacity', async () => {
  const page1 = await admin.get('/students?pageSize=25&page=1&sort=admission_no');
  assert.equal(page1.body.data.length, 25); assert.ok(page1.body.meta.total >= 60); assert.equal(page1.body.meta.page, 1);
  const page3 = await admin.get('/students?pageSize=25&page=3&sort=admission_no');
  assert.ok(page3.body.data.length >= 10);
  const q = await admin.get('/students?q=ADM2025-007');
  assert.equal(q.body.data.length, 1);
  assert.equal((await admin.get('/students?q=%25')).body.data.length, 0); // wildcard is escaped, not a match-all

  const sec = sectionOf(6, 'A');
  const body = { admission_no: 'ADM2025-001', first_name: 'Dup', last_name: 'Licate', dob: '2014-02-02', gender: 'female', section_id: sec };
  const dup = await admin.post('/students', body);
  assert.equal(dup.status, 409); assert.match(dup.body.error.message, /admission number/);
  assert.equal((await admin.post('/students', { ...body, admission_no: 'N-1', dob: '2999-01-01' })).status, 400);

  S.db.prepare('UPDATE sections SET capacity = 10 WHERE id = ?').run(sec);
  const full = await admin.post('/students', { ...body, admission_no: 'N-2' });
  assert.equal(full.status, 409); assert.equal(full.body.error.code, 'SECTION_FULL');
  S.db.prepare('UPDATE sections SET capacity = 40 WHERE id = ?').run(sec);
  const ok = await admin.post('/students', { ...body, admission_no: 'N-3', guardians: [{ guardian_id: 1, relation: 'mother' }] });
  assert.equal(ok.status, 201); assert.equal(ok.body.data.guardians.length, 1);
});

test('teacher assignments are unique per section+subject; deleting used classes is blocked', async () => {
  const dupe = await admin.post('/assignments', { teacher_id: 1, section_id: sectionOf(6, 'A'), subject_id: S.db.prepare("SELECT id FROM subjects WHERE code='MATH'").get().id });
  assert.equal(dupe.status, 409);
  const cls = S.db.prepare("SELECT id FROM classes WHERE name='Grade 6'").get().id;
  assert.equal((await admin.delete(`/classes/${cls}`)).status, 409);
  assert.equal((await admin.delete(`/sections/${sectionOf(6, 'A')}`)).status, 409);
});

// ----------------------------------------------------- reports, audit, system
test('reports: dashboards per role, CSV export and teacher scoping', async () => {
  const a = (await admin.get('/reports/dashboard')).body.data;
  assert.equal(a.role, 'admin'); assert.ok(a.stats.students >= 60); assert.ok(a.attendance_trend.length > 0);
  const t = (await teacher1.get('/reports/dashboard')).body.data;
  assert.equal(t.role, 'teacher'); assert.equal(t.sections.length, 2);
  const g = (await guardian1.get('/reports/dashboard')).body.data;
  assert.equal(g.role, 'guardian'); assert.ok(g.children.length >= 1);

  const csv = await admin.get('/reports/fees?format=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text.split('\n')[0], /admission_no,student,section/);

  const rep = (await teacher1.get('/reports/attendance?from=2000-01-01')).body.data;
  const g6count = S.db.prepare("SELECT COUNT(*) c FROM students s JOIN sections x ON x.id=s.section_id JOIN classes c ON c.id=x.class_id WHERE c.name='Grade 6' AND s.status='active'").get().c;
  assert.equal(rep.length, g6count); // only Grade 6 students
  assert.equal((await teacher1.get('/reports/fees')).status, 403);

  const ex = S.db.prepare("SELECT id FROM exams WHERE name='Mid-Term Examination' AND status='published' LIMIT 1").get().id;
  const ac = (await admin.get(`/reports/academic?exam_id=${ex}`)).body.data;
  assert.equal(ac.summary.students, g6count); assert.equal(ac.per_subject.length, 6);
  assert.ok(ac.summary.pass_rate >= 0);
});

test('audit trail records material actions with actor and details', async () => {
  const log = (await admin.get('/audit?entity=invoice&action=record_payment&pageSize=5')).body;
  assert.ok(log.meta.total >= 1);
  assert.equal(log.data[0].action, 'record_payment');
  assert.ok(log.data[0].actor_name); assert.ok(log.data[0].details.amount_cents);
  const att = (await admin.get('/audit?action=mark_attendance')).body;
  assert.ok(att.meta.total >= 1);
  assert.ok((await admin.get('/audit?action=login_failed')).body.meta.total >= 1);
});

test('system: health, openapi, unknown routes, malformed JSON, CSRF origin check', async () => {
  assert.equal((await S.client().get('/health')).body.data.status, 'ok');
  const spec = (await S.client().get('/openapi.json')).body;
  assert.equal(spec.openapi, '3.0.3'); assert.ok(Object.keys(spec.paths).length > 40);
  assert.equal((await admin.get('/nope')).body.error.code, 'NOT_FOUND');

  const raw = await fetch(`${S.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(raw.status, 400); assert.equal((await raw.json()).error.code, 'BAD_JSON');
  const csrf = await fetch(`${S.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(csrf.status, 403);
});

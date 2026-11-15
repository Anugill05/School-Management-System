import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRanks, computeResult, gradeFor, validateBands } from '../lib/grading.js';
import { invoiceStatus, toCents } from '../lib/money.js';
import { attendanceRate } from '../routes/attendance.js';
import { toCsv } from '../lib/util.js';

const bands = [
  { min_percent: 90, grade: 'A+', remark: 'Outstanding', gpa: 4 }, { min_percent: 80, grade: 'A', remark: '', gpa: 4 },
  { min_percent: 70, grade: 'B', remark: '', gpa: 3 }, { min_percent: 60, grade: 'C', remark: '', gpa: 2 },
  { min_percent: 50, grade: 'D', remark: '', gpa: 1 }, { min_percent: 0, grade: 'F', remark: '', gpa: 0 },
];
const rule = { pass_percent: 40, bands };
const sub = (id, max, pass, marks, absent = false) => ({ subject_id: id, name: `S${id}`, max_marks: max, pass_marks: pass, marks_obtained: marks, is_absent: absent });

test('gradeFor uses band boundaries inclusively and handles unsorted bands', () => {
  const shuffled = [...bands].reverse();
  assert.equal(gradeFor(90, shuffled).grade, 'A+');
  assert.equal(gradeFor(89.99, shuffled).grade, 'A');
  assert.equal(gradeFor(0, shuffled).grade, 'F');
  assert.equal(gradeFor(100, shuffled).grade, 'A+');
});

test('computeResult totals, percent and grade follow configured marks', () => {
  const r = computeResult([sub(1, 100, 35, 80), sub(2, 50, 20, 40), sub(3, 50, 20, 30)], rule);
  assert.equal(r.total_obtained, 150);
  assert.equal(r.total_max, 200);
  assert.equal(r.percent, 75);
  assert.equal(r.grade, 'B');
  assert.equal(r.result, 'PASS');
  assert.equal(r.subjects[1].percent, 80);
  assert.equal(r.subjects[1].grade, 'A');
});

test('failing one subject fails the student even when overall percent passes', () => {
  const r = computeResult([sub(1, 100, 35, 99), sub(2, 100, 35, 34)], rule);
  assert.equal(r.percent, 66.5);
  assert.equal(r.failed_subjects, 1);
  assert.equal(r.result, 'FAIL');
});

test('overall pass percent from the rule is enforced', () => {
  const r = computeResult([sub(1, 100, 0, 39)], rule);
  assert.equal(r.result, 'FAIL');
  assert.equal(computeResult([sub(1, 100, 0, 40)], rule).result, 'PASS');
});

test('absent scores zero and fails the subject; missing marks make the result INCOMPLETE', () => {
  const a = computeResult([sub(1, 100, 35, null, true), sub(2, 100, 35, 90)], rule);
  assert.equal(a.percent, 45);
  assert.equal(a.result, 'FAIL');
  assert.equal(a.subjects[0].status, 'absent');
  const inc = computeResult([sub(1, 100, 35, 90), sub(2, 100, 35, null)], rule);
  assert.equal(inc.result, 'INCOMPLETE');
  assert.equal(inc.percent, null);
  assert.equal(inc.pending_subjects, 1);
});

test('rounding is to 2 decimals', () => {
  assert.equal(computeResult([sub(1, 3, 0, 1)], rule).percent, 33.33);
});

test('ranks use competition ranking and skip incomplete results', () => {
  const ranked = assignRanks([{ percent: 90 }, { percent: 80 }, { percent: 80 }, { percent: 70 }, { percent: null }]);
  assert.deepEqual(ranked.map((x) => x.rank), [1, 2, 2, 4, null]);
});

test('validateBands rejects configs that leave scores ungraded or ambiguous', () => {
  assert.throws(() => validateBands([{ min_percent: 50, grade: 'A' }]), /minimum 0/);
  assert.throws(() => validateBands([{ min_percent: 0, grade: 'A' }, { min_percent: 0, grade: 'B' }]), /Duplicate minimum/);
  assert.throws(() => validateBands([{ min_percent: 0, grade: 'A' }, { min_percent: 50, grade: 'a' }]), /Duplicate grade/);
  assert.doesNotThrow(() => validateBands(bands));
});

test('toCents is exact and rejects bad input', () => {
  assert.equal(toCents('19.99'), 1999);
  assert.equal(toCents(0.1 + 0.2 === 0.3 ? 0.3 : '0.30'), 30);
  assert.equal(toCents(450), 45000);
  for (const bad of [0, '0.00', -5, '1.234', 'abc', '', '1e3']) assert.throws(() => toCents(bad), RangeError, String(bad));
});

test('invoiceStatus derives from ledger balance', () => {
  assert.equal(invoiceStatus({ amount_cents: 100, outstanding_cents: 100 }), 'issued');
  assert.equal(invoiceStatus({ amount_cents: 100, outstanding_cents: 40 }), 'partial');
  assert.equal(invoiceStatus({ amount_cents: 100, outstanding_cents: 0 }), 'paid');
  assert.equal(invoiceStatus({ amount_cents: 100, outstanding_cents: 0, voided: true }), 'void');
});

test('attendance rate excludes excused days', () => {
  assert.equal(attendanceRate({ present: 8, late: 1, absent: 1, excused: 5 }), 90);
  assert.equal(attendanceRate({ present: 0, late: 0, absent: 0, excused: 3 }), null);
});

test('CSV export neutralises formula injection and escapes quotes', () => {
  const out = toCsv([{ a: '=SUM(1)', b: 'He said "hi", ok' }], ['a', 'b']);
  assert.equal(out, `a,b\n'=SUM(1),"He said ""hi"", ok"`);
});

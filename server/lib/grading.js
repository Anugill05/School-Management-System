// Pure grading logic (unit tested). No I/O.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** bands: [{min_percent, grade, remark, gpa}] in any order. Returns the highest band whose min <= percent. */
export function gradeFor(percent, bands) {
  const sorted = [...bands].sort((a, b) => b.min_percent - a.min_percent);
  return sorted.find((b) => percent + 1e-9 >= b.min_percent) ?? sorted[sorted.length - 1] ?? null;
}

/**
 * subjects: [{subject_id, name, max_marks, pass_marks, marks_obtained|null, is_absent}]
 * rule: {pass_percent, bands}
 * - absent => scores 0 and fails that subject
 * - missing marks (not absent) => result INCOMPLETE
 * - overall PASS requires every subject >= pass_marks AND overall percent >= rule.pass_percent
 */
export function computeResult(subjects, rule) {
  let totalObtained = 0;
  let totalMax = 0;
  let pending = 0;
  let failedSubjects = 0;
  let gpaSum = 0;
  let gpaCount = 0;

  const rows = subjects.map((s) => {
    totalMax += s.max_marks;
    const absent = !!s.is_absent;
    const entered = absent || (s.marks_obtained !== null && s.marks_obtained !== undefined);
    if (!entered) {
      pending++;
      return { ...s, obtained: null, percent: null, grade: null, remark: null, passed: null, status: 'pending' };
    }
    const obtained = absent ? 0 : s.marks_obtained;
    totalObtained += obtained;
    const percent = round2((obtained / s.max_marks) * 100);
    const band = gradeFor(percent, rule.bands);
    const passed = !absent && obtained + 1e-9 >= s.pass_marks;
    if (!passed) failedSubjects++;
    if (band) { gpaSum += band.gpa; gpaCount++; }
    return { ...s, obtained, percent, grade: band?.grade ?? null, remark: band?.remark ?? null, passed, status: absent ? 'absent' : 'scored' };
  });

  const complete = pending === 0 && rows.length > 0;
  const percent = totalMax > 0 && complete ? round2((totalObtained / totalMax) * 100) : null;
  const band = percent === null ? null : gradeFor(percent, rule.bands);
  let result = 'INCOMPLETE';
  if (complete) result = failedSubjects === 0 && percent >= rule.pass_percent ? 'PASS' : 'FAIL';

  return {
    subjects: rows,
    total_obtained: round2(totalObtained),
    total_max: round2(totalMax),
    percent,
    grade: band?.grade ?? null,
    remark: band?.remark ?? null,
    gpa: gpaCount ? round2(gpaSum / gpaCount) : null,
    failed_subjects: failedSubjects,
    pending_subjects: pending,
    result,
  };
}

/** Standard competition ranking (1,2,2,4) on percent, only for complete results. */
export function assignRanks(items) {
  const ranked = items.filter((i) => i.percent !== null).sort((a, b) => b.percent - a.percent);
  let rank = 0;
  let prev = null;
  ranked.forEach((item, idx) => {
    if (item.percent !== prev) { rank = idx + 1; prev = item.percent; }
    item.rank = rank;
  });
  items.filter((i) => i.percent === null).forEach((i) => { i.rank = null; });
  return items;
}

/** Validates a set of grade bands; throws Error(message) when invalid. */
export function validateBands(bands) {
  if (!bands.length) throw new Error('At least one grade band is required');
  if (!bands.some((b) => b.min_percent === 0)) throw new Error('A band with minimum 0% is required so every score maps to a grade');
  const mins = new Set();
  const grades = new Set();
  for (const b of bands) {
    if (mins.has(b.min_percent)) throw new Error(`Duplicate minimum percent ${b.min_percent}`);
    if (grades.has(b.grade.toUpperCase())) throw new Error(`Duplicate grade ${b.grade}`);
    mins.add(b.min_percent);
    grades.add(b.grade.toUpperCase());
  }
}

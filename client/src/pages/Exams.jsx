import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpenCheck, Plus, Printer, Save, Send, Trash2, Undo2, Unlock } from 'lucide-react';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.js';
import { Async, Badge, Button, Card, Empty, FormError, Modal, SelectField, Tabs, TextField, statusTone, useAsync, useConfirm, useForm, useToast } from '../ui.jsx';

function ExamForm({ onClose, onSaved }) {
  const toast = useToast();
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const rules = useAsync(() => api.get('/grading-rules').then((r) => r.data), []);
  const subjects = useAsync(() => api.get('/subjects').then((r) => r.data), []);
  const f = useForm({ name: '', term: 'Term 1', class_id: '', grading_rule_id: '', start_date: '', picked: {} });
  useEffect(() => { if (classes.data && !f.values.class_id) f.setValues((v) => ({ ...v, class_id: classes.data[0]?.id ?? '' })); }, [classes.data]); // eslint-disable-line
  useEffect(() => { if (rules.data && !f.values.grading_rule_id) f.setValues((v) => ({ ...v, grading_rule_id: (rules.data.find((r) => r.is_default) ?? rules.data[0])?.id ?? '' })); }, [rules.data]); // eslint-disable-line
  const toggle = (s) => f.setValues((v) => { const p = { ...v.picked }; if (p[s.id]) delete p[s.id]; else p[s.id] = { max_marks: 100, pass_marks: 35 }; return { ...v, picked: p }; });
  const setP = (id, k, val) => f.setValues((v) => ({ ...v, picked: { ...v.picked, [id]: { ...v.picked[id], [k]: val } } }));
  const save = () => f.submit(async (v) => {
    const body = { name: v.name, term: v.term, class_id: Number(v.class_id), grading_rule_id: Number(v.grading_rule_id), start_date: v.start_date || null,
      subjects: Object.entries(v.picked).map(([id, p]) => ({ subject_id: Number(id), max_marks: Number(p.max_marks), pass_marks: Number(p.pass_marks) })) };
    const r = await api.post('/exams', body); toast('Exam created as draft'); onSaved(r.data);
  });
  return (
    <Modal wide title="Create exam" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={save}>Create exam</Button></>}>
      <div className="form-grid">
        <div className="span2"><FormError message={f.formError || f.errors.subjects} /></div>
        <TextField label="Exam name" placeholder="Final Examination" value={f.values.name} onChange={f.set('name')} error={f.errors.name} required />
        <TextField label="Term" value={f.values.term} onChange={f.set('term')} error={f.errors.term} />
        <SelectField label="Class" value={f.values.class_id} onChange={f.set('class_id')} required>{(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.academic_year})</option>)}</SelectField>
        <SelectField label="Grading rule" value={f.values.grading_rule_id} onChange={f.set('grading_rule_id')} required>{(rules.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>
        <TextField label="Start date" type="date" value={f.values.start_date} onChange={f.set('start_date')} error={f.errors.start_date} />
        <div className="span2 stack">
          <div className="label">Subjects, maximum and pass marks</div>
          {(subjects.data ?? []).map((s) => { const p = f.values.picked[s.id]; return (
            <div key={s.id} className="row" style={{ alignItems: 'center' }}>
              <label className="row" style={{ width: 190 }}><input type="checkbox" checked={!!p} onChange={() => toggle(s)} /> {s.name}</label>
              {p && <><TextField aria-label={`${s.name} max marks`} label="" type="number" min="1" value={p.max_marks} onChange={(e) => setP(s.id, 'max_marks', e.target.value)} style={{ width: 100 }} /><span className="muted small">max</span>
                <TextField aria-label={`${s.name} pass marks`} label="" type="number" min="0" value={p.pass_marks} onChange={(e) => setP(s.id, 'pass_marks', e.target.value)} style={{ width: 100 }} /><span className="muted small">pass</span></>}
            </div>); })}
        </div>
      </div>
    </Modal>
  );
}

export default function Exams() {
  const { user } = useAuth();
  const nav = useNavigate();
  const exams = useAsync(() => api.get('/exams').then((r) => r.data), []);
  const [create, setCreate] = useState(false);
  const students = useAsync(() => (user.role === 'guardian' ? api.get('/students').then((r) => r.data) : Promise.resolve([])), []);
  return (
    <>
      <div className="page-head"><div><h1>{user.role === 'guardian' ? 'Report cards' : 'Exams & results'}</h1><p>{user.role === 'guardian' ? 'Published results for your children.' : 'Create exams, enter marks, publish results.'}</p></div>
        {user.role === 'admin' && <Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>Create exam</Button>}</div>
      <Async state={exams} isEmpty={(d) => d.length === 0} empty={<Card><Empty title="No exams yet" icon={BookOpenCheck}>{user.role === 'guardian' ? 'Results will appear here once published.' : 'Create an exam to get started.'}</Empty></Card>}>
        {(d) => user.role === 'guardian' ? (
          <div className="grid g2">{d.map((e) => (
            <Card key={e.id} title={e.name} actions={<Badge tone="ok">{e.term}</Badge>}>
              {(students.data ?? []).filter((s) => s.class_id === e.class_id).map((s) => (
                <div key={s.id} className="row between" style={{ padding: '6px 0' }}><span>{s.first_name} {s.last_name}</span><Link className="btn sm primary" to={`/report-card/${s.id}/${e.id}`}>View report card</Link></div>))}
            </Card>))}</div>
        ) : (
          <Card pad={false}><div className="table-wrap"><table>
            <thead><tr><th>Exam</th><th>Class</th><th>Term</th><th className="num">Subjects</th><th>Status</th><th /></tr></thead>
            <tbody>{d.map((e) => (<tr key={e.id}><td><Link to={`/exams/${e.id}`}><b>{e.name}</b></Link></td><td>{e.class_name}</td><td>{e.term}</td><td className="num">{e.subject_count}</td><td><Badge tone={statusTone[e.status]}>{e.status}</Badge></td><td className="right"><Link className="btn sm" to={`/exams/${e.id}`}>Open</Link></td></tr>))}</tbody>
          </table></div></Card>
        )}
      </Async>
      {create && <ExamForm onClose={() => setCreate(false)} onSaved={(e) => { setCreate(false); nav(`/exams/${e.id}`); }} />}
    </>
  );
}

function MarksEntry({ exam, reload }) {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const assigns = useAsync(() => api.get('/assignments').then((r) => r.data), []);
  const sections = (classes.data ?? []).filter((c) => c.id === exam.class_id).flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name} - ${s.name}` })));
  const section = params.get('section') ?? ''; const subject = params.get('subject') ?? '';
  const allowed = exam.subjects.filter((s) => user.role === 'admin' || (assigns.data ?? []).some((a) => String(a.section_id) === section && a.subject_id === s.subject_id));
  useEffect(() => { const next = new URLSearchParams(params); let ch = false; if (!section && sections[0]) { next.set('section', String(sections[0].id)); ch = true; } if ((!subject || !allowed.some((s) => String(s.subject_id) === subject)) && allowed[0] && (section || next.get('section'))) { next.set('subject', String(allowed[0].subject_id)); ch = true; } if (ch) setParams(next, { replace: true }); }, [sections.length, allowed.length, section]); // eslint-disable-line
  const sheet = useAsync(() => (section && subject && allowed.some((s) => String(s.subject_id) === subject) ? api.get(`/exams/${exam.id}/marks?section_id=${section}&subject_id=${subject}`) : Promise.resolve(null)), [exam.id, section, subject, allowed.length, exam.status]);
  const [draft, setDraft] = useState({}); const [saving, setSaving] = useState(false); const [errs, setErrs] = useState({});
  useEffect(() => { setDraft({}); setErrs({}); }, [section, subject]);
  const rows = sheet.data?.data ?? []; const meta = sheet.data?.meta;
  const val = (r) => draft[r.student_id] ?? { marks: r.marks_obtained ?? '', absent: !!r.is_absent };
  const edit = (r, patch) => { const c = val(r); const n = { ...c, ...patch }; setDraft((d) => ({ ...d, [r.student_id]: n })); setErrs((e) => { const x = { ...e }; delete x[r.student_id]; return x; }); };
  const save = async () => {
    const entries = []; const e2 = {};
    for (const r of rows) { const v = draft[r.student_id]; if (!v) continue; const m = v.marks === '' ? null : Number(v.marks);
      if (!v.absent && m !== null && (Number.isNaN(m) || m < 0 || m > meta.max_marks)) { e2[r.student_id] = `0 - ${meta.max_marks}`; continue; }
      entries.push({ student_id: r.student_id, marks_obtained: v.absent ? null : m, is_absent: v.absent }); }
    setErrs(e2); if (Object.keys(e2).length) return toast('Fix the highlighted marks first', 'error');
    setSaving(true);
    try { await api.put(`/exams/${exam.id}/marks`, { section_id: Number(section), subject_id: Number(subject), entries }); toast(`Marks saved for ${entries.length} students`); setDraft({}); sheet.reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const dirty = Object.keys(draft).length;
  const entered = rows.filter((r) => { const v = val(r); return v.absent || v.marks !== ''; }).length;
  return (
    <Card pad={false}>
      <div className="toolbar">
        <select className="select" aria-label="Section" value={section} onChange={(e) => { const n = new URLSearchParams(params); n.set('section', e.target.value); n.delete('subject'); setParams(n); }}>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className="select" aria-label="Subject" value={subject} onChange={(e) => { const n = new URLSearchParams(params); n.set('subject', e.target.value); setParams(n); }}>{allowed.map((s) => <option key={s.subject_id} value={s.subject_id}>{s.name} (max {s.max_marks})</option>)}</select>
        <span style={{ flex: 1 }} />
        {meta && <Badge tone={entered === rows.length ? 'ok' : 'warn'}>{entered}/{rows.length} entered</Badge>}
        <Button variant="primary" icon={Save} loading={saving} disabled={!dirty || !meta?.editable} onClick={save}>Save marks{dirty ? ` (${dirty})` : ''}</Button>
      </div>
      {exam.status !== 'open' && <div className="card-pad"><div className="alert info">Marks can only be entered while the exam is <b>open</b>. Current status: {exam.status}.</div></div>}
      {!allowed.length && !assigns.loading ? <Empty title="You do not teach any subject of this exam in this section" /> : (
        <Async state={sheet} isEmpty={(r) => !r || r.data.length === 0} empty={<Empty title="Pick a section and subject" />}>
          {() => <div className="table-wrap"><table>
            <thead><tr><th>Student</th><th>Admission no.</th><th style={{ width: 170 }}>Marks (max {meta.max_marks})</th><th>Absent</th></tr></thead>
            <tbody>{rows.map((r) => { const v = val(r); const bad = errs[r.student_id]; return (
              <tr key={r.student_id}><td><b>{r.first_name} {r.last_name}</b></td><td className="mono muted">{r.admission_no}</td>
                <td><input className="input" type="number" inputMode="decimal" min="0" max={meta.max_marks} step="0.5" aria-label={`Marks for ${r.first_name} ${r.last_name}`} aria-invalid={!!bad} disabled={v.absent || !meta.editable} value={v.absent ? '' : v.marks} onChange={(e) => edit(r, { marks: e.target.value })} style={{ width: 110 }} />
                  {bad && <span className="err small" role="alert"> {bad}</span>}
                  {!v.absent && v.marks !== '' && !bad && Number(v.marks) < meta.pass_marks && <span className="small" style={{ color: 'var(--bad)' }}> below pass</span>}</td>
                <td><label className="row"><input type="checkbox" disabled={!meta.editable} checked={v.absent} onChange={(e) => edit(r, { absent: e.target.checked, marks: '' })} /> Absent</label></td></tr>); })}</tbody>
          </table></div>}
        </Async>)}
    </Card>
  );
}

function Results({ exam }) {
  const { user } = useAuth();
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const sections = (classes.data ?? []).filter((c) => c.id === exam.class_id).flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name} - ${s.name}` })));
  const [section, setSection] = useState('');
  useEffect(() => { if (!section && sections[0]) setSection(String(sections[0].id)); }, [sections.length]); // eslint-disable-line
  const res = useAsync(() => (section ? api.get(`/exams/${exam.id}/results?section_id=${section}`) : Promise.resolve(null)), [exam.id, section, exam.status]);
  return (
    <Card pad={false}>
      <div className="toolbar"><select className="select" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
      <Async state={res} isEmpty={(r) => !r || r.data.length === 0} empty={<Empty title="No students" />}>
        {(r) => <div className="table-wrap"><table>
          <thead><tr><th>Rank</th><th>Student</th>{exam.subjects.map((s) => <th key={s.subject_id} className="num">{s.code}<br /><span style={{ textTransform: 'none', fontWeight: 400 }}>/{s.max_marks}</span></th>)}<th className="num">Total</th><th className="num">%</th><th>Grade</th><th>Result</th><th /></tr></thead>
          <tbody>{r.data.map((x) => (
            <tr key={x.id}><td className="mono">{x.rank ?? '-'}</td><td><b>{x.first_name} {x.last_name}</b></td>
              {x.subjects.map((s) => <td key={s.subject_id} className="num" style={{ color: s.passed === false ? 'var(--bad)' : undefined }}>{s.status === 'pending' ? <span className="muted">-</span> : s.status === 'absent' ? 'AB' : s.obtained}</td>)}
              <td className="num">{x.total_obtained}/{x.total_max}</td><td className="num">{x.percent ?? '-'}</td><td>{x.grade ? <Badge tone="primary">{x.grade}</Badge> : '-'}</td><td><Badge tone={statusTone[x.result]}>{x.result}</Badge></td>
              <td className="right">{(user.role === 'admin' || exam.status !== 'draft') && <Link className="btn sm" to={`/report-card/${x.id}/${exam.id}`}>Report card</Link>}</td></tr>))}</tbody>
        </table></div>}
      </Async>
    </Card>
  );
}

export function ExamDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [confirm, dialog] = useConfirm();
  const [tab, setTab] = useState('marks');
  const s = useAsync(() => api.get(`/exams/${id}`).then((r) => r.data), [id]);
  const move = async (status, force) => {
    try { await api.post(`/exams/${id}/status`, { status, force }); toast(`Exam is now ${status}`); s.reload(); }
    catch (e) {
      if (e.code === 'MARKS_INCOMPLETE' && await confirm({ title: 'Publish with missing marks?', message: `${e.details?.missing} mark entries are still missing. Those students will show an incomplete result.`, confirmLabel: 'Publish anyway', danger: true })) return move(status, true);
      if (e.code !== 'MARKS_INCOMPLETE') toast(e.message, 'error');
    }
  };
  const del = async () => { if (await confirm({ title: 'Delete this draft exam?', message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' })) { try { await api.del(`/exams/${id}`); toast('Exam deleted'); nav('/exams'); } catch (e) { toast(e.message, 'error'); } } };
  return (
    <>
      <Link to="/exams" className="row small" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> All exams</Link>
      <Async state={s}>{(e) => (
        <div className="stack">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div><h1>{e.name} <Badge tone={statusTone[e.status]}>{e.status}</Badge></h1><p>{e.class_name} - {e.term} - Grading: {e.rule_name} (pass {e.rule.pass_percent}%)</p></div>
            {user.role === 'admin' && <div className="actions">
              {e.status === 'draft' && <><Button variant="danger" icon={Trash2} onClick={del}>Delete</Button><Button variant="primary" icon={Unlock} onClick={() => move('open')}>Open for marks entry</Button></>}
              {e.status === 'open' && <><Button icon={Undo2} onClick={() => move('draft')}>Back to draft</Button><Button variant="primary" icon={Send} onClick={() => move('published')}>Publish results</Button></>}
              {e.status === 'published' && <Button icon={Undo2} onClick={() => move('open')}>Re-open</Button>}
            </div>}
          </div>
          <Card title="Subjects" pad={false}><div className="table-wrap"><table><thead><tr><th>Subject</th><th className="num">Max marks</th><th className="num">Pass marks</th></tr></thead><tbody>{e.subjects.map((s) => <tr key={s.subject_id}><td>{s.name} <span className="muted">({s.code})</span></td><td className="num">{s.max_marks}</td><td className="num">{s.pass_marks}</td></tr>)}</tbody></table></div></Card>
          <Tabs value={tab} onChange={setTab} tabs={[['marks', 'Enter marks'], ['results', 'Results & ranks']]} />
          {tab === 'marks' ? <MarksEntry exam={e} reload={s.reload} /> : <Results exam={e} />}
        </div>)}
      </Async>
      {dialog}
    </>
  );
}

export function ReportCard() {
  const { studentId, examId } = useParams();
  const s = useAsync(() => api.get(`/report-cards/${studentId}/${examId}`).then((r) => r.data), [studentId, examId]);
  return (
    <>
      <div className="row between no-print" style={{ marginBottom: 12 }}><Link to={`/students/${studentId}`} className="row small"><ArrowLeft size={14} /> Back</Link><Button icon={Printer} onClick={() => window.print()}>Print / save as PDF</Button></div>
      <Async state={s}>{(c) => (
        <article className="report-card" aria-label="Report card">
          <div className="rc-head"><div><h1>Greenfield School</h1><div>Report Card - {c.exam.name} ({c.exam.term})</div></div><div style={{ textAlign: 'right' }}><div><b>{c.exam.class_name}</b></div><div>{c.exam.academic_year}</div></div></div>
          {c.exam.status !== 'published' && <div className="alert warn" style={{ marginBottom: 12 }}>Preview: results are not published yet.</div>}
          <div className="rc-meta"><div><span>Student</span>{c.student.name}</div><div><span>Admission no.</span>{c.student.admission_no}</div><div><span>Section</span>{c.student.section}</div><div><span>Date of birth</span>{fmtDate(c.student.dob)}</div><div><span>Attendance</span>{c.attendance_percent ?? '-'}%</div><div><span>Class rank</span>{c.rank ? `${c.rank} of ${c.class_size}` : '-'}</div></div>
          <table><thead><tr><th>Subject</th><th className="num">Max</th><th className="num">Obtained</th><th className="num">%</th><th>Grade</th><th>Remark</th></tr></thead>
            <tbody>{c.subjects.map((s) => (<tr key={s.subject_id}><td>{s.name}</td><td className="num">{s.max_marks}</td><td className="num">{s.status === 'pending' ? '-' : s.status === 'absent' ? 'Absent' : s.obtained}</td><td className="num">{s.percent ?? '-'}</td><td>{s.grade ?? '-'}</td><td>{s.status === 'pending' ? 'Pending' : s.passed ? s.remark : <span className="rc-fail">Below pass mark</span>}</td></tr>))}</tbody></table>
          <div className="rc-total"><div><span className="muted small">Total</span><div><b>{c.total_obtained} / {c.total_max}</b></div></div><div><span className="muted small">Percentage</span><div><b>{c.percent ?? '-'}%</b></div></div><div><span className="muted small">Grade</span><div><b>{c.grade ?? '-'}</b> {c.remark && `(${c.remark})`}</div></div><div><span className="muted small">Result</span><div className={c.result === 'PASS' ? 'rc-pass' : c.result === 'FAIL' ? 'rc-fail' : ''}>{c.result}</div></div></div>
          <p style={{ fontSize: '.78rem', color: '#666', marginTop: 14 }}>Grading: {c.exam.rule_name}. Overall pass mark {c.pass_percent}% and every subject must reach its pass mark. Bands: {c.bands.map((b) => `${b.grade} ≥ ${b.min_percent}%`).join(', ')}. Generated {new Date(c.generated_at).toLocaleString()}.</p>
        </article>)}
      </Async>
    </>
  );
}

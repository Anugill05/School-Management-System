import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, money, qs, todayISO } from '../api.js';
import { useAuth } from '../auth.js';
import { Async, Badge, Button, Card, Empty, Stat, Tabs, statusTone, useAsync } from '../ui.jsx';

const csvUrl = (path, params) => `/api${path}${qs({ ...params, format: 'csv' })}`;
const rateTone = (r) => (r === null ? '' : r >= 92 ? 'ok' : r >= 80 ? 'warn' : 'bad');

function AttendanceReport() {
  const [from, setFrom] = useState(`${todayISO().slice(0, 8)}01`); const [to, setTo] = useState(todayISO()); const [threshold, setThreshold] = useState('');
  const p = { from, to, threshold };
  const r = useAsync(() => api.get(`/reports/attendance${qs(p)}`).then((x) => x.data), [from, to, threshold]);
  return (
    <Card pad={false}>
      <div className="toolbar">
        <label className="row small">From <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label>
        <label className="row small">To <input className="input" type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></label>
        <select className="select" aria-label="Attendance threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)}><option value="">All students</option><option value="90">Below 90%</option><option value="80">Below 80% (at risk)</option><option value="75">Below 75%</option></select>
        <span style={{ flex: 1 }} /><a className="btn" href={csvUrl('/reports/attendance', p)}><Download size={16} /> CSV</a>
      </div>
      <Async state={r} isEmpty={(d) => d.length === 0} empty={<Empty title="No students match" />}>
        {(d) => <div className="table-wrap"><table><thead><tr><th>Student</th><th>Section</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">Excused</th><th className="num">Rate</th></tr></thead>
          <tbody>{d.map((x) => <tr key={x.student_id}><td><b>{x.student}</b><div className="muted small mono">{x.admission_no}</div></td><td>{x.section}</td><td className="num">{x.present}</td><td className="num">{x.late}</td><td className="num">{x.absent}</td><td className="num">{x.excused}</td><td className="num">{x.rate === null ? '-' : <Badge tone={rateTone(x.rate)}>{x.rate}%</Badge>}</td></tr>)}</tbody></table></div>}
      </Async>
    </Card>
  );
}

function AcademicReport() {
  const exams = useAsync(() => api.get('/exams').then((r) => r.data.filter((e) => e.status !== 'draft')), []);
  const [exam, setExam] = useState('');
  useEffect(() => { if (!exam && exams.data?.[0]) setExam(String(exams.data[0].id)); }, [exams.data]); // eslint-disable-line
  const r = useAsync(() => (exam ? api.get(`/reports/academic${qs({ exam_id: exam })}`).then((x) => x.data) : Promise.resolve(null)), [exam]);
  return (
    <div className="stack">
      <Card pad={false}><div className="toolbar"><select className="select" aria-label="Exam" value={exam} onChange={(e) => setExam(e.target.value)}>{(exams.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} - {e.class_name} ({e.status})</option>)}</select><span style={{ flex: 1 }} />{exam && <a className="btn" href={csvUrl('/reports/academic', { exam_id: exam })}><Download size={16} /> CSV</a>}</div></Card>
      {exams.data?.length === 0 && <Card><Empty title="No open or published exams yet" /></Card>}
      <Async state={r}>{(d) => d && (<>
        <div className="grid g4"><Stat label="Students" value={d.summary.students} sub={`${d.summary.complete} with complete results`} /><Stat label="Pass rate" value={d.summary.pass_rate === null ? '-' : `${d.summary.pass_rate}%`} tone="ok" /><Stat label="Average" value={d.summary.average_percent === null ? '-' : `${d.summary.average_percent}%`} />
          <div className="card stat"><div className="k">Grade distribution</div><div className="row">{Object.entries(d.summary.grade_distribution).map(([g, n]) => <Badge key={g} tone="primary">{g}: {n}</Badge>)}{Object.keys(d.summary.grade_distribution).length === 0 && <span className="muted">-</span>}</div></div></div>
        <div className="grid g2">
          <Card title="Subject performance" pad={false}><div className="table-wrap"><table><thead><tr><th>Subject</th><th className="num">Avg %</th><th className="num">High</th><th className="num">Low</th><th className="num">Pass rate</th></tr></thead>
            <tbody>{d.per_subject.map((s) => <tr key={s.subject_id}><td>{s.subject}<div className="muted small">{s.entered} entered</div></td><td className="num">{s.average ?? '-'}</td><td className="num">{s.highest ?? '-'}</td><td className="num">{s.lowest ?? '-'}</td><td className="num">{s.pass_rate === null ? '-' : `${s.pass_rate}%`}</td></tr>)}</tbody></table></div></Card>
          <Card title="Top performers" pad={false}>{d.toppers.length === 0 ? <Empty title="No complete results yet" /> : <div className="table-wrap"><table><tbody>{d.toppers.map((t) => <tr key={t.name}><td className="mono">#{t.rank}</td><td><b>{t.name}</b><div className="muted small">{t.section}</div></td><td className="num">{t.percent}%</td><td><Badge tone="primary">{t.grade}</Badge></td></tr>)}</tbody></table></div>}</Card>
        </div></>)}</Async>
    </div>
  );
}

function FeeReport() {
  const [status, setStatus] = useState('');
  const r = useAsync(() => api.get(`/reports/fees${qs({ status })}`).then((x) => x.data), [status]);
  const tot = (r.data ?? []).reduce((a, x) => ({ i: a.i + x.invoiced, p: a.p + x.paid, o: a.o + x.outstanding }), { i: 0, p: 0, o: 0 });
  return (
    <Card pad={false}>
      <div className="toolbar"><select className="select" aria-label="Invoice status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All non-void invoices</option><option value="issued">Unpaid only</option><option value="partial">Partially paid</option><option value="paid">Fully paid</option></select><span style={{ flex: 1 }} /><a className="btn" href={csvUrl('/reports/fees', { status })}><Download size={16} /> CSV</a></div>
      <Async state={r} isEmpty={(d) => d.length === 0} empty={<Empty title="No fee data" />}>
        {(d) => <div className="table-wrap"><table><thead><tr><th>Student</th><th>Section</th><th className="num">Invoices</th><th className="num">Invoiced</th><th className="num">Paid</th><th className="num">Outstanding</th></tr></thead>
          <tbody>{d.map((x) => <tr key={x.admission_no}><td><b>{x.student}</b><div className="muted small mono">{x.admission_no}</div></td><td>{x.section}</td><td className="num">{x.invoices}</td><td className="num">{money(x.invoiced)}</td><td className="num" style={{ color: 'var(--ok)' }}>{money(x.paid)}</td><td className="num"><b style={{ color: x.outstanding > 0 ? 'var(--bad)' : undefined }}>{money(x.outstanding)}</b> {x.overdue && <Badge tone="bad">overdue</Badge>}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}><b>Total ({d.length} students)</b></td><td className="num"><b>{money(tot.i)}</b></td><td className="num"><b>{money(tot.p)}</b></td><td className="num"><b>{money(tot.o)}</b></td></tr></tfoot></table></div>}
      </Async>
    </Card>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const [tab, setTab] = useState('attendance');
  const tabs = [['attendance', 'Attendance'], ['academic', 'Academic'], ...(user.role === 'admin' ? [['fees', 'Fees']] : [])];
  return (
    <>
      <div className="page-head"><div><h1>Reports</h1><p>{user.role === 'teacher' ? 'Reports cover your assigned classes only.' : 'Attendance, academic and fee reports. Export any table to CSV.'}</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'attendance' && <AttendanceReport />}{tab === 'academic' && <AcademicReport />}{tab === 'fees' && <FeeReport />}
    </>
  );
}

void statusTone; void Button;

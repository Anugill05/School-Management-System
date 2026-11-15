import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCheck, Save } from 'lucide-react';
import { api, qs, todayISO } from '../api.js';
import { Async, Badge, Button, Card, Empty, Tabs, useAsync, useToast } from '../ui.jsx';
import { sectionOptions } from './Students.jsx';

const STATUSES = [['present', 'Present'], ['late', 'Late'], ['absent', 'Absent'], ['excused', 'Excused']];

function Mark({ section, date, session }) {
  const toast = useToast();
  const roster = useAsync(() => api.get(`/attendance/roster${qs({ section_id: section, date, session })}`), [section, date, session]);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  useEffect(() => { setDraft({}); setSaved(null); }, [section, date, session]);

  const rows = roster.data?.data ?? [];
  const current = (r) => draft[r.student_id] ?? r.status ?? null;
  const dirty = Object.keys(draft).length;
  const counts = useMemo(() => { const c = { present: 0, late: 0, absent: 0, excused: 0, none: 0 }; rows.forEach((r) => { c[current(r) ?? 'none']++; }); return c; }, [rows, draft]); // eslint-disable-line
  const markAll = (status) => setDraft(Object.fromEntries(rows.map((r) => [r.student_id, status])));

  const save = async () => {
    const records = rows.filter((r) => current(r)).map((r) => ({ student_id: r.student_id, status: current(r) }));
    if (!records.length) return toast('Mark at least one student first', 'error');
    setSaving(true);
    try {
      const res = await api.put('/attendance', { section_id: Number(section), date, session, records });
      const { created, updated } = res.data;
      toast(`Attendance saved - ${created} new, ${updated} updated`); setSaved(res.data); setDraft({}); roster.reload();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const unmarked = counts.none;

  return (
    <Card pad={false}>
      <Async state={roster} isEmpty={(r) => r.data.length === 0} empty={<Empty title="No active students in this section" />}>
        {() => (<>
          <div className="toolbar">
            <div className="row" aria-live="polite">
              <Badge tone="ok">{counts.present} present</Badge><Badge tone="warn">{counts.late} late</Badge><Badge tone="bad">{counts.absent} absent</Badge><Badge tone="info">{counts.excused} excused</Badge>
              {unmarked > 0 && <Badge>{unmarked} unmarked</Badge>}
            </div>
            <span style={{ flex: 1 }} />
            <Button size="sm" icon={CheckCheck} onClick={() => markAll('present')}>Mark all present</Button>
            <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save}>Save{dirty ? ` (${dirty})` : ''}</Button>
          </div>
          {saved && !dirty && <div className="card-pad"><div className="alert ok">Saved. Re-saving the same session simply updates the existing records - duplicates are impossible.</div></div>}
          <div className="table-wrap"><table>
            <thead><tr><th>Student</th><th>Admission no.</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.student_id}>
                <td><b>{r.first_name} {r.last_name}</b></td><td className="mono muted">{r.admission_no}</td>
                <td><div className="seg" role="group" aria-label={`Attendance for ${r.first_name} ${r.last_name}`}>
                  {STATUSES.map(([k, label]) => <button key={k} className={k} aria-pressed={current(r) === k} onClick={() => setDraft((d) => ({ ...d, [r.student_id]: k }))}>{label}</button>)}</div></td>
              </tr>))}</tbody>
          </table></div>
        </>)}
      </Async>
    </Card>
  );
}

function Summary({ section }) {
  const first = `${todayISO().slice(0, 8)}01`;
  const [from, setFrom] = useState(first); const [to, setTo] = useState(todayISO());
  const s = useAsync(() => api.get(`/attendance/summary${qs({ section_id: section, from, to })}`), [section, from, to]);
  return (
    <Card pad={false}>
      <div className="toolbar"><label className="row small">From <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label>
        <label className="row small">To <input className="input" type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></label>
        <span style={{ flex: 1 }} />{s.data && <Badge tone="primary">Class rate {s.data.meta.totals.rate ?? '-'}%</Badge>}</div>
      <Async state={s} isEmpty={(r) => r.data.length === 0} empty={<Empty title="No students" />}>
        {(r) => <div className="table-wrap"><table>
          <thead><tr><th>Student</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">Excused</th><th style={{ minWidth: 160 }}>Rate</th></tr></thead>
          <tbody>{r.data.map((x) => (
            <tr key={x.student_id}><td><b>{x.first_name} {x.last_name}</b></td><td className="num">{x.present}</td><td className="num">{x.late}</td><td className="num">{x.absent}</td><td className="num">{x.excused}</td>
              <td>{x.rate === null ? <span className="muted">-</span> : <div className="row" style={{ flexWrap: 'nowrap' }}><div className={`bar ${x.rate >= 92 ? 'ok' : x.rate >= 80 ? 'warn' : 'bad'}`} style={{ flex: 1 }}><i style={{ width: `${x.rate}%` }} /></div><b className="mono small">{x.rate}%</b></div>}</td></tr>))}</tbody>
        </table></div>}
      </Async>
    </Card>
  );
}

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const sections = sectionOptions(classes.data ?? []);
  const section = params.get('section') ?? '';
  const [date, setDate] = useState(todayISO()); const [session, setSession] = useState('morning'); const [tab, setTab] = useState('mark');
  useEffect(() => { if (!section && sections.length) setParams({ section: String(sections[0].id) }, { replace: true }); }, [section, sections.length]); // eslint-disable-line

  return (
    <>
      <div className="page-head"><div><h1>Attendance</h1><p>Record daily attendance per class and session, and review summaries.</p></div></div>
      <div className="card card-pad row" style={{ marginBottom: 16 }}>
        <label className="field" style={{ minWidth: 200 }}><span className="label">Class & section</span>
          <select className="select" value={section} onChange={(e) => setParams({ section: e.target.value })}>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        {tab === 'mark' && <>
          <label className="field"><span className="label">Date</span><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <div className="field"><span className="label">Session</span><div className="seg" role="group" aria-label="Session">{['morning', 'afternoon'].map((s) => <button key={s} aria-pressed={session === s} className="present" onClick={() => setSession(s)} style={{ textTransform: 'capitalize' }}>{s}</button>)}</div></div></>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['mark', 'Mark attendance'], ['summary', 'Class summary']]} />
      {classes.loading ? null : sections.length === 0 ? <Card><Empty title="No classes assigned to you">Ask an administrator to assign you to a class.</Empty></Card>
        : section && (tab === 'mark' ? <Mark section={section} date={date} session={session} /> : <Summary section={section} />)}
    </>
  );
}

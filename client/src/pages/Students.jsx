import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, GraduationCap, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { api, fmtDate, money, qs } from '../api.js';
import { useAuth } from '../auth.js';
import { Async, Badge, Button, Card, Empty, FormError, Modal, Pager, SearchBox, SelectField, TextField, statusTone, useAsync, useConfirm, useDebounced, useForm, useToast } from '../ui.jsx';

export const sectionOptions = (classes) => classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name} - ${s.name}`, class_id: c.id })));

function StudentForm({ student, classes, onClose, onSaved }) {
  const toast = useToast();
  const sections = sectionOptions(classes);
  const guardians = useAsync(() => api.get('/guardians?pageSize=100').then((r) => r.data), []);
  const f = useForm({
    admission_no: student?.admission_no ?? '', first_name: student?.first_name ?? '', last_name: student?.last_name ?? '', dob: student?.dob ?? '',
    gender: student?.gender ?? 'female', section_id: student?.section_id ?? sections[0]?.id ?? '', status: student?.status ?? 'active', guardian_id: '', relation: 'parent',
  });
  const save = () => f.submit(async (v) => {
    const body = { admission_no: v.admission_no, first_name: v.first_name, last_name: v.last_name, dob: v.dob, gender: v.gender, section_id: Number(v.section_id), status: v.status };
    if (!student && v.guardian_id) body.guardians = [{ guardian_id: Number(v.guardian_id), relation: v.relation }];
    const r = student ? await api.patch(`/students/${student.id}`, body) : await api.post('/students', body);
    toast(student ? 'Student updated' : 'Student created'); onSaved(r.data);
  });
  return (
    <Modal wide title={student ? 'Edit student' : 'Add student'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={save}>{student ? 'Save changes' : 'Create student'}</Button></>}>
      <div className="form-grid">
        <div className="span2"><FormError message={f.formError} /></div>
        <TextField label="Admission no." value={f.values.admission_no} onChange={f.set('admission_no')} error={f.errors.admission_no} required />
        <SelectField label="Class & section" value={f.values.section_id} onChange={f.set('section_id')} error={f.errors.section_id} required>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</SelectField>
        <TextField label="First name" value={f.values.first_name} onChange={f.set('first_name')} error={f.errors.first_name} required />
        <TextField label="Last name" value={f.values.last_name} onChange={f.set('last_name')} error={f.errors.last_name} required />
        <TextField label="Date of birth" type="date" value={f.values.dob} onChange={f.set('dob')} error={f.errors.dob} required />
        <SelectField label="Gender" value={f.values.gender} onChange={f.set('gender')} error={f.errors.gender}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></SelectField>
        {student && <SelectField label="Status" value={f.values.status} onChange={f.set('status')}><option value="active">Active</option><option value="inactive">Inactive</option><option value="graduated">Graduated</option></SelectField>}
        {!student && (
          <>
            <SelectField label="Link guardian (optional)" value={f.values.guardian_id} onChange={f.set('guardian_id')}><option value="">- None -</option>{(guardians.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectField>
            <TextField label="Relation" value={f.values.relation} onChange={f.set('relation')} disabled={!f.values.guardian_id} />
          </>
        )}
      </div>
    </Modal>
  );
}

export default function Students() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [q, setQ] = useState(''); const [classId, setClassId] = useState(''); const [status, setStatus] = useState(isAdmin ? 'active' : '');
  const [page, setPage] = useState(1); const [sort, setSort] = useState('name'); const [edit, setEdit] = useState(null);
  const dq = useDebounced(q);
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const list = useAsync(() => api.get(`/students${qs({ q: dq, class_id: classId, status, page, sort, pageSize: 15 })}`), [dq, classId, status, page, sort]);
  const reset = (fn) => (v) => { fn(v); setPage(1); };
  const isGuardian = user.role === 'guardian';
  return (
    <>
      <div className="page-head">
        <div><h1>{isGuardian ? 'My children' : 'Students'}</h1><p>{isGuardian ? 'Profiles of the students linked to your account.' : 'Search, filter and manage student records.'}</p></div>
        {isAdmin && <Button variant="primary" icon={Plus} onClick={() => setEdit({})}>Add student</Button>}
      </div>
      <div className="card">
        {!isGuardian && (
          <div className="toolbar">
            <SearchBox value={q} onChange={reset(setQ)} placeholder="Search by name or admission no." />
            <select className="select" aria-label="Filter by class" value={classId} onChange={(e) => reset(setClassId)(e.target.value)}><option value="">All classes</option>{(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            {isAdmin && <select className="select" aria-label="Filter by status" value={status} onChange={(e) => reset(setStatus)(e.target.value)}><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="graduated">Graduated</option></select>}
            <select className="select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="name">Sort: name</option><option value="admission_no">Sort: admission no.</option><option value="class">Sort: class</option></select>
          </div>
        )}
        <Async state={list} isEmpty={(r) => r.data.length === 0} empty={<Empty title="No students found" icon={GraduationCap}>{q || classId ? 'Try clearing the search or filters.' : 'Nothing to show yet.'}</Empty>}>
          {(r) => (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>Student</th><th>Admission no.</th><th>Class</th><th>Gender</th><th>Status</th><th /></tr></thead>
                <tbody>{r.data.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/students/${s.id}`}><b>{s.first_name} {s.last_name}</b></Link></td><td className="mono">{s.admission_no}</td>
                    <td>{s.class_name} - {s.section_name}</td><td style={{ textTransform: 'capitalize' }}>{s.gender}</td><td><Badge tone={statusTone[s.status]}>{s.status}</Badge></td>
                    <td className="right">{isAdmin && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(s)} aria-label={`Edit ${s.first_name}`}>Edit</Button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager meta={r.meta} onPage={setPage} />
            </>
          )}
        </Async>
      </div>
      {edit && classes.data && <StudentForm student={edit.id ? edit : null} classes={classes.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

export function StudentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const s = useAsync(() => api.get(`/students/${id}`).then((r) => r.data), [id]);
  const att = useAsync(() => api.get(`/attendance/student/${id}`).then((r) => r.data), [id]);
  const cards = useAsync(() => api.get(`/report-cards/${id}`).then((r) => r.data), [id]);
  const ledger = useAsync(() => (user.role === 'teacher' ? Promise.resolve(null) : api.get(`/fees/students/${id}/ledger`).then((r) => r.data)), [id]);
  const allGuardians = useAsync(() => (user.role === 'admin' ? api.get('/guardians?pageSize=100').then((r) => r.data) : Promise.resolve([])), [id]);
  const [link, setLink] = useState({ guardian_id: '', relation: 'parent' });

  const addLink = async () => { try { await api.post(`/students/${id}/guardians`, { guardian_id: Number(link.guardian_id), relation: link.relation }); toast('Guardian linked'); setLink({ guardian_id: '', relation: 'parent' }); s.reload(); } catch (e) { toast(e.message, 'error'); } };
  const unlink = async (g) => { if (await confirm({ title: 'Unlink guardian?', message: `${g.name} will no longer see this student's records.`, danger: true, confirmLabel: 'Unlink' })) { try { await api.del(`/students/${id}/guardians/${g.id}`); toast('Guardian unlinked'); s.reload(); } catch (e) { toast(e.message, 'error'); } } };

  return (
    <>
      <Link to="/students" className="row small" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Back to students</Link>
      <Async state={s}>{(r) => { const st = r; return (
        <div className="stack">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div><h1>{st.first_name} {st.last_name}</h1><p>{st.admission_no} - {st.class_name} {st.section_name} - {st.academic_year}</p></div>
            <Badge tone={statusTone[st.status]}>{st.status}</Badge>
          </div>
          <div className="grid g2">
            <Card title="Profile"><dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px 12px' }}>
              <dt className="muted">Date of birth</dt><dd style={{ margin: 0 }}>{fmtDate(st.dob)}</dd><dt className="muted">Gender</dt><dd style={{ margin: 0, textTransform: 'capitalize' }}>{st.gender}</dd>
              <dt className="muted">Class</dt><dd style={{ margin: 0 }}>{st.class_name} - {st.section_name}</dd></dl></Card>
            <Card title="Guardians">
              {st.guardians.length === 0 ? <span className="muted">No guardian linked.</span> : st.guardians.map((g) => (
                <div key={g.id} className="row between" style={{ padding: '6px 0' }}><div><b>{g.name}</b> <Badge>{g.relation}</Badge><div className="muted small">{g.email}{g.phone ? ` - ${g.phone}` : ''}</div></div>
                  {user.role === 'admin' && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => unlink(g)} aria-label={`Unlink ${g.name}`} />}</div>
              ))}
              {user.role === 'admin' && (
                <div className="row" style={{ marginTop: 12 }}>
                  <select className="select" style={{ flex: 1, minWidth: 150 }} aria-label="Guardian to link" value={link.guardian_id} onChange={(e) => setLink({ ...link, guardian_id: e.target.value })}><option value="">Link a guardian...</option>{(allGuardians.data ?? []).filter((g) => !st.guardians.some((x) => x.id === g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                  <Button icon={UserPlus} disabled={!link.guardian_id} onClick={addLink}>Link</Button>
                </div>
              )}
            </Card>
          </div>
          <div className="grid g2">
            <Card title="Attendance" pad={false}>
              <Async state={att}>{(a) => (
                <div className="card-pad stack">
                  <div className="grid g4">{['present', 'late', 'absent', 'excused'].map((k) => <div key={k}><div className="muted small" style={{ textTransform: 'capitalize' }}>{k}</div><b style={{ fontSize: '1.3rem' }}>{a.summary[k]}</b></div>)}</div>
                  <div><div className="row between small"><span className="muted">Attendance rate (excused days excluded)</span><b>{a.summary.rate ?? '-'}%</b></div><div className={`bar ${a.summary.rate >= 92 ? 'ok' : a.summary.rate >= 80 ? 'warn' : 'bad'}`}><i style={{ width: `${a.summary.rate ?? 0}%` }} /></div></div>
                  <div className="row">{a.records.slice(0, 14).map((x, i) => <span key={i} title={`${fmtDate(x.date)} ${x.session}`}><Badge tone={statusTone[x.status]}>{fmtDate(x.date).slice(0, 6)} {x.session[0].toUpperCase()}</Badge></span>)}</div>
                </div>
              )}</Async>
            </Card>
            <Card title="Report cards" pad={false}>
              <Async state={cards} isEmpty={(c) => c.length === 0} empty={<Empty title="No report cards yet" icon={FileText}>Results appear here once an exam is published.</Empty>}>
                {(c) => c.map((e) => <div key={e.id} className="row between card-pad" style={{ borderTop: '1px solid var(--border)' }}><div><b>{e.name}</b> <span className="muted">{e.term}</span></div><div className="row"><Badge tone={statusTone[e.status]}>{e.status}</Badge><Link className="btn sm" to={`/report-card/${id}/${e.id}`}>View</Link></div></div>)}
              </Async>
            </Card>
          </div>
          {user.role !== 'teacher' && (
            <Card title="Fee ledger" pad={false} actions={<Link to="/fees">Go to fees</Link>}>
              <Async state={ledger} isEmpty={(l) => !l || l.entries.length === 0} empty={<Empty title="No fee entries" />}>
                {(l) => (<>
                  <div className="grid g4 card-pad">
                    <div><div className="muted small">Invoiced</div><b>{money(l.totals.invoiced)}</b></div><div><div className="muted small">Paid</div><b style={{ color: 'var(--ok)' }}>{money(l.totals.paid)}</b></div>
                    <div><div className="muted small">Voided</div><b>{money(l.totals.voided)}</b></div><div><div className="muted small">Outstanding</div><b style={{ color: l.totals.outstanding > 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(l.totals.outstanding)}</b></div>
                  </div>
                  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Invoice</th><th>Entry</th><th className="num">Amount</th></tr></thead>
                    <tbody>{l.entries.map((e) => <tr key={e.id}><td className="muted">{fmtDate(e.created_at)}</td><td>{e.number} <span className="muted">{e.title}</span></td><td><Badge tone={e.entry_type === 'payment' ? 'ok' : e.entry_type === 'void' ? '' : 'info'}>{e.entry_type}</Badge></td><td className="num" style={{ color: e.amount < 0 ? 'var(--ok)' : undefined }}>{money(e.amount)}</td></tr>)}</tbody></table></div>
                </>)}
              </Async>
            </Card>
          )}
        </div>
      ); }}</Async>
      {dialog}
    </>
  );
}

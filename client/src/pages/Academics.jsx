import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Async, Badge, Button, Card, Empty, FormError, Modal, SelectField, Tabs, TextField, useAsync, useConfirm, useForm, useToast } from '../ui.jsx';

function ClassesTab() {
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const s = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const [modal, setModal] = useState(null); // {type:'class'|'section', item}
  const del = async (path, label) => {
    if (!(await confirm({ title: `Delete ${label}?`, message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(path); toast('Deleted'); s.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}><span className="muted">Classes group sections; students belong to a section.</span><Button variant="primary" icon={Plus} onClick={() => setModal({ type: 'class' })}>Add class</Button></div>
      <Async state={s} isEmpty={(d) => d.length === 0} empty={<Card><Empty title="No classes yet">Create your first class to get started.</Empty></Card>}>
        {(classes) => <div className="grid g2">{classes.map((c) => (
          <Card key={c.id} title={`${c.name}`} actions={<><Badge>{c.academic_year}</Badge><Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${c.name}`} onClick={() => setModal({ type: 'class', item: c })} /><Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${c.name}`} onClick={() => del(`/classes/${c.id}`, c.name)} /></>}>
            {c.sections.length === 0 ? <span className="muted">No sections.</span> : c.sections.map((x) => (
              <div key={x.id} className="row between" style={{ padding: '6px 0' }}><div><b>Section {x.name}</b> <span className="muted small">{x.student_count}/{x.capacity} students</span>
                <div className="bar" style={{ width: 160, marginTop: 4 }}><i style={{ width: `${(x.student_count / x.capacity) * 100}%` }} /></div></div>
                <div><Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit section ${x.name}`} onClick={() => setModal({ type: 'section', item: { ...x, class_id: c.id } })} /><Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete section ${x.name}`} onClick={() => del(`/sections/${x.id}`, `section ${x.name}`)} /></div></div>
            ))}
            <Button size="sm" icon={Plus} style={{ marginTop: 10 }} onClick={() => setModal({ type: 'section', item: { class_id: c.id } })}>Add section</Button>
          </Card>
        ))}</div>}
      </Async>
      {modal?.type === 'class' && <ClassForm item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); s.reload(); }} />}
      {modal?.type === 'section' && <SectionForm item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); s.reload(); }} />}
      {dialog}
    </>
  );
}

function ClassForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const y = new Date().getFullYear();
  const f = useForm({ name: item?.name ?? '', academic_year: item?.academic_year ?? `${y}-${y + 1}` });
  return (
    <Modal title={item ? 'Edit class' : 'Add class'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={() => f.submit(async (v) => { item ? await api.patch(`/classes/${item.id}`, v) : await api.post('/classes', v); toast('Saved'); onSaved(); })}>Save</Button></>}>
      <div className="stack"><FormError message={f.formError} />
        <TextField label="Class name" placeholder="Grade 9" value={f.values.name} onChange={f.set('name')} error={f.errors.name} required />
        <TextField label="Academic year" placeholder="2025-2026" value={f.values.academic_year} onChange={f.set('academic_year')} error={f.errors.academic_year} required /></div>
    </Modal>
  );
}
function SectionForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ name: item?.name ?? '', capacity: item?.capacity ?? 40 });
  return (
    <Modal title={item?.id ? 'Edit section' : 'Add section'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={() => f.submit(async (v) => { item.id ? await api.patch(`/sections/${item.id}`, { name: v.name, capacity: Number(v.capacity) }) : await api.post('/sections', { class_id: item.class_id, name: v.name, capacity: Number(v.capacity) }); toast('Saved'); onSaved(); })}>Save</Button></>}>
      <div className="stack"><FormError message={f.formError} />
        <TextField label="Section name" placeholder="A" value={f.values.name} onChange={f.set('name')} error={f.errors.name} required />
        <TextField label="Capacity" type="number" min="1" value={f.values.capacity} onChange={f.set('capacity')} error={f.errors.capacity} /></div>
    </Modal>
  );
}

function SubjectsTab() {
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const s = useAsync(() => api.get('/subjects').then((r) => r.data), []);
  const [edit, setEdit] = useState(null);
  const del = async (x) => { if (!(await confirm({ title: `Delete ${x.name}?`, message: 'Subjects used by exams cannot be deleted.', danger: true, confirmLabel: 'Delete' }))) return; try { await api.del(`/subjects/${x.id}`); toast('Deleted'); s.reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}><span className="muted">Subjects can be taught in any section and used in exams.</span><Button variant="primary" icon={Plus} onClick={() => setEdit({})}>Add subject</Button></div>
      <Card pad={false}><Async state={s} isEmpty={(d) => d.length === 0} empty={<Empty title="No subjects" />}>{(d) => (
        <div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th /></tr></thead><tbody>{d.map((x) => (
          <tr key={x.id}><td><Badge tone="primary">{x.code}</Badge></td><td>{x.name}</td><td className="right"><Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${x.name}`} onClick={() => setEdit(x)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${x.name}`} onClick={() => del(x)} /></td></tr>))}</tbody></table></div>)}</Async></Card>
      {edit && <SubjectForm item={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); s.reload(); }} />}
      {dialog}
    </>
  );
}
function SubjectForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const f = useForm({ code: item?.code ?? '', name: item?.name ?? '' });
  return (
    <Modal title={item ? 'Edit subject' : 'Add subject'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={() => f.submit(async (v) => { item ? await api.patch(`/subjects/${item.id}`, v) : await api.post('/subjects', v); toast('Saved'); onSaved(); })}>Save</Button></>}>
      <div className="stack"><FormError message={f.formError} />
        <TextField label="Code" placeholder="PHY" value={f.values.code} onChange={f.set('code')} error={f.errors.code} required />
        <TextField label="Name" placeholder="Physics" value={f.values.name} onChange={f.set('name')} error={f.errors.name} required /></div>
    </Modal>
  );
}

function AssignmentsTab() {
  const toast = useToast();
  const list = useAsync(() => api.get('/assignments').then((r) => r.data), []);
  const teachers = useAsync(() => api.get('/teachers?pageSize=100&active=1').then((r) => r.data), []);
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const subjects = useAsync(() => api.get('/subjects').then((r) => r.data), []);
  const f = useForm({ teacher_id: '', section_id: '', subject_id: '' });
  const add = () => f.submit(async (v) => { await api.post('/assignments', { teacher_id: Number(v.teacher_id), section_id: Number(v.section_id), subject_id: Number(v.subject_id) }); toast('Teacher assigned'); f.setValues({ ...v, subject_id: '' }); list.reload(); });
  const remove = async (a) => { try { await api.del(`/assignments/${a.id}`); toast('Assignment removed'); list.reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="stack">
      <Card title="Assign a teacher to a class and subject">
        <FormError message={f.formError} />
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', alignItems: 'end' }}>
          <SelectField label="Teacher" value={f.values.teacher_id} onChange={f.set('teacher_id')} error={f.errors.teacher_id}><option value="">Choose...</option>{(teachers.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
          <SelectField label="Section" value={f.values.section_id} onChange={f.set('section_id')} error={f.errors.section_id}><option value="">Choose...</option>{(classes.data ?? []).flatMap((c) => c.sections.map((s) => <option key={s.id} value={s.id}>{c.name} - {s.name}</option>))}</SelectField>
          <SelectField label="Subject" value={f.values.subject_id} onChange={f.set('subject_id')} error={f.errors.subject_id}><option value="">Choose...</option>{(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
          <Button variant="primary" loading={f.busy} disabled={!f.values.teacher_id || !f.values.section_id || !f.values.subject_id} onClick={add}>Assign</Button>
        </div>
      </Card>
      <Card pad={false}><Async state={list} isEmpty={(d) => d.length === 0} empty={<Empty title="No assignments yet" />}>{(d) => (
        <div className="table-wrap"><table><thead><tr><th>Section</th><th>Subject</th><th>Teacher</th><th /></tr></thead><tbody>{d.map((a) => (
          <tr key={a.id}><td>{a.section_label}</td><td>{a.subject_name}</td><td>{a.teacher_name}</td><td className="right"><Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${a.subject_name} ${a.section_label}`} onClick={() => remove(a)} /></td></tr>))}</tbody></table></div>)}</Async></Card>
    </div>
  );
}

function GradingTab() {
  const toast = useToast();
  const s = useAsync(() => api.get('/grading-rules').then((r) => r.data), []);
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}><span className="muted">Rules convert percentages to grades. A rule used by a published exam is locked.</span><Button variant="primary" icon={Plus} onClick={() => setEdit({ bands: [{ min_percent: 50, grade: 'P', remark: 'Pass', gpa: 1 }, { min_percent: 0, grade: 'F', remark: 'Fail', gpa: 0 }], pass_percent: 40, name: '' })}>New rule</Button></div>
      <Async state={s}>{(rules) => <div className="grid g2">{rules.map((r) => (
        <Card key={r.id} title={r.name} actions={<>{r.is_default && <Badge tone="primary">Default</Badge>}<Button size="sm" icon={Pencil} onClick={() => setEdit(r)}>Edit</Button></>}>
          <div className="muted small" style={{ marginBottom: 8 }}>Overall pass mark: <b>{r.pass_percent}%</b></div>
          <table><thead><tr><th>From %</th><th>Grade</th><th>Remark</th><th className="num">GPA</th></tr></thead><tbody>{r.bands.map((b) => <tr key={b.grade}><td className="mono">{b.min_percent}</td><td><Badge tone="primary">{b.grade}</Badge></td><td>{b.remark}</td><td className="num">{b.gpa}</td></tr>)}</tbody></table>
        </Card>))}</div>}</Async>
      {edit && <GradingForm rule={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('Grading rule saved'); s.reload(); }} />}
    </>
  );
}
function GradingForm({ rule, onClose, onSaved }) {
  const f = useForm({ name: rule.name, pass_percent: rule.pass_percent, is_default: !!rule.is_default, bands: rule.bands.map((b) => ({ ...b, remark: b.remark ?? '' })) });
  const setBand = (i, k, v) => f.setValues((x) => ({ ...x, bands: x.bands.map((b, j) => (j === i ? { ...b, [k]: v } : b)) }));
  const save = () => f.submit(async (v) => {
    const body = { name: v.name, pass_percent: Number(v.pass_percent), is_default: v.is_default, bands: v.bands.map((b) => ({ min_percent: Number(b.min_percent), grade: b.grade, remark: b.remark || null, gpa: Number(b.gpa) })) };
    rule.id ? await api.put(`/grading-rules/${rule.id}`, body) : await api.post('/grading-rules', body); onSaved();
  });
  return (
    <Modal wide title={rule.id ? 'Edit grading rule' : 'New grading rule'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={save}>Save rule</Button></>}>
      <div className="stack"><FormError message={f.formError || f.errors.bands} />
        <div className="form-grid"><TextField label="Rule name" value={f.values.name} onChange={f.set('name')} error={f.errors.name} required />
          <TextField label="Overall pass %" type="number" min="0" max="100" value={f.values.pass_percent} onChange={f.set('pass_percent')} error={f.errors.pass_percent} /></div>
        <label className="row"><input type="checkbox" checked={f.values.is_default} onChange={f.set('is_default')} /> Use as the default rule for new exams</label>
        <div className="label">Grade bands (highest band whose minimum is reached wins; one band must start at 0)</div>
        {f.values.bands.map((b, i) => (
          <div key={i} className="row" style={{ alignItems: 'end' }}>
            <TextField label={i === 0 ? 'From %' : undefined} aria-label="From percent" type="number" min="0" max="100" value={b.min_percent} onChange={(e) => setBand(i, 'min_percent', e.target.value)} />
            <TextField label={i === 0 ? 'Grade' : undefined} aria-label="Grade" value={b.grade} onChange={(e) => setBand(i, 'grade', e.target.value)} style={{ width: 80 }} />
            <TextField label={i === 0 ? 'Remark' : undefined} aria-label="Remark" value={b.remark} onChange={(e) => setBand(i, 'remark', e.target.value)} />
            <TextField label={i === 0 ? 'GPA' : undefined} aria-label="GPA" type="number" step="0.1" value={b.gpa} onChange={(e) => setBand(i, 'gpa', e.target.value)} style={{ width: 80 }} />
            <Button variant="ghost" icon={Trash2} aria-label="Remove band" disabled={f.values.bands.length <= 1} onClick={() => f.setValues((x) => ({ ...x, bands: x.bands.filter((_, j) => j !== i) }))} />
          </div>
        ))}
        <Button size="sm" icon={Plus} onClick={() => f.setValues((x) => ({ ...x, bands: [...x.bands, { min_percent: '', grade: '', remark: '', gpa: 0 }] }))}>Add band</Button>
      </div>
    </Modal>
  );
}

export default function Academics() {
  const [tab, setTab] = useState('classes');
  return (
    <>
      <div className="page-head"><div><h1>Academics</h1><p>Classes, subjects, teaching assignments and grading rules.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[['classes', 'Classes & sections'], ['subjects', 'Subjects'], ['assign', 'Teaching assignments'], ['grading', 'Grading rules']]} />
      {tab === 'classes' && <ClassesTab />}{tab === 'subjects' && <SubjectsTab />}{tab === 'assign' && <AssignmentsTab />}{tab === 'grading' && <GradingTab />}
    </>
  );
}

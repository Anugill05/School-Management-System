import { useState } from 'react';
import { KeyRound, Pencil, Plus, UserCheck, UserX, Users } from 'lucide-react';
import { api, qs } from '../api.js';
import { Async, Badge, Button, Card, Empty, FormError, Modal, Pager, SearchBox, Tabs, TextField, useAsync, useDebounced, useForm, useToast } from '../ui.jsx';

function PersonForm({ kind, item, onClose, onSaved }) {
  const toast = useToast();
  const extra = kind === 'teacher' ? ['employee_no', 'Employee no.'] : ['address', 'Address'];
  const f = useForm({ name: item?.name ?? '', email: item?.email ?? '', phone: item?.phone ?? '', [extra[0]]: item?.[extra[0]] ?? '', password: '' });
  const save = () => f.submit(async (v) => {
    const body = { name: v.name, email: v.email, phone: v.phone || null, [extra[0]]: v[extra[0]] || null };
    if (!item) body.password = v.password;
    item ? await api.patch(`/${kind}s/${item.id}`, body) : await api.post(`/${kind}s`, body);
    toast(item ? 'Saved' : `${kind === 'teacher' ? 'Teacher' : 'Guardian'} created`); onSaved();
  });
  return (
    <Modal title={`${item ? 'Edit' : 'Add'} ${kind}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={save}>Save</Button></>}>
      <div className="form-grid"><div className="span2"><FormError message={f.formError} /></div>
        <TextField label="Full name" value={f.values.name} onChange={f.set('name')} error={f.errors.name} required />
        <TextField label="Email (login)" type="email" value={f.values.email} onChange={f.set('email')} error={f.errors.email} required />
        <TextField label="Phone" value={f.values.phone} onChange={f.set('phone')} error={f.errors.phone} />
        <TextField label={extra[1]} value={f.values[extra[0]]} onChange={f.set(extra[0])} error={f.errors[extra[0]]} />
        {!item && <TextField className="span2" label="Initial password" type="password" autoComplete="new-password" value={f.values.password} onChange={f.set('password')} error={f.errors.password} hint="At least 8 characters with a letter and a number." required />}
      </div>
    </Modal>
  );
}

function ResetPassword({ kind, item, onClose }) {
  const toast = useToast();
  const f = useForm({ password: '' });
  return (
    <Modal title={`Reset password for ${item.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={() => f.submit(async (v) => { await api.post(`/${kind}s/${item.id}/reset-password`, v); toast('Password reset. Existing sessions were signed out.'); onClose(); })}>Reset password</Button></>}>
      <div className="stack"><FormError message={f.formError} /><TextField label="New password" type="password" autoComplete="new-password" value={f.values.password} onChange={f.set('password')} error={f.errors.password} required /></div>
    </Modal>
  );
}

function PeopleList({ kind }) {
  const toast = useToast();
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const dq = useDebounced(q);
  const [modal, setModal] = useState(null);
  const list = useAsync(() => api.get(`/${kind}s${qs({ q: dq, page, pageSize: 15 })}`), [kind, dq, page]);
  const toggle = async (p) => { try { await api.patch(`/${kind}s/${p.id}`, { active: !p.active }); toast(p.active ? 'Account deactivated' : 'Account reactivated'); list.reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <div className="card">
        <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={`Search ${kind}s by name or email`} /><Button variant="primary" icon={Plus} onClick={() => setModal({ type: 'form' })}>Add {kind}</Button></div>
        <Async state={list} isEmpty={(r) => r.data.length === 0} empty={<Empty title={`No ${kind}s found`} icon={Users} />}>
          {(r) => (<>
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>{kind === 'teacher' ? 'Assignments' : 'Children'}</th><th>Status</th><th /></tr></thead>
              <tbody>{r.data.map((p) => (
                <tr key={p.id}><td><b>{p.name}</b></td><td>{p.email}</td><td className="muted">{p.phone ?? '-'}</td><td>{kind === 'teacher' ? p.assignments : p.children}</td>
                  <td><Badge tone={p.active ? 'ok' : ''}>{p.active ? 'Active' : 'Deactivated'}</Badge></td>
                  <td className="right"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${p.name}`} onClick={() => setModal({ type: 'form', item: p })} />
                    <Button size="sm" variant="ghost" icon={KeyRound} aria-label={`Reset password for ${p.name}`} onClick={() => setModal({ type: 'pw', item: p })} />
                    <Button size="sm" variant="ghost" icon={p.active ? UserX : UserCheck} aria-label={p.active ? `Deactivate ${p.name}` : `Reactivate ${p.name}`} onClick={() => toggle(p)} /></div></td></tr>
              ))}</tbody>
            </table></div>
            <Pager meta={r.meta} onPage={setPage} />
          </>)}
        </Async>
      </div>
      {modal?.type === 'form' && <PersonForm kind={kind} item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); list.reload(); }} />}
      {modal?.type === 'pw' && <ResetPassword kind={kind} item={modal.item} onClose={() => setModal(null)} />}
    </>
  );
}

export default function People() {
  const [tab, setTab] = useState('teacher');
  return (
    <>
      <div className="page-head"><div><h1>Staff & guardians</h1><p>Manage logins. Deactivating an account ends its sessions immediately.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[['teacher', 'Teachers'], ['guardian', 'Guardians']]} />
      <PeopleList key={tab} kind={tab} />
      <Card className="no-print" pad><span className="muted small">Link guardians to students from a student's profile page.</span></Card>
    </>
  );
}

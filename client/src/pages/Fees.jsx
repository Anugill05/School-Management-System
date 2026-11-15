import { useState } from 'react';
import { AlertTriangle, Banknote, CreditCard, Landmark, Plus, Receipt, Smartphone, Wallet } from 'lucide-react';
import { api, fmtDate, fmtDateTime, money, newKey, qs, todayISO } from '../api.js';
import { useAuth } from '../auth.js';
import { Async, Badge, Button, Card, Empty, FormError, Modal, Pager, SearchBox, SelectField, Stat, TextField, statusTone, useAsync, useDebounced, useForm, useToast } from '../ui.jsx';

const METHODS = { card: ['Card', CreditCard], upi: ['UPI', Smartphone], bank_transfer: ['Bank transfer', Landmark], cash: ['Cash (office)', Banknote] };

function InvoiceForm({ onClose, onSaved }) {
  const toast = useToast();
  const classes = useAsync(() => api.get('/classes').then((r) => r.data), []);
  const students = useAsync(() => api.get('/students?pageSize=100&status=active').then((r) => r.data), []);
  const f = useForm({ scope: 'class', target: '', title: '', amount: '', due_date: '' });
  const secs = (classes.data ?? []).flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name} - ${s.name}` })));
  const targets = f.values.scope === 'class' ? (classes.data ?? []).map((c) => ({ id: c.id, label: `${c.name} (all sections)` })) : f.values.scope === 'section' ? secs : (students.data?.data ?? []).map((s) => ({ id: s.id, label: `${s.first_name} ${s.last_name} - ${s.admission_no}` }));
  const save = () => f.submit(async (v) => {
    const key = v.scope === 'class' ? 'class_id' : v.scope === 'section' ? 'section_id' : 'student_id';
    const r = await api.post('/fees/invoices', { [key]: Number(v.target), title: v.title, amount: v.amount, due_date: v.due_date });
    toast(`${r.data.created} invoice${r.data.created === 1 ? '' : 's'} created`); onSaved();
  });
  return (
    <Modal title="Create invoices" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={save}>Create invoices</Button></>}>
      <div className="form-grid"><div className="span2"><FormError message={f.formError} /></div>
        <SelectField label="Bill" value={f.values.scope} onChange={(e) => f.setValues((v) => ({ ...v, scope: e.target.value, target: '' }))}><option value="class">An entire class</option><option value="section">One section</option><option value="student">One student</option></SelectField>
        <SelectField label="Target" value={f.values.target} onChange={f.set('target')} error={f.errors._ ?? f.errors.target} required><option value="">Choose...</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</SelectField>
        <TextField className="span2" label="Description" placeholder="Tuition Fee - Term 2" value={f.values.title} onChange={f.set('title')} error={f.errors.title} required />
        <TextField label="Amount (INR)" type="number" min="0.01" step="0.01" inputMode="decimal" value={f.values.amount} onChange={f.set('amount')} error={f.errors.amount} required />
        <TextField label="Due date" type="date" value={f.values.due_date} onChange={f.set('due_date')} error={f.errors.due_date} required />
      </div>
    </Modal>
  );
}

function InvoiceDrawer({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const d = useAsync(() => api.get(`/fees/invoices/${id}`).then((r) => r.data), [id]);
  const [method, setMethod] = useState(user.role === 'admin' ? 'cash' : 'card');
  const [amount, setAmount] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [key, setKey] = useState(newKey); // one idempotency key per payment attempt; rotated only after success
  const [voiding, setVoiding] = useState(false); const [reason, setReason] = useState('');
  const inv = d.data;
  const pay = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/fees/invoices/${id}/payments`, { amount, method }, { 'Idempotency-Key': key });
      toast(r.data.replayed ? 'Payment was already recorded' : `Payment of ${money(Number(amount))} recorded (simulated)`); setAmount(''); setKey(newKey()); d.reload(); onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const doVoid = async () => { try { await api.post(`/fees/invoices/${id}/void`, { reason }); toast('Invoice voided'); setVoiding(false); d.reload(); onChanged(); } catch (e) { setErr(e.message); } };
  const payable = inv && inv.status !== 'void' && inv.outstanding > 0;
  return (
    <Modal wide title={inv ? `${inv.number} - ${inv.student_name}` : 'Invoice'} onClose={onClose}>
      <Async state={d}>{(i) => (
        <div className="stack">
          <div className="grid g4">
            <div><div className="muted small">Amount</div><b>{money(i.amount)}</b></div><div><div className="muted small">Paid</div><b style={{ color: 'var(--ok)' }}>{money(i.paid)}</b></div>
            <div><div className="muted small">Outstanding</div><b style={{ color: i.outstanding > 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(i.outstanding)}</b></div>
            <div><div className="muted small">Status</div><Badge tone={statusTone[i.status]}>{i.status}</Badge> {i.overdue && <Badge tone="bad">overdue</Badge>}</div>
          </div>
          <div className="muted">{i.title} - due {fmtDate(i.due_date)}{i.void_reason ? ` - voided: ${i.void_reason}` : ''}</div>
          <table><thead><tr><th>When</th><th>Entry</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>{i.ledger.map((l) => <tr key={l.id}><td className="muted">{fmtDateTime(l.created_at)}</td><td><Badge tone={l.entry_type === 'payment' ? 'ok' : l.entry_type === 'void' ? '' : 'info'}>{l.entry_type}</Badge> {l.method && <span className="muted small">{METHODS[l.method]?.[0]}</span>}</td><td className="muted small">{l.reference ?? '-'}</td><td className="num" style={{ color: l.amount < 0 ? 'var(--ok)' : undefined }}>{money(l.amount)}</td></tr>)}</tbody></table>
          {err && <FormError message={err} />}
          {payable && (
            <Card title="Record a payment" className="" >
              <div className="alert info" style={{ marginBottom: 12 }}><Wallet size={18} />Simulated payment only - no real money moves and no card details are collected or stored.</div>
              <div className="form-grid">
                <div className="field"><span className="label">Method</span><div className="seg" role="group" aria-label="Payment method">{Object.entries(METHODS).filter(([k]) => user.role === 'admin' || k !== 'cash').map(([k, [label, Icon]]) => <button key={k} aria-pressed={method === k} className="present" onClick={() => setMethod(k)}><Icon size={14} style={{ verticalAlign: -2 }} /> {label}</button>)}</div></div>
                <TextField label="Amount" type="number" step="0.01" min="0.01" max={i.outstanding} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Outstanding ${money(i.outstanding)}`} />
              </div>
              <div className="row" style={{ marginTop: 12 }}><Button variant="primary" loading={busy} disabled={!amount || Number(amount) <= 0} onClick={pay}>Pay {amount ? money(Number(amount)) : ''}</Button><Button onClick={() => setAmount(String(i.outstanding))}>Pay full balance</Button></div>
            </Card>)}
          {user.role === 'admin' && i.status !== 'void' && i.paid === 0 && (voiding ? (
            <div className="row"><input className="input" style={{ flex: 1 }} aria-label="Void reason" placeholder="Reason for voiding" value={reason} onChange={(e) => setReason(e.target.value)} /><Button variant="danger" disabled={!reason.trim()} onClick={doVoid}>Confirm void</Button><Button onClick={() => setVoiding(false)}>Cancel</Button></div>
          ) : <div><Button variant="danger" size="sm" onClick={() => setVoiding(true)}>Void invoice</Button></div>)}
        </div>)}
      </Async>
    </Modal>
  );
}

export default function Fees() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [overdue, setOverdue] = useState(false); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const [create, setCreate] = useState(false); const [open, setOpen] = useState(null);
  const sum = useAsync(() => (isAdmin ? api.get('/fees/summary').then((r) => r.data) : Promise.resolve(null)), []);
  const list = useAsync(() => api.get(`/fees/invoices${qs({ q: dq, status, overdue: overdue ? 1 : '', page, pageSize: 12 })}`), [dq, status, overdue, page]);
  const refresh = () => { list.reload(); sum.reload(); };
  const s = sum.data;
  return (
    <>
      <div className="page-head"><div><h1>{isAdmin ? 'Fees' : 'Fees & payments'}</h1><p>{isAdmin ? 'Invoices, payments and balances. Every figure comes from the append-only ledger.' : 'Invoices for your children. Payments here are simulated.'}</p></div>
        {isAdmin && <Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>Create invoices</Button>}</div>
      {s && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Invoiced" value={money(s.invoiced)} icon={Receipt} /><Stat label="Collected" value={money(s.paid)} icon={Wallet} tone="ok" sub={s.collection_rate !== null ? `${s.collection_rate}% collection rate` : undefined} />
          <Stat label="Outstanding" value={money(s.outstanding)} icon={Landmark} tone="bad" /><Stat label="Overdue" value={s.overdue_count} icon={AlertTriangle} tone="warn" sub={money(s.overdue_amount)} />
        </div>)}
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search invoice no., student or description" />
          <select className="select" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="issued">Issued</option><option value="partial">Partially paid</option><option value="paid">Paid</option><option value="void">Void</option></select>
          <label className="row small"><input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} /> Overdue only</label>
        </div>
        <Async state={list} isEmpty={(r) => r.data.length === 0} empty={<Empty title="No invoices found" icon={Receipt}>{q || status || overdue ? 'Try clearing the filters.' : 'Invoices will appear here.'}</Empty>}>
          {(r) => (<>
            <div className="table-wrap"><table>
              <thead><tr><th>Invoice</th><th>Student</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Status</th><th /></tr></thead>
              <tbody>{r.data.map((i) => (
                <tr key={i.id}><td><b className="mono">{i.number}</b><div className="muted small">{i.title}</div></td><td>{i.student_name}<div className="muted small">{i.section_label}</div></td>
                  <td>{fmtDate(i.due_date)} {i.overdue && <Badge tone="bad">overdue</Badge>}</td><td className="num">{money(i.amount)}</td><td className="num" style={{ color: 'var(--ok)' }}>{money(i.paid)}</td><td className="num"><b>{money(i.outstanding)}</b></td>
                  <td><Badge tone={statusTone[i.status]}>{i.status}</Badge></td>
                  <td className="right"><Button size="sm" variant={i.outstanding > 0 && i.status !== 'void' ? 'primary' : undefined} onClick={() => setOpen(i.id)}>{i.outstanding > 0 && i.status !== 'void' ? 'Pay / view' : 'View'}</Button></td></tr>))}</tbody>
            </table></div>
            <Pager meta={r.meta} onPage={setPage} />
          </>)}
        </Async>
      </div>
      {create && <InvoiceForm onClose={() => setCreate(false)} onSaved={() => { setCreate(false); refresh(); }} />}
      {open && <InvoiceDrawer id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  );
}

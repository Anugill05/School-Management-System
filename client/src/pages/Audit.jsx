import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { api, fmtDateTime, qs } from '../api.js';
import { Async, Badge, Card, Empty, Pager, SearchBox, useAsync, useDebounced } from '../ui.jsx';

export default function Audit() {
  const [q, setQ] = useState(''); const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [page, setPage] = useState(1); const [open, setOpen] = useState(null);
  const dq = useDebounced(q);
  const r = useAsync(() => api.get(`/audit${qs({ q: dq, entity, action, page, pageSize: 20 })}`), [dq, entity, action, page]);
  const f = r.data?.meta?.filters;
  return (
    <>
      <div className="page-head"><div><h1>Audit trail</h1><p>Append-only record of material actions. Entries cannot be edited or deleted.</p></div></div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search actor, details or record id" />
          <select className="select" aria-label="Entity" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All records</option>{(f?.entities ?? []).map((x) => <option key={x}>{x}</option>)}</select>
          <select className="select" aria-label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">All actions</option>{(f?.actions ?? []).map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select>
        </div>
        <Async state={r} isEmpty={(d) => d.data.length === 0} empty={<Empty title="No matching entries" icon={History} />}>
          {(d) => (<>
            <div className="table-wrap"><table>
              <thead><tr><th /><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
              <tbody>{d.data.map((a) => (<Fragment key={a.id}>
                <tr><td style={{ width: 36 }}>{a.details && <button className="btn ghost sm icon-btn" aria-expanded={open === a.id} aria-label="Toggle details" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td><td>{a.actor_name}</td><td><Badge tone={a.action === 'login_failed' ? 'bad' : 'primary'}>{a.action.replace(/_/g, ' ')}</Badge></td><td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td></tr>
                {open === a.id && <tr key={`${a.id}-d`}><td /><td colSpan={4}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '.8rem', color: 'var(--muted)' }}>{JSON.stringify(a.details, null, 2)}</pre></td></tr>}
              </Fragment>))}</tbody>
            </table></div>
            <Pager meta={d.meta} onPage={setPage} />
          </>)}
        </Async>
      </div>
    </>
  );
}
void Card;

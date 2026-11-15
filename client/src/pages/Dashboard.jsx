import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpenCheck, CalendarCheck, GraduationCap, School, Users, Wallet } from 'lucide-react';
import { api, fmtDateTime, money } from '../api.js';
import { useAuth } from '../auth.js';
import campus from '../assets/campus.jpg';
import { Async, Badge, Card, Empty, Stat, useAsync } from '../ui.jsx';

const rateTone = (r) => (r === null ? '' : r >= 92 ? 'ok' : r >= 80 ? 'warn' : 'bad');
const verb = (a) => a.replace(/_/g, ' ');

function AdminDash({ d }) {
  const max = 100;
  return (
    <div className="stack">
      <div className="grid g4">
        <Stat label="Active students" value={d.stats.students} icon={GraduationCap} />
        <Stat label="Teachers" value={d.stats.teachers} icon={Users} />
        <Stat label="Class sections" value={d.stats.classes} icon={School} />
        <Stat label="Exams in progress" value={d.stats.open_exams} icon={BookOpenCheck} />
      </div>
      <div className="grid g2">
        <Card title="Attendance - last 14 days" actions={<Badge tone={rateTone(d.attendance_7d.rate)}>7-day rate {d.attendance_7d.rate ?? '-'}%</Badge>}>
          {d.attendance_trend.length === 0 ? <Empty title="No attendance yet" icon={CalendarCheck} /> : (
            <div className="spark" role="img" aria-label="Daily attendance rate for the last 14 days">
              {d.attendance_trend.map((t) => (
                <div key={t.date} title={`${t.date}: ${t.rate ?? 0}%`}><i style={{ height: `${((t.rate ?? 0) / max) * 100}%` }} /></div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Fee collection" actions={<Link to="/fees">Open fees</Link>}>
          <div className="grid g3">
            <div><div className="muted small">Invoiced</div><b className="mono">{money(d.fees.invoiced)}</b></div>
            <div><div className="muted small">Collected</div><b className="mono" style={{ color: 'var(--ok)' }}>{money(d.fees.paid)}</b></div>
            <div><div className="muted small">Outstanding</div><b className="mono" style={{ color: 'var(--bad)' }}>{money(d.fees.outstanding)}</b></div>
          </div>
          <div className={`bar ok`} style={{ marginTop: 14 }} aria-hidden="true"><i style={{ width: `${d.fees.invoiced ? (d.fees.paid / d.fees.invoiced) * 100 : 0}%` }} /></div>
          {d.overdue_invoices > 0 && <div className="alert warn" style={{ marginTop: 14 }}><AlertTriangle size={18} />{d.overdue_invoices} invoice(s) are overdue.</div>}
        </Card>
      </div>
      <Card title="Recent activity" actions={<Link to="/audit">Full audit trail</Link>} pad={false}>
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
          <tbody>{d.recent_activity.map((a) => <tr key={a.id}><td className="muted">{fmtDateTime(a.created_at)}</td><td>{a.actor_name}</td><td><Badge tone="primary">{verb(a.action)}</Badge></td><td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

function TeacherDash({ d }) {
  return (
    <div className="stack">
      <Card title="My classes" pad={false}>
        {d.sections.length === 0 ? <Empty title="No classes assigned" icon={School}>Ask the school office to assign you to a class and subject.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Class</th><th>Subjects</th><th className="num">Students</th><th>Today's attendance</th><th /></tr></thead>
            <tbody>{d.sections.map((s) => (
              <tr key={s.id}><td><b>{s.label}</b></td><td className="muted">{s.subjects}</td><td className="num">{s.students}</td>
                <td>{s.sessions_marked_today >= 1 ? <Badge tone="ok">Marked</Badge> : <Badge tone="warn">Not marked yet</Badge>}</td>
                <td className="right"><Link className="btn sm" to={`/attendance?section=${s.id}`}>Take attendance</Link></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="Marks waiting for you" pad={false}>
        {d.pending_marks.length === 0 ? <Empty title="All caught up" icon={BookOpenCheck}>No open exams need marks from you.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Exam</th><th>Class</th><th>Subject</th><th>Progress</th><th /></tr></thead>
            <tbody>{d.pending_marks.map((p) => (
              <tr key={`${p.exam_id}-${p.section_id}-${p.subject_id}`}><td>{p.exam}</td><td>{p.section}</td><td>{p.subject}</td>
                <td style={{ minWidth: 150 }}><div className="bar"><i style={{ width: `${(p.entered / p.students) * 100}%` }} /></div><span className="muted small">{p.entered}/{p.students} entered</span></td>
                <td className="right"><Link className="btn sm primary" to={`/exams/${p.exam_id}?section=${p.section_id}&subject=${p.subject_id}`}>Enter marks</Link></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function GuardianDash({ d }) {
  return d.children.length === 0 ? <Card><Empty title="No linked students" icon={GraduationCap}>Contact the school office to link your account to your child.</Empty></Card> : (
    <div className="grid g2">
      {d.children.map((c) => (
        <Card key={c.id} title={c.name} actions={<Badge>{c.section}</Badge>}>
          <div className="grid g2">
            <div><div className="muted small">Attendance</div><b style={{ fontSize: '1.4rem' }}>{c.attendance_rate ?? '-'}%</b>
              <div className={`bar ${rateTone(c.attendance_rate)}`}><i style={{ width: `${c.attendance_rate ?? 0}%` }} /></div></div>
            <div><div className="muted small">Fees due</div><b style={{ fontSize: '1.4rem', color: c.outstanding > 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(c.outstanding)}</b>
              {c.overdue_invoices > 0 && <div><Badge tone="bad">{c.overdue_invoices} overdue</Badge></div>}</div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <Link className="btn sm" to={`/students/${c.id}`}>Profile & attendance</Link>
            <Link className="btn sm" to="/exams">Report cards</Link>
            <Link className="btn sm primary" to="/fees" ><Wallet size={14} /> Pay fees</Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const s = useAsync(() => api.get('/reports/dashboard').then((r) => r.data), []);
  const hour = new Date().getHours();
  return (
    <>
      <header className="welcome">
        <img src={campus} alt="" />
        <div>
          <h1>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {user.name.split(' ')[0]}</h1>
          <p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </header>
      <Async state={s}>{(d) => (d.role === 'admin' ? <AdminDash d={d} /> : d.role === 'teacher' ? <TeacherDash d={d} /> : <GuardianDash d={d} />)}</Async>
    </>
  );
}

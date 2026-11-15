import { useCallback, useEffect, useState } from 'react';
import { AuthCtx, useAuth } from './auth.js';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, BookOpenCheck, CalendarCheck, GraduationCap, History, LayoutDashboard, LogOut, Menu, Receipt, School, ShieldCheck, Users, KeyRound } from 'lucide-react';
import { api, setUnauthorizedHandler } from './api.js';
import { Button, Modal, TextField, FormError, useForm, useToast } from './ui.jsx';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Students, { StudentDetail } from './pages/Students.jsx';
import Academics from './pages/Academics.jsx';
import People from './pages/People.jsx';
import Attendance from './pages/Attendance.jsx';
import Exams, { ExamDetail, ReportCard } from './pages/Exams.jsx';
import Fees from './pages/Fees.jsx';
import Reports from './pages/Reports.jsx';
import Audit from './pages/Audit.jsx';


const NAV = [
  ['/', 'Dashboard', LayoutDashboard, ['admin', 'teacher', 'guardian'], true],
  ['/students', 'Students', GraduationCap, ['admin', 'teacher', 'guardian']],
  ['/attendance', 'Attendance', CalendarCheck, ['admin', 'teacher']],
  ['/exams', 'Exams & Results', BookOpenCheck, ['admin', 'teacher', 'guardian']],
  ['/fees', 'Fees', Receipt, ['admin', 'guardian']],
  ['/reports', 'Reports', BarChart3, ['admin', 'teacher']],
  ['/academics', 'Academics', School, ['admin']],
  ['/people', 'Staff & Guardians', Users, ['admin']],
  ['/audit', 'Audit Trail', History, ['admin']],
];

function ChangePassword({ onClose, onDone }) {
  const f = useForm({ current_password: '', new_password: '' });
  return (
    <Modal title="Change password" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={f.busy} onClick={() => f.submit(async (v) => { await api.post('/auth/change-password', v); onDone(); })}>Update password</Button></>}>
      <div className="stack">
        <FormError message={f.formError} />
        <TextField label="Current password" type="password" autoComplete="current-password" value={f.values.current_password} onChange={f.set('current_password')} error={f.errors.current_password} required />
        <TextField label="New password" type="password" autoComplete="new-password" value={f.values.new_password} onChange={f.set('new_password')} error={f.errors.new_password} hint="At least 8 characters with a letter and a number. You will be signed out." required />
      </div>
    </Modal>
  );
}

function Shell({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = NAV.filter((n) => n[3].includes(user.role));
  const label = user.role === 'guardian' ? { '/students': 'My children', '/exams': 'Report cards' } : {};
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <div className="topbar-m no-print"><button className="btn ghost icon-btn" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button><span>Greenfield School</span></div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand"><div className="logo"><GraduationCap size={20} /></div>Greenfield School</div>
        <nav className="nav">
          {items.map(([to, text, Icon, , end]) => <NavLink key={to} to={to} end={end}><Icon size={18} />{label[to] ?? text}</NavLink>)}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          <div className="who"><span className="avatar">{user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span><div><b>{user.name}</b><span>{user.role}</span></div></div>
          <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => setPw(true)}>Change password</Button>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={onLogout}>Sign out</Button>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <div className="page" key={loc.pathname}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/students" element={<Students />} />
          <Route path="/students/:id" element={<StudentDetail />} />
          <Route path="/attendance" element={<Guard roles={['admin', 'teacher']}><Attendance /></Guard>} />
          <Route path="/exams" element={<Exams />} />
          <Route path="/exams/:id" element={<ExamDetail />} />
          <Route path="/report-card/:studentId/:examId" element={<ReportCard />} />
          <Route path="/fees" element={<Guard roles={['admin', 'guardian']}><Fees /></Guard>} />
          <Route path="/reports" element={<Guard roles={['admin', 'teacher']}><Reports /></Guard>} />
          <Route path="/academics" element={<Guard roles={['admin']}><Academics /></Guard>} />
          <Route path="/people" element={<Guard roles={['admin']}><People /></Guard>} />
          <Route path="/audit" element={<Guard roles={['admin']}><Audit /></Guard>} />
          <Route path="*" element={<div className="card card-pad"><h1>Page not found</h1><p className="muted">That page does not exist. <NavLink to="/">Back to dashboard</NavLink></p></div>} />
        </Routes>
        </div>
      </main>
      {pw && <ChangePassword onClose={() => setPw(false)} onDone={() => { setPw(false); onLogout(true); }} />}
    </div>
  );
}

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) {
    return <div className="card card-pad stack"><div className="row"><ShieldCheck /><h1>Access restricted</h1></div><p className="muted">Your role ({user.role}) does not have access to this page.</p></div>;
  }
  return children;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null));
  }, []);

  const logout = useCallback(async (silent) => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null); nav('/');
    if (silent === true) toast('Password updated. Please sign in again.', 'info');
  }, [nav, toast]);

  useEffect(() => setUnauthorizedHandler(() => { setUser((u) => { if (u) toast('Your session has expired. Please sign in again.', 'info'); return null; }); }), [toast]);

  if (user === undefined) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><div className="skel" style={{ width: 160 }} /></div>;
  if (!user) return <Routes><Route path="/login" element={<Login onLogin={setUser} />} /><Route path="*" element={<Landing />} /></Routes>;
  return <AuthCtx.Provider value={{ user }}><Shell user={user} onLogout={logout} /></AuthCtx.Provider>;
}

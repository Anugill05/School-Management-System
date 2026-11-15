import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, GraduationCap } from 'lucide-react';
import { api } from '../api.js';
import { Button, FormError, TextField, useForm } from '../ui.jsx';
import classroom from '../assets/classroom.jpg';
import login from '../assets/login.jpg';

const DEMOS = [
  ['Admin', 'admin@school.test', 'Full access'],
  ['Teacher, Grade 6', 'teacher1@school.test', 'Assigned classes only'],
  ['Teacher, Grade 7', 'teacher3@school.test', 'Assigned classes only'],
  ['Guardian', 'guardian1@school.test', 'Linked child only'],
  ['Guardian, 2 children', 'guardian2@school.test', 'Sibling view'],
  ['Teacher, Grade 8', 'teacher4@school.test', 'Incomplete marks demo'],
];

export default function Login({ onLogin }) {
  const f = useForm({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const nav = useNavigate();
  const go = (e) => { e.preventDefault(); f.submit(async (v) => { const r = await api.post('/auth/login', v); nav('/', { replace: true }); onLogin(r.data); }); };
  return (
    <div className="login-wrap">
      <div className="login-hero media-bg">
        <img className="bg" src={login} alt="" />
        <Link to="/" className="lp-brand"><span className="logo"><GraduationCap size={19} /></span>Greenfield School</Link>
        <div className="hero-in">
          <h1>Welcome back to Greenfield School.</h1>
          <p>Attendance, results and fees in one secure place.</p>
        </div>
      </div>
      <div className="login-form">
        <form className="login-card" onSubmit={go} noValidate>
          <Link to="/" className="row small muted"><ArrowLeft size={14} /> Back to home</Link>
          <div><h1>Sign in</h1><p className="muted" style={{ marginTop: 6 }}>Use your school account to continue.</p></div>
          <FormError message={f.formError} />
          <TextField label="Email" type="email" autoComplete="username" autoFocus value={f.values.email} onChange={f.set('email')} error={f.errors.email} required />
          <div className="field">
            <TextField label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={f.values.password} onChange={f.set('password')} error={f.errors.password} required />
            <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? <EyeOff size={14} /> : <Eye size={14} />} {show ? 'Hide' : 'Show'} password</button>
          </div>
          <Button variant="primary" className="lg" type="submit" loading={f.busy}>Sign in</Button>
          <div className="demo-box">
            <div className="label">Demo accounts <span className="muted small">(password: Demo@12345)</span></div>
            <div className="demo-list">
              {DEMOS.map(([name, email, hint]) => (
                <button key={email} type="button" className="btn" onClick={() => f.setValues({ email, password: 'Demo@12345' })}>
                  <span><b>{name}</b><br /><span className="muted">{hint}</span></span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

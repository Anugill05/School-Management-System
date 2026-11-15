import { Link } from 'react-router-dom';
import { BarChart3, BookOpenCheck, CalendarCheck, Check, FileClock, GraduationCap, LockKeyhole, Receipt, ShieldCheck, Users } from 'lucide-react';
import { useReveal } from '../ui.jsx';
import campus from '../assets/campus.jpg';
import classroom from '../assets/classroom.jpg';
import school from '../assets/school.jpg';
import planning from '../assets/planning.jpg';
import science from '../assets/science.jpg';

const FEATURES = [
  [CalendarCheck, 'Attendance in seconds', 'Mark a whole class for a session in one pass. Submitting again updates the record instead of duplicating it.'],
  [BookOpenCheck, 'Exams and report cards', 'Set grading bands and pass marks, enter marks per subject, publish results and print report cards with ranks.'],
  [Receipt, 'Fees that reconcile', 'Create invoices in bulk, accept partial payments and see balances that always match the ledger.'],
  [ShieldCheck, 'Access by role', 'Teachers see their own classes and guardians see their own children. The server enforces it.'],
  [BarChart3, 'Reports', 'Attendance risk lists, subject performance and fee collection, each exportable to CSV.'],
  [FileClock, 'Audit trail', 'Logins, marks, payments and status changes are recorded and cannot be edited afterwards.'],
];

const ROLES = [
  ['Administrators', 'Run the school', planning, ['Students, classes, subjects and staff', 'Exams, grading rules and publishing', 'Invoices, payments and collection reports', 'Audit trail of every important action']],
  ['Teachers', 'Spend less time on paperwork', classroom, ['Only their assigned classes', 'Attendance for each session', 'Marks for the subjects they teach', 'Class summaries and results']],
  ['Guardians', 'Follow your child\'s progress', science, ['Only their own children', 'Attendance and report cards', 'Fee statements and balances', 'Simulated secure payments']],
];

export default function Landing() {
  useReveal();
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap">
          <Link to="/" className="lp-brand"><span className="logo"><GraduationCap size={19} /></span>Greenfield School</Link>
          <nav className="lp-links" aria-label="Sections"><a href="#features">Features</a><a href="#roles">Who it's for</a><a href="#security">Security</a></nav>
          <Link className="btn primary" to="/login">Sign in</Link>
        </div>
      </header>

      <section className="lp-hero media-bg">
        <img className="bg" src={campus} alt="" />
        <div className="lp-wrap">
          <div className="hero-in">
            <h1>School administration in one place.</h1>
            <p className="lead">Attendance, exams, report cards and fees for administrators, teachers and guardians. Everyone sees only what they need.</p>
            <div className="lp-cta">
              <Link className="btn light lg" to="/login">Open the demo</Link>
              <a className="btn outline-light lg" href="#features">See features</a>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec alt" id="features">
        <div className="lp-wrap">
          <div className="lp-head reveal"><h2>Everything the school office handles daily</h2><p>Each module follows how schools actually work, so there is less to learn and less to fix.</p></div>
          <div className="lp-features">{FEATURES.map(([Icon, t, d], i) => <div className="lp-feature reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }} key={t}><Icon size={24} /><h3>{t}</h3><p>{d}</p></div>)}</div>
        </div>
      </section>

      <section className="lp-sec" id="roles">
        <div className="lp-wrap">
          <div className="lp-head reveal"><h2>One system, three views</h2><p>Each role gets its own set of tools and nothing it does not need.</p></div>
          <div className="lp-roles">{ROLES.map(([title, sub, img, items], i) => (
            <article className="lp-role reveal" style={{ transitionDelay: `${i * 90}ms` }} key={title}>
              <div className="pic"><img src={img} alt="" loading="lazy" /></div>
              <div className="body"><h3>{title}</h3><p className="sub">{sub}</p><ul>{items.map((x) => <li key={x}><Check size={16} />{x}</li>)}</ul></div>
            </article>))}</div>
        </div>
      </section>

      <section className="lp-sec alt" id="security">
        <div className="lp-wrap lp-trustgrid">
          <div className="reveal">
            <div className="lp-head" style={{ marginBottom: 24 }}><h2>Numbers you can trust, records you can check</h2></div>
            <div className="lp-checks">
              {[[Receipt, 'Append-only fee ledger', 'Paid and due totals come from the ledger, so they always reconcile.'], [LockKeyhole, 'Safe retries', 'Duplicate submissions are caught, so a payment is never counted twice.'], [Users, 'Private by design', 'A guardian can never see another family\'s records.']].map(([Icon, t, d]) => (
                <div className="lp-check" key={t}><span className="ico"><Icon size={18} /></span><div><b>{t}</b><span>{d}</span></div></div>))}
            </div>
          </div>
          <div className="ledger reveal" style={{ transitionDelay: '120ms' }} role="img" aria-label="Example fee ledger">
            <div className="top"><span>Invoice INV-2025-00092</span><span className="badge warn">Partly paid</span></div>
            <div className="l"><span>Term fee charged</span><span className="pos">450.00</span></div>
            <div className="l"><span>Payment by card</span><span className="neg">- 100.00</span></div>
            <div className="l"><span>Payment by UPI</span><span className="neg">- 150.00</span></div>
            <div className="l tot"><span>Outstanding</span><span>₹ 200.00</span></div>
          </div>
        </div>
      </section>

      <section className="lp-cta-band media-bg">
        <img className="bg" src={school} alt="" loading="lazy" />
        <div className="lp-wrap reveal">
          <h2>Try it with a full school of sample data</h2>
          <p>Sign in as an administrator, teacher or guardian. Everything in the demo is synthetic, so explore freely.</p>
          <Link className="btn light lg" to="/login">Open the demo</Link>
        </div>
      </section>

      <footer className="lp-foot"><div className="lp-wrap"><span>© {new Date().getFullYear()} Greenfield School Management System</span><span>The demo uses synthetic data only</span></div></footer>
    </div>
  );
}

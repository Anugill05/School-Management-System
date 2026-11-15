import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox, Loader2, Search, X } from 'lucide-react';

/* ---------- async data hook ---------- */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (id === seq.current) setState({ data, loading: false, error: null }); },
      (error) => { if (id === seq.current) setState({ data: null, loading: false, error }); },
    );
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

/** Counts a number up from 0 once, so new figures register on screen. */
export function useCountUp(target, ms = 800) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof target !== 'number' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return undefined; }
    let raf; let start;
    const step = (t) => { start ??= t; const p = Math.min(1, (t - start) / ms); setV(Math.round(target * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return typeof target === 'number' ? v : target;
}

/** Fades in any `.reveal` element the first time it scrolls into view. */
export function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll('.reveal')];
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return undefined; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' ? <AlertCircle size={18} color="var(--bad)" /> : t.kind === 'info' ? <Info size={18} color="var(--info)" /> : <CheckCircle2 size={18} color="var(--ok)" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- primitives ---------- */
export function Button({ variant, size, loading, children, icon: Icon, className = '', ...rest }) {
  return (
    <button className={`btn ${variant ?? ''} ${size ?? ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, className = '', required }) {
  const id = useId();
  const child = children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-e` : hint ? `${id}-h` : undefined });
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true" style={{ color: 'var(--bad)' }}> *</span>}</label>
      {child}
      {error ? <span className="err" id={`${id}-e`} role="alert">{error}</span> : hint ? <span className="hint" id={`${id}-h`}>{hint}</span> : null}
    </div>
  );
}
export const TextField = ({ label, error, hint, className, required, ...props }) => (
  <Field label={label} error={error} hint={hint} className={className} required={required}>{(a) => <input className="input" {...a} {...props} />}</Field>
);
export const SelectField = ({ label, error, hint, className, required, children, ...props }) => (
  <Field label={label} error={error} hint={hint} className={className} required={required}>{(a) => <select className="select" {...a} {...props}>{children}</select>}</Field>
);

export const Badge = ({ tone = '', children }) => <span className={`badge ${tone}`}>{children}</span>;
export const statusTone = { paid: 'ok', partial: 'warn', issued: 'info', void: '', published: 'ok', open: 'info', draft: '', PASS: 'ok', FAIL: 'bad', INCOMPLETE: 'warn', active: 'ok', inactive: '', graduated: 'primary', present: 'ok', absent: 'bad', late: 'warn', excused: 'info' };

export const Card = ({ title, actions, children, pad = true, className = '' }) => (
  <section className={`card ${className}`}>
    {title && <div className="card-head"><h2>{title}</h2><div className="actions">{actions}</div></div>}
    <div className={pad ? 'card-pad' : ''}>{children}</div>
  </section>
);

export function Stat({ label, value, sub, icon: Icon, tone }) {
  const shown = useCountUp(value);
  return (
    <div className="card stat">
      <div className="k">{Icon && <Icon size={16} color={tone ? `var(--${tone})` : 'var(--primary)'} />}{label}</div>
      <div className="v mono">{shown}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Empty({ title = 'Nothing here yet', children, icon: Icon = Inbox }) {
  return <div className="empty"><Icon size={36} /><b>{title}</b>{children && <span>{children}</span>}</div>;
}
export const ErrorState = ({ error, retry }) => (
  <div className="card-pad"><div className="alert" role="alert"><AlertCircle size={18} /><div style={{ flex: 1 }}>{error?.message ?? 'Failed to load'}</div>{retry && <Button size="sm" onClick={retry}>Retry</Button>}</div></div>
);
export const Skeleton = ({ rows = 5 }) => (
  <div className="card-pad" style={{ display: 'grid', gap: 14 }} aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ width: `${95 - (i % 3) * 12}%` }} />)}
  </div>
);

/** Renders loading / error / empty / content for an useAsync result. */
export function Async({ state, children, empty, isEmpty }) {
  if (state.loading && !state.data) return <Skeleton />;
  if (state.error) return <ErrorState error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  if (isEmpty?.(state.data)) return empty ?? <Empty />;
  return <div style={{ opacity: state.loading ? 0.6 : 1, transition: 'opacity .15s' }}>{children(state.data)}</div>;
}

export function SearchBox({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="search">
      <Search size={16} aria-hidden="true" />
      <input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function Pager({ meta, onPage }) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted small">Showing {from}-{to} of {meta.total}</span>
      <div className="row">
        <Button size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} icon={ChevronLeft}>Prev</Button>
        <span className="small">Page {meta.page} / {meta.pages}</span>
        <Button size="sm" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next <ChevronRight size={16} /></Button>
      </div>
    </nav>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)}>{label}</button>)}
    </div>
  );
}

/* ---------- modal (focus trap, ESC, scroll lock) ---------- */
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusable = () => el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    (el.querySelector('input:not([type=hidden]), select, textarea') ?? focusable()[0])?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = [...focusable()]; if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="btn ghost icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => { state.resolve(v); setState(null); };
  const dialog = state && (
    <Modal title={state.title} onClose={() => close(false)} footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state.confirmLabel ?? 'Confirm'}</Button></>}>
      <p style={{ margin: '4px 0 0' }}>{state.message}</p>
    </Modal>
  );
  return [confirm, dialog];
}

/** Form helper: field errors from the API's VALIDATION_ERROR response. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  async function submit(fn) {
    setBusy(true); setErrors({}); setFormError('');
    try { return await fn(values); } catch (e) {
      setErrors(e.fields ?? {});
      if (!Object.keys(e.fields ?? {}).length || e.code !== 'VALIDATION_ERROR') setFormError(e.message);
      return undefined;
    } finally { setBusy(false); }
  }
  return { values, setValues, set, errors, busy, formError, submit, setErrors };
}
export const FormError = ({ message }) => (message ? <div className="alert" role="alert"><AlertCircle size={18} />{message}</div> : null);

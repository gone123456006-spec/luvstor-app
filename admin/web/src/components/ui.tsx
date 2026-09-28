import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { mediaUrl, num } from '../format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row gap">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' | 'good'; to?: string }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{typeof value === 'number' ? num(value) : value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </>
  );
  return to ? (
    <Link to={to} className={`stat stat-link ${tone ? `tone-${tone}` : ''}`}>{body}</Link>
  ) : (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>{body}</div>
  );
}

const BADGE_TONES: Record<string, string> = {
  active: 'good', approved: 'good', captured: 'good', sent: 'good', resolved: 'good', connected: 'good', ok: 'good', actioned: 'good',
  banned: 'bad', rejected: 'bad', failed: 'bad', underage: 'bad', deleting: 'warn', pending: 'warn', open: 'warn',
  in_progress: 'info', scheduled: 'info', sending: 'info', reviewed: 'info', deactivated: 'muted', closed: 'muted',
  dismissed: 'muted', cancelled: 'muted', none: 'muted', free: 'muted',
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  const t = tone || BADGE_TONES[value] || 'info';
  return <span className={`badge badge-${t}`}>{String(value).replace(/_/g, ' ')}</span>;
}

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  explore: 'Explore Plus',
  gold: 'Gold',
  platinum: 'Platinum',
  black: 'Black',
};

export function PlanBadge({ plan }: { plan: string }) {
  const tone = ['gold', 'platinum', 'black', 'explore'].includes(plan) ? `plan-${plan}` : 'muted';
  return <span className={`badge badge-${tone}`}>{PLAN_LABELS[plan] || plan}</span>;
}

export function Avatar({ src, name, size = 32 }: { src?: string; name?: string; size?: number }) {
  const { admin } = useAuth();
  const [failed, setFailed] = useState(false);
  const url = mediaUrl(admin?.mediaBaseUrl || '', src);
  if (!url || failed) {
    return (
      <span className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
        {(name || '?').trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }
  return (
    <img className="avatar" src={url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}

export function UserChip({ user }: { user: { id: string; name?: string; email?: string; publicId?: string; photo?: string; status?: string } | null }) {
  const { can } = useAuth();
  if (!user) return <span className="muted">—</span>;
  const inner = (
    <>
      <Avatar src={user.photo} name={user.name} size={28} />
      <span className="chip-text">
        <strong>{user.name || '(no name)'}</strong>
        <span className="muted small">{user.publicId || user.email}</span>
      </span>
      {user.status && user.status !== 'active' ? (
        <Badge value={user.status === 'banned' ? 'blocked' : user.status} tone={user.status === 'banned' ? 'bad' : undefined} />
      ) : null}
    </>
  );
  return can('users.view') ? (
    <Link className="user-chip" to={`/users/${user.id}`}>{inner}</Link>
  ) : (
    <span className="user-chip">{inner}</span>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="state muted"><span className="spinner" /> {text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="state error-box">
      <span>{error}</span>
      {onRetry ? <button className="btn btn-sm" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

export function Empty({ text = 'Nothing here.' }: { text?: string }) {
  return <div className="state muted">{text}</div>;
}

export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return <div className="pager muted small">{num(total)} total</div>;
  return (
    <div className="pager">
      <span className="muted small">{num(total)} total · page {page} of {num(pages)}</span>
      <div className="row gap-sm">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { key: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Confirmation with optional required reason; resolves the async action and shows errors inline. */
export function ConfirmAction({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  reason,
  reasonRequired,
  extra,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reason?: boolean;
  reasonRequired?: boolean;
  extra?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (reasonRequired && !text.trim()) {
      setError('Please enter a reason');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{message}</div>
        {extra}
        {reason ? (
          <label className="field">
            <span>Reason{reasonRequired ? '' : ' (optional)'} — saved in the audit log</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} autoFocus />
          </label>
        ) : null}
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </Modal>
  );
}

type Toast = { id: number; text: string; tone: 'good' | 'bad' };
const ToastContext = createContext<(text: string, tone?: 'good' | 'bad') => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

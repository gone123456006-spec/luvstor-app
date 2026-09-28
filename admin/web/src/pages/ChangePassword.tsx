import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth, type Admin } from '../auth';
import { Card, PageHeader, useToast } from '../components/ui';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { setAdmin, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ admin: Admin }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setAdmin(r.admin);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed. Other sessions were signed out.');
    } catch (err: any) {
      setError(err?.message || 'Could not change password');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 380 }}>
      <label className="field">
        <span>{forced ? 'Temporary password' : 'Current password'}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="field">
        <span>New password (12+ chars, mix of upper, lower, number, symbol)</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="row gap">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        {forced ? <button type="button" className="btn" onClick={() => void logout()}>Sign out</button> : null}
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="login-wrap">
        <div className="login-card stack">
          <div>
            <h1>Set your password</h1>
            <p className="muted">You signed in with a temporary password. Choose a new one to continue.</p>
          </div>
          {form}
        </div>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="Your account" subtitle="Changing your password signs out every other session." />
      <Card title="Change password">{form}</Card>
    </>
  );
}

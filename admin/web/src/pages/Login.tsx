import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';

export default function Login() {
  const { login, verifyMfa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await login(email.trim(), password);
      if (next) {
        setMfaToken(next.mfaToken);
        setPassword('');
        setBusy(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed');
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(mfaToken, code.trim());
    } catch (err: any) {
      if (err?.code === 'MFA_EXPIRED') {
        setMfaToken(null);
        setCode('');
      }
      setError(err?.message || 'Invalid code');
      setBusy(false);
    }
  };

  const restart = () => {
    setMfaToken(null);
    setCode('');
    setUseRecovery(false);
    setError(null);
  };

  if (mfaToken) {
    return (
      <div className="login-wrap">
        <form className="login-card stack" onSubmit={submitCode}>
          <div>
            <h1>Two-factor check</h1>
            <p className="muted">
              {useRecovery
                ? 'Enter one of your saved recovery codes. Each code works only once.'
                : 'Enter the 6-digit code from your authenticator app.'}
            </p>
          </div>
          <label className="field">
            <span>{useRecovery ? 'Recovery code' : 'Authentication code'}</span>
            <input
              key={useRecovery ? 'recovery' : 'totp'}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              placeholder={useRecovery ? 'XXXX-XXXX' : '123456'}
              maxLength={useRecovery ? 9 : 6}
              value={code}
              onChange={(e) =>
                setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))
              }
              required
              autoFocus
            />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <div className="row gap">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setUseRecovery((v) => !v);
                setCode('');
                setError(null);
              }}
            >
              {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
            </button>
            <button type="button" className="btn" onClick={restart}>
              Back
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <h1>Luvstor Admin</h1>
          <p className="muted">Authorised staff only. All actions are logged.</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <div className="error-box">{error}</div> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

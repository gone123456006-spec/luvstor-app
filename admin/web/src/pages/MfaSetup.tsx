import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth, type Admin } from '../auth';
import { Badge, Card, useToast } from '../components/ui';

type SetupInfo = { secret: string; otpauthUrl: string; qr: string };

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(codes.join('\n'));
  const download = () => {
    const blob = new Blob([`Luvstor Admin recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'luvstor-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="stack">
      <p className="muted">
        Save these recovery codes somewhere safe (a password manager). Each one signs you in once if you lose your
        phone. They will not be shown again.
      </p>
      <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 14 }}>
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="row gap">
        <button type="button" className="btn" onClick={copy}>Copy</button>
        <button type="button" className="btn" onClick={download}>Download</button>
      </div>
      <label className="row gap">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I have saved my recovery codes</span>
      </label>
      <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>Continue</button>
    </div>
  );
}

/** Scan QR → confirm a code → show recovery codes */
function SetupFlow({ onEnabled }: { onEnabled: (admin: Admin) => void }) {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pendingAdmin, setPendingAdmin] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await api<SetupInfo>('/auth/mfa/setup', { method: 'POST', body: {} }));
    } catch (err: any) {
      setError(err?.message || 'Could not start setup');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ admin: Admin; recoveryCodes: string[] }>('/auth/mfa/enable', {
        method: 'POST',
        body: { code: code.trim() },
      });
      setCodes(r.recoveryCodes);
      setPendingAdmin(r.admin);
    } catch (err: any) {
      setError(err?.message || 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  };

  if (codes && pendingAdmin) return <RecoveryCodes codes={codes} onDone={() => onEnabled(pendingAdmin)} />;

  if (!info) {
    return (
      <div className="stack">
        <p className="muted">
          Use an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy. After
          setup, signing in needs your password and a 6-digit code from your phone.
        </p>
        {error ? <div className="error-box">{error}</div> : null}
        <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy}>
          {busy ? 'Starting…' : 'Set up authenticator app'}
        </button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={confirm}>
      <p className="muted">1. Scan this QR code with your authenticator app.</p>
      {info.qr ? (
        <img src={info.qr} alt="Authenticator QR code" width={200} height={200} style={{ alignSelf: 'center', borderRadius: 8 }} />
      ) : null}
      <div className="muted" style={{ fontSize: 12 }}>
        Can't scan? Enter this key manually:
        <div className="mono" style={{ fontSize: 13, wordBreak: 'break-all', marginTop: 4 }}>
          {info.secret.replace(/(.{4})/g, '$1 ').trim()}
        </div>
      </div>
      <label className="field">
        <span>2. Enter the 6-digit code shown in the app</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
        />
      </label>
      {error ? <div className="error-box">{error}</div> : null}
      <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Verifying…' : 'Turn on two-factor authentication'}
      </button>
    </form>
  );
}

/** Full-screen gate shown until the admin turns MFA on */
export default function MfaSetupForced() {
  const { setAdmin, logout } = useAuth();
  return (
    <div className="login-wrap">
      <div className="login-card stack">
        <div>
          <h1>Protect your account</h1>
          <p className="muted">Two-factor authentication is required for every admin before you can continue.</p>
        </div>
        <SetupFlow onEnabled={setAdmin} />
        <button type="button" className="btn" onClick={() => void logout()}>Sign out</button>
      </div>
    </div>
  );
}

/** Account page section: status, new recovery codes, optional turn-off */
export function MfaAccountCard() {
  const { admin, setAdmin } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'idle' | 'codes' | 'disable'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!admin) return null;

  const reset = () => {
    setMode('idle');
    setCode('');
    setPassword('');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'codes') {
        const r = await api<{ admin: Admin; recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
          method: 'POST',
          body: { code: code.trim() },
        });
        setAdmin(r.admin);
        setNewCodes(r.recoveryCodes);
      } else {
        const r = await api<{ admin: Admin }>('/auth/mfa/disable', {
          method: 'POST',
          body: { code: code.trim(), password },
        });
        setAdmin(r.admin);
        toast('Two-factor authentication turned off');
      }
      reset();
    } catch (err: any) {
      setError(err?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const status = admin.mfaEnabled ? <Badge value="On" tone="good" /> : <Badge value="Off" tone="bad" />;

  if (!admin.mfaEnabled) {
    return (
      <Card title={<span className="row gap">Two-factor authentication {status}</span>}>
        <div style={{ maxWidth: 380 }}>
          <SetupFlow
            onEnabled={(a) => {
              setAdmin(a);
              toast('Two-factor authentication is on');
            }}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title={<span className="row gap">Two-factor authentication {status}</span>}>
      <div className="stack" style={{ maxWidth: 380 }}>
        {newCodes ? (
          <RecoveryCodes codes={newCodes} onDone={() => setNewCodes(null)} />
        ) : mode === 'idle' ? (
          <>
            <p className="muted">
              Sign-in needs your password and a code from your authenticator app. Recovery codes left:{' '}
              <strong>{admin.mfaRecoveryCodesLeft}</strong>
              {admin.mfaRecoveryCodesLeft <= 3 ? ' — generate new ones soon.' : ''}
            </p>
            <div className="row gap">
              <button type="button" className="btn" onClick={() => setMode('codes')}>New recovery codes</button>
              {!admin.mfaPolicyRequired ? (
                <button type="button" className="btn btn-danger" onClick={() => setMode('disable')}>Turn off</button>
              ) : null}
            </div>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            {mode === 'disable' ? (
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
            ) : (
              <p className="muted">Old recovery codes stop working once new ones are created.</p>
            )}
            <label className="field">
              <span>Code from your authenticator app</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={mode === 'disable' ? 9 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
            </label>
            {error ? <div className="error-box">{error}</div> : null}
            <div className="row gap">
              <button className={`btn ${mode === 'disable' ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={busy}>
                {busy ? 'Working…' : mode === 'disable' ? 'Turn off' : 'Create new codes'}
              </button>
              <button type="button" className="btn" onClick={reset}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

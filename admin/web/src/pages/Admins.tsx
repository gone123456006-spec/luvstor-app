import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { Badge, Card, ConfirmAction, Empty, ErrorBox, Loading, Modal, PageHeader, useToast } from '../components/ui';
import { ago } from '../format';

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including managing admins',
  admin: 'Everything except managing admins',
  moderator: 'Trust & safety, user bans, support',
  support: 'Support tickets, user lookup, force sign-out',
  analyst: 'Overview, money and engagement (read-only)',
};

function PasswordReveal({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Temporary password" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <div>Share this with <strong>{email}</strong> through a private channel. It is shown only once, and they must choose a new password when they first sign in.</div>
        <div className="row gap">
          <span className="mono" style={{ fontSize: 16, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8 }}>{password}</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(password).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Admins() {
  const { admin: me } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<any>('/admins');
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; body: object; id: string; danger?: boolean } | null>(null);

  const patch = async (id: string, body: object) => {
    const r = await api<{ admin: any; temporaryPassword?: string }>(`/admins/${id}`, { method: 'PATCH', body });
    if (r.temporaryPassword) setReveal({ email: r.admin.email, password: r.temporaryPassword });
    else toast('Admin updated');
    reload();
  };

  return (
    <>
      <PageHeader
        title="Admins"
        subtitle="Who can access this console. Role changes, password resets and disabling sign the admin out immediately."
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}>Add admin</button>}
      />
      <Card>
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !data ? <Loading /> : null}
        {data && !data.admins.length ? <Empty /> : null}
        {data?.admins.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Admin</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {data.admins.map((a: any) => {
                  const self = a.id === me?.id;
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name || a.email}</strong>{self ? <span className="muted small"> (you)</span> : null}
                        <div className="muted small">{a.email}</div>
                      </td>
                      <td>
                        <select
                          value={a.role}
                          disabled={self}
                          aria-label="Role"
                          onChange={(e) =>
                            setConfirm({
                              id: a.id,
                              title: 'Change role',
                              message: `Change ${a.email} to ${e.target.value}? ${ROLE_HELP[e.target.value] || ''}. They will be signed out.`,
                              body: { role: e.target.value },
                            })
                          }
                        >
                          {data.roles.map((r: string) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        <Badge value={a.active ? 'active' : 'disabled'} tone={a.active ? 'good' : 'muted'} />
                        {a.lockedUntil ? <> <Badge value="locked" tone="bad" /></> : null}
                        {' '}<Badge value={a.mfaEnabled ? '2FA on' : '2FA off'} tone={a.mfaEnabled ? 'good' : 'warn'} />
                        {a.mustChangePassword ? <div className="muted small">Must set password</div> : null}
                      </td>
                      <td className="small">{a.lastLoginAt ? ago(a.lastLoginAt) : 'Never'}</td>
                      <td className="right">
                        {!self ? (
                          <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                            {a.lockedUntil ? (
                              <button className="btn btn-sm" onClick={() => void patch(a.id, { unlock: true }).catch((e) => toast(e.message, 'bad'))}>Unlock</button>
                            ) : null}
                            <button
                              className="btn btn-sm"
                              onClick={() => setConfirm({ id: a.id, title: 'Reset password', message: `Generate a new temporary password for ${a.email}? Their current sessions end.`, body: { resetPassword: true } })}
                            >
                              Reset password
                            </button>
                            {a.mfaEnabled ? (
                              <button
                                className="btn btn-sm"
                                onClick={() => setConfirm({ id: a.id, title: 'Reset two-factor', message: `Remove ${a.email}'s authenticator app (for a lost phone)? They will be signed out and must set it up again on next sign-in.`, body: { resetMfa: true } })}
                              >
                                Reset 2FA
                              </button>
                            ) : null}
                            <button
                              className={`btn btn-sm ${a.active ? 'btn-danger' : ''}`}
                              onClick={() =>
                                setConfirm({
                                  id: a.id,
                                  danger: a.active,
                                  title: a.active ? 'Disable admin' : 'Enable admin',
                                  message: a.active ? `${a.email} will be signed out and unable to sign in.` : `${a.email} will be able to sign in again.`,
                                  body: { active: !a.active },
                                })
                              }
                            >
                              {a.active ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card title="Roles">
        <table>
          <tbody>
            {Object.entries(ROLE_HELP).map(([r, h]) => (
              <tr key={r}><td style={{ width: 140 }}><strong>{r}</strong></td><td className="small">{h}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      {creating ? (
        <CreateAdmin
          roles={data?.roles || Object.keys(ROLE_HELP)}
          onClose={() => setCreating(false)}
          onCreated={(email, password) => {
            setCreating(false);
            setReveal({ email, password });
            reload();
          }}
        />
      ) : null}
      {confirm ? (
        <ConfirmAction
          title={confirm.title}
          danger={confirm.danger}
          message={confirm.message}
          onConfirm={() => patch(confirm.id, confirm.body)}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {reveal ? <PasswordReveal email={reveal.email} password={reveal.password} onClose={() => setReveal(null)} /> : null}
    </>
  );
}

function CreateAdmin({ roles, onClose, onCreated }: { roles: string[]; onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('support');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ admin: any; temporaryPassword: string }>('/admins', { method: 'POST', body: { email: email.trim(), name: name.trim(), role } });
      onCreated(r.admin.email, r.temporaryPassword);
    } catch (e: any) {
      setError(e?.message || 'Could not create admin');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add admin"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !email.trim()}>{busy ? 'Creating…' : 'Create'}</button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{r} — {ROLE_HELP[r] || ''}</option>)}
          </select>
        </label>
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </Modal>
  );
}

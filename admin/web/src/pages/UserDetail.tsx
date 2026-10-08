import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { Avatar, Badge, Card, ConfirmAction, Empty, ErrorBox, KeyValue, Loading, Modal, PageHeader, PlanBadge, Stat, UserChip, useToast } from '../components/ui';
import { platformLabel, VersionStatusBadge, type AppInfo } from '../components/AppVersion';
import { ago, dateTime, duration, label, mediaUrl, num, pct } from '../format';

type Action = 'ban' | 'unban' | 'logout' | 'tokens' | 'reset' | 'restore' | 'notify' | null;

function SendToUser({ user, onClose }: { user: { id: string; name?: string; email: string }; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!title.trim()) return setError('Title is required');
    setBusy(true);
    setError(null);
    try {
      await api('/notifications/send', { method: 'POST', body: { type: 'system', title, body, recipients: [user.id] } });
      toast(`Notification sent to ${user.name || user.email}`);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Send failed');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Send notification to ${user.name || user.email}`}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
        </label>
        <p className="muted small">Delivered as a push notification and saved in the user's in-app notification list.</p>
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </Modal>
  );
}

export default function UserDetail() {
  const { id = '' } = useParams();
  const { admin, can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<any>(`/users/${encodeURIComponent(id)}`);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState('');

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { user: u, stats } = data;
  const app: AppInfo | null = data.app || null;
  const pv = u.photoVerificationDetail || {};
  const base = admin?.mediaBaseUrl || '';

  const run = async (path: string, body: object, message: string) => {
    await api(`/users/${u.id}/${path}`, { method: 'POST', body });
    toast(message);
    reload();
  };

  return (
    <>
      <PageHeader
        title={u.name || '(no name)'}
        subtitle={`${u.email} · ${u.publicId || 'no public ID'} · joined ${dateTime(u.createdAt)}`}
        actions={
          <>
            <Link className="btn" to="/users">Back to users</Link>
            {can('users.logout') ? <button className="btn" onClick={() => setAction('logout')}>Force sign-out</button> : null}
            {can('users.tokens') ? <button className="btn" onClick={() => { setAmount(''); setAction('tokens'); }}>Adjust tokens</button> : null}
            {can('users.verification') && u.photoVerification !== 'none' ? (
              <button className="btn" onClick={() => setAction('reset')}>Reset photo check</button>
            ) : null}
            {can('users.restore') && u.status === 'deleting' ? (
              <button className="btn btn-primary" onClick={() => setAction('restore')}>Cancel deletion</button>
            ) : null}
            {can('notifications.send') ? (
              <button className="btn" onClick={() => setAction('notify')}>Send notification</button>
            ) : null}
            {can('users.ban') && u.status === 'banned' ? (
              <button className="btn btn-primary" onClick={() => setAction('unban')}>Unblock</button>
            ) : null}
            {can('users.ban') && !u.isBanned ? (
              <button className="btn btn-danger" onClick={() => setAction('ban')}>Block permanently</button>
            ) : null}
          </>
        }
      />

      {u.isBanned ? (
        <div className="error-box" style={{ marginBottom: 14 }}>
          <strong>Permanently blocked</strong> {u.bannedAt ? `on ${dateTime(u.bannedAt)}` : ''}. This account cannot sign in with Google or email OTP.
          {u.banReason ? <div className="small" style={{ marginTop: 4 }}>Reason: {u.banReason}</div> : null}
        </div>
      ) : null}

      <div className="stats">
        <Stat
          label="Status"
          value={<Badge value={u.status === 'banned' ? 'blocked' : u.status} tone={u.status === 'banned' ? 'bad' : undefined} />}
          hint={u.deletionReason ? label(u.deletionReason) : undefined}
        />
        <Stat label="Plan" value={<PlanBadge plan={u.plan} />} hint={u.subscriptionExpiresAt ? `until ${dateTime(u.subscriptionExpiresAt)}` : undefined} />
        <Stat label="Tokens" value={u.tokenBalance} />
        <Stat label="Reports against" value={stats.reportsReceived} tone={stats.reportsReceived ? 'warn' : undefined} />
        <Stat label="Blocked by" value={stats.blockedBy} tone={stats.blockedBy >= 3 ? 'bad' : undefined} />
        <Stat label="Calls" value={stats.calls} />
        <Stat label="Messages sent" value={stats.messagesSent} />
        <Stat label="Friends / matches" value={`${num(stats.friends)} / ${num(stats.matches)}`} />
      </div>

      <div className="grid grid-2">
        <Card title="Profile">
          <div className="row gap" style={{ marginBottom: 12 }}>
            <Avatar src={u.photo} name={u.name} size={64} />
            <div>
              <div><strong>{u.name}</strong>{u.age ? `, ${u.age}` : ''} <span className="muted">{u.gender}</span></div>
              <div className="muted small">{u.isOnline ? 'Online now' : `Last seen ${ago(u.lastSeen)}`}</div>
            </div>
          </div>
          <KeyValue
            rows={[
              ['Bio', u.bio || <span className="muted">—</span>],
              ['Interests', u.interests.length ? u.interests.join(', ') : <span className="muted">—</span>],
              ['Relationship goal', u.relationshipGoal || '—'],
              ['Height', u.height ? `${u.height} cm` : '—'],
              ['Show me', u.showMe || '—'],
              ['Profile setup', u.profileCompleted ? 'Completed' : 'Not completed'],
              ['Open streak', `${num(u.openStreakDays)} days`],
            ]}
          />
          {u.photos.length ? (
            <div className="photo-grid" style={{ marginTop: 12 }}>
              {u.photos.map((p: string, i: number) => (
                <a key={i} href={mediaUrl(base, p)} target="_blank" rel="noreferrer noopener">
                  <img src={mediaUrl(base, p)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </a>
              ))}
            </div>
          ) : null}
        </Card>

        <Card title="Account">
          <KeyValue
            rows={[
              ['User ID', <span className="mono">{u.id}</span>],
              ['Login method', u.authProvider],
              ['Bound device', u.activeDeviceId ? `${u.activeDeviceId} · ${ago(u.activeDeviceBoundAt)}` : 'None'],
              [
                'App version',
                app?.version ? (
                  <>
                    <span className="mono">{app.version}</span>
                    {app.build ? <span className="muted small"> (build {app.build})</span> : null}
                    {app.platform ? <span className="muted small"> · {platformLabel(app.platform)}</span> : null}{' '}
                    <VersionStatusBadge status={app.status} />
                    <div className="muted small">
                      {app.status === 'outdated' && app.latest ? `Latest is ${app.latest}. ` : ''}
                      {app.source === 'push'
                        ? 'From push registration (older app build)'
                        : app.seenAt
                          ? `Seen ${ago(app.seenAt)}`
                          : ''}
                    </div>
                  </>
                ) : (
                  <span className="muted">Unknown — hasn't opened a build that reports its version</span>
                ),
              ],
              ['Photo check', <><Badge value={u.photoVerification} />{pv.matchScore != null ? <span className="muted small"> match {pct(pv.matchScore > 1 ? pv.matchScore / 100 : pv.matchScore)}</span> : null}</>],
              ['Photo check note', pv.reviewNote || '—'],
              ['Referral code', u.referralCode || '—'],
              ['Referred by', u.referredBy ? <UserChip user={u.referredBy} /> : '—'],
              ['Successful referrals', num(stats.referralsMade)],
              ['Reports made', num(stats.reportsMade)],
              ['10-token packs bought', num(u.tokenPack10PurchaseCount)],
              ['Welcome tokens', u.welcomeTokensGrantedAt ? dateTime(u.welcomeTokensGrantedAt) : 'Not granted'],
              ['Deletion scheduled', u.deletionScheduledAt ? dateTime(u.deletionScheduledAt) : '—'],
              ['Last updated', dateTime(u.updatedAt)],
            ]}
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Recent reports">
          {data.reports.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Direction</th><th>Reason</th><th>Status</th></tr></thead>
                <tbody>
                  {data.reports.map((r: any) => (
                    <tr key={r.id}>
                      <td className="small">{ago(r.createdAt)}</td>
                      <td className="small">
                        {r.reported?.id === u.id ? <>by <UserChip user={r.reporter} /></> : <>against <UserChip user={r.reported} /></>}
                      </td>
                      <td className="small" title={r.details}>{label(r.reason)}</td>
                      <td><Badge value={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No reports." />}
        </Card>

        <Card title="Recent calls">
          {data.calls.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>With</th><th>Type</th><th>Result</th><th className="num">Length</th></tr></thead>
                <tbody>
                  {data.calls.map((c: any) => (
                    <tr key={c.id}>
                      <td className="small">{ago(c.startedAt)}</td>
                      <td className="small">{c.direction === 'outgoing' ? '→ ' : '← '}<UserChip user={c.other} /></td>
                      <td className="small">{c.type}</td>
                      <td><Badge value={c.status} />{c.endReason ? <span className="muted small"> {label(c.endReason)}</span> : null}</td>
                      <td className="num small">{duration(c.durationSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No calls." />}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Devices">
          {data.devices.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Device</th><th>App</th><th>Push</th><th>Last used</th></tr></thead>
                <tbody>
                  {data.devices.map((d: any) => (
                    <tr key={d.id}>
                      <td className="small">{d.deviceName || d.platform}</td>
                      <td className="small">{d.appVersion || '—'}</td>
                      <td><Badge value={d.active ? 'active' : 'inactive'} tone={d.active ? 'good' : 'muted'} /></td>
                      <td className="small">{ago(d.lastUsedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No registered devices." />}
        </Card>

        <Card title="Support tickets">
          {data.tickets.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Subject</th><th>Status</th><th>Opened</th></tr></thead>
                <tbody>
                  {data.tickets.map((t: any) => (
                    <tr key={t.id}>
                      <td className="small">{can('support.view') ? <Link to={`/support?ticket=${t.id}`}>{t.ticketNumber}</Link> : t.ticketNumber}</td>
                      <td className="small">{t.subject}</td>
                      <td><Badge value={t.status} /></td>
                      <td className="small">{ago(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No tickets." />}
        </Card>
      </div>

      {action === 'ban' ? (
        <ConfirmAction
          title="Block permanently"
          danger
          confirmLabel="Block permanently"
          reason
          reasonRequired
          message={
            <>
              <strong>{u.name || u.email}</strong> is signed out of the app right away and can never sign in again with this
              account ({u.authProvider === 'google' ? 'Google' : 'email'} login <span className="mono">{u.email}</span>). The profile is hidden from everyone.
            </>
          }
          onConfirm={(reason) => run('ban', { reason }, 'User permanently blocked')}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action === 'unban' ? (
        <ConfirmAction
          title="Unblock user"
          confirmLabel="Unblock"
          reason
          message="The user can sign in again and their profile becomes visible."
          onConfirm={(reason) => run('unban', { reason }, 'User unblocked')}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action === 'notify' ? <SendToUser user={u} onClose={() => setAction(null)} /> : null}
      {action === 'logout' ? (
        <ConfirmAction
          title="Force sign-out"
          confirmLabel="Sign out everywhere"
          reason
          message="Ends the user's app session and stops push notifications to their devices until they sign in again. Takes effect within about a minute."
          onConfirm={(reason) => run('force-logout', { reason }, 'User signed out')}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action === 'tokens' ? (
        <ConfirmAction
          title="Adjust tokens"
          confirmLabel="Apply"
          reason
          reasonRequired
          message={<>Current balance: <strong>{num(u.tokenBalance)}</strong>. Use a negative number to deduct.</>}
          extra={
            <label className="field">
              <span>Amount (e.g. 20 or -10)</span>
              <input type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          }
          onConfirm={async (reason) => {
            const n = Number(amount);
            if (!Number.isInteger(n) || n === 0) throw new Error('Enter a non-zero whole number');
            await run('tokens', { amount: n, reason }, `Tokens ${n > 0 ? 'added' : 'deducted'}`);
          }}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action === 'reset' ? (
        <ConfirmAction
          title="Reset photo verification"
          confirmLabel="Reset"
          reason
          message="Clears the verified badge so the user can submit a new selfie. Verification tokens already granted are not granted again."
          onConfirm={(reason) => run('reset-verification', { reason }, 'Photo verification reset')}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action === 'restore' ? (
        <ConfirmAction
          title="Cancel scheduled deletion"
          confirmLabel="Restore account"
          message="The account will not be deleted and becomes active again."
          onConfirm={() => run('restore', {}, 'Account restored')}
          onClose={() => setAction(null)}
        />
      ) : null}
    </>
  );
}

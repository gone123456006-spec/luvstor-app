import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced } from '../hooks';
import { Avatar, Badge, Card, ConfirmAction, Empty, ErrorBox, KeyValue, Loading, Modal, PageHeader, Pager, Stat, Tabs, UserChip, useToast } from '../components/ui';
import { ago, dateTime, label, num } from '../format';

type Tab = 'send' | 'broadcast' | 'campaigns' | 'delivery';
type Meta = { types: string[]; segments: { key: string; label: string }[] };
type Message = { type: string; title: string; body: string; deepLink: string };

const EMPTY: Message = { type: 'system', title: '', body: '', deepLink: '' };

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.luvstor.app';
const APP_UPDATE: Message = {
  type: 'system',
  title: '🔔 New update available',
  body: "We've made some improvements to make your experience better. Update the app to enjoy the latest features and fixes. 😊",
  deepLink: PLAY_STORE_URL,
};

function linkTarget(link: string): string {
  if (!link) return 'Notifications screen';
  if (link === PLAY_STORE_URL) return 'Luvstor on Google Play';
  if (/^https:\/\//i.test(link)) return link;
  return `App screen ${link}`;
}

export default function Notifications() {
  const [tab, setTab] = useState<Tab>('send');
  const meta = useApi<Meta>('/notifications/meta');
  return (
    <>
      <PageHeader title="Notifications" subtitle="Push and in-app notifications, delivered through the app's own notification service." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'send', label: 'Individual users' },
          { key: 'broadcast', label: 'All users' },
          { key: 'campaigns', label: 'Scheduled' },
          { key: 'delivery', label: 'Delivery health' },
        ]}
      />
      {meta.error ? <ErrorBox error={meta.error} onRetry={meta.reload} /> : null}
      {!meta.data ? (meta.loading ? <Loading /> : null) : (
        <>
          {tab === 'send' ? <SendDirect meta={meta.data} /> : null}
          {tab === 'broadcast' ? <Broadcast meta={meta.data} /> : null}
          {tab === 'campaigns' ? <Campaigns meta={meta.data} /> : null}
          {tab === 'delivery' ? <Delivery /> : null}
        </>
      )}
    </>
  );
}

function MessageFields({ meta, value, onChange }: { meta: Meta; value: Message; onChange: (m: Message) => void }) {
  const set = (k: keyof Message) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <div className="row gap-sm wrap">
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...APP_UPDATE })}>
          App update template
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange({ ...value, deepLink: PLAY_STORE_URL })}
          disabled={value.deepLink === PLAY_STORE_URL}
        >
          Open Play Store on tap
        </button>
      </div>
      <label className="field">
        <span>Type</span>
        <select value={value.type} onChange={set('type')}>
          {meta.types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Title ({value.title.length}/200)</span>
        <input value={value.title} onChange={set('title')} maxLength={200} required />
      </label>
      <label className="field">
        <span>Message ({value.body.length}/1000)</span>
        <textarea rows={4} value={value.body} onChange={set('body')} maxLength={1000} />
      </label>
      <label className="field">
        <span>Link (optional, e.g. /support, luvstor://… or a Play Store https:// URL)</span>
        <input value={value.deepLink} onChange={set('deepLink')} maxLength={300} placeholder="/" />
      </label>
    </>
  );
}

function Preview({ m }: { m: Message }) {
  return (
    <div className="note">
      <div className="muted small">Preview</div>
      <strong>{m.title || 'Title'}</strong>
      <div className="small">{m.body || <span className="muted">Message body</span>}</div>
      <div className="muted small">Tap opens: {linkTarget(m.deepLink)}</div>
    </div>
  );
}

type Picked = { id: string; name?: string; email?: string; publicId?: string; photo?: string };

function UserPicker({ picked, onChange }: { picked: Picked[]; onChange: (p: Picked[]) => void }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const enabled = can('users.view') && debounced.trim().length >= 2;
  const { data, loading } = useApi<any>(enabled ? `/users${qs({ q: debounced.trim(), status: 'active' })}` : null);
  if (!can('users.view')) return null;
  const add = (u: Picked) => {
    if (!picked.some((p) => p.id === u.id)) onChange([...picked, u]);
    setQ('');
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field">
        <span>Find a user by name, email or public ID</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing…" />
      </label>
      {enabled ? (
        <div className="suggest">
          {loading && !data ? <div className="muted small" style={{ padding: 8 }}>Searching…</div> : null}
          {data && !data.users.length ? <div className="muted small" style={{ padding: 8 }}>No matching users</div> : null}
          {data?.users.slice(0, 8).map((u: any) => (
            <button key={u.id} type="button" onClick={() => add(u)} disabled={picked.some((p) => p.id === u.id)}>
              <Avatar src={u.photo} name={u.name} size={24} />
              <span><strong>{u.name || '(no name)'}</strong> <span className="muted small">{u.publicId || u.email}</span></span>
            </button>
          ))}
        </div>
      ) : null}
      {picked.length ? (
        <div className="chips">
          {picked.map((p) => (
            <span key={p.id} className="chip active">
              {p.name || p.email || p.id}
              <button
                type="button"
                aria-label={`Remove ${p.name || p.email}`}
                onClick={() => onChange(picked.filter((x) => x.id !== p.id))}
                style={{ background: 'none', border: 0, color: 'inherit', marginLeft: 6, cursor: 'pointer' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SendDirect({ meta }: { meta: Meta }) {
  const { can } = useAuth();
  const toast = useToast();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [recipients, setRecipients] = useState('');
  const [msg, setMsg] = useState<Message>(EMPTY);
  const [confirm, setConfirm] = useState(false);
  const all = [...new Set([...picked.map((p) => p.id), ...recipients.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)])];
  const count = all.length;

  if (!can('notifications.send')) return <div className="info-box">Your role can view but not send notifications.</div>;

  return (
    <div className="grid grid-2">
      <Card title="Send to individual users">
        <div className="stack">
          <UserPicker picked={picked} onChange={setPicked} />
          <label className="field">
            <span>Or paste emails, public IDs (ABCD1234) or user IDs, separated by commas or new lines ({count}/1000 total)</span>
            <textarea rows={2} value={recipients} onChange={(e) => setRecipients(e.target.value)} />
          </label>
          <MessageFields meta={meta} value={msg} onChange={setMsg} />
          <div>
            <button className="btn btn-primary" disabled={!count || !msg.title.trim()} onClick={() => setConfirm(true)}>
              Review & send
            </button>
          </div>
        </div>
      </Card>
      <Card title="Before you send">
        <Preview m={msg} />
        <ul className="small muted">
          <li>Notifications respect each user's notification settings in the app.</li>
          <li>Unknown recipients are skipped; you'll see how many matched.</li>
          <li>Each admin can send up to 30 notification batches per hour.</li>
        </ul>
      </Card>
      {confirm ? (
        <ConfirmAction
          title="Send notification"
          confirmLabel={`Send to ${count} recipient${count === 1 ? '' : 's'}`}
          message={<Preview m={msg} />}
          onConfirm={async () => {
            const r = await api<{ matched: number; requested: number }>('/notifications/send', {
              method: 'POST',
              body: { ...msg, recipients: all },
            });
            toast(`Sent to ${r.matched} of ${r.requested} recipients`);
            setMsg(EMPTY);
            setRecipients('');
            setPicked([]);
          }}
          onClose={() => setConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function useAudience(segment: string) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setCount(null);
    setError(null);
    if (!segment) return;
    api<{ count: number }>(`/notifications/audience${qs({ segment })}`)
      .then((r) => alive && setCount(r.count))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [segment]);
  return { count, error };
}

function Broadcast({ meta }: { meta: Meta }) {
  const { can } = useAuth();
  const toast = useToast();
  const [segment, setSegment] = useState('all');
  const [msg, setMsg] = useState<Message>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audience = useAudience(segment);
  const segLabel = meta.segments.find((s) => s.key === segment)?.label || segment;

  if (!can('notifications.send')) return <div className="info-box">Your role can view but not send notifications.</div>;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ audience: number }>('/notifications/broadcast', { method: 'POST', body: { ...msg, segment, confirm: 'SEND' } });
      toast(`Sending to about ${num(r.audience)} users`);
      setOpen(false);
      setMsg(EMPTY);
    } catch (e: any) {
      setError(e?.message || 'Broadcast failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <Card title="Send to all users at once">
        <div className="stack">
          <MessageFields meta={meta} value={msg} onChange={setMsg} />
          <label className="field">
            <span>Audience</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {meta.segments.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <span className="small muted">
              {audience.error ? audience.error : audience.count == null ? 'Counting…' : `About ${num(audience.count)} accounts (blocked and deactivated accounts are excluded)`}
            </span>
          </label>
          <div>
            <button className="btn btn-primary" disabled={!msg.title.trim() || !audience.count} onClick={() => { setError(null); setOpen(true); }}>
              {segment === 'all' ? 'Send to all users' : `Send to "${segLabel}"`}
            </button>
          </div>
        </div>
      </Card>
      <Card title="Preview">
        <Preview m={msg} />
        <div className="warn-box" style={{ marginTop: 12 }}>
          Broadcasts cannot be recalled once sent. Use "Scheduled" to plan campaigns ahead.
        </div>
        <p className="muted small">
          The app server allows 5 broadcasts per hour in total (broadcasts, scheduled campaigns and digest runs combined).
          Users who turned off this notification type in the app are skipped.
        </p>
      </Card>
      {open ? (
        <Modal
          title="Confirm broadcast"
          onClose={busy ? () => undefined : () => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn btn-danger" onClick={send} disabled={busy} autoFocus>
                {busy ? 'Sending…' : `Yes, send to ${num(audience.count || 0)} users`}
              </button>
            </>
          }
        >
          <div className="stack">
            <div>This will notify <strong>about {num(audience.count || 0)} users</strong> in "{segLabel}". It cannot be recalled.</div>
            <Preview m={msg} />
            {error ? <div className="error-box">{error}</div> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Campaigns({ meta }: { meta: Meta }) {
  const { can } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<any>(null);
  const { data, error, loading, reload } = useApi<any>(`/notifications/campaigns${qs({ page })}`);
  const segLabel = (k: string) => meta.segments.find((s) => s.key === k)?.label || k;

  return (
    <Card
      title="Scheduled campaigns"
      actions={can('notifications.send') ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>New campaign</button> : null}
    >
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.campaigns.length ? <Empty text="No campaigns yet." /> : null}
      {data?.campaigns.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Audience</th><th>Send at</th><th>Status</th><th>Created by</th><th /></tr></thead>
            <tbody>
              {data.campaigns.map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.title}</strong>
                    <div className="muted small">{c.body}</div>
                  </td>
                  <td className="small">{segLabel(c.segment)}{c.audienceAtSend != null ? <div className="muted">{num(c.audienceAtSend)} users</div> : null}</td>
                  <td className="small">{dateTime(c.sendAt)}</td>
                  <td><Badge value={c.status} />{c.error ? <div className="muted small">{c.error}</div> : null}</td>
                  <td className="small">{c.createdByEmail}</td>
                  <td className="right">
                    {c.status === 'scheduled' && can('notifications.send') ? (
                      <button className="btn btn-sm" onClick={() => setCancelling(c)}>Cancel</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}

      {creating ? <CreateCampaign meta={meta} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); toast('Campaign scheduled'); }} /> : null}
      {cancelling ? (
        <ConfirmAction
          title="Cancel campaign"
          confirmLabel="Cancel campaign"
          danger
          message={<>"{cancelling.title}" will not be sent.</>}
          onConfirm={async () => {
            await api(`/notifications/campaigns/${cancelling.id}/cancel`, { method: 'POST' });
            toast('Campaign cancelled');
            reload();
          }}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </Card>
  );
}

function CreateCampaign({ meta, onClose, onCreated }: { meta: Meta; onClose: () => void; onCreated: () => void }) {
  const [msg, setMsg] = useState<Message>(EMPTY);
  const [segment, setSegment] = useState('active7d');
  const [sendAt, setSendAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audience = useAudience(segment);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/notifications/campaigns', {
        method: 'POST',
        body: { ...msg, segment, sendAt: new Date(sendAt).toISOString() },
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || 'Could not schedule');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New scheduled campaign"
      wide
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !msg.title.trim() || !sendAt}>{busy ? 'Scheduling…' : 'Schedule'}</button>
        </>
      }
    >
      <div className="grid grid-2">
        <div className="stack">
          <label className="field">
            <span>Audience</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {meta.segments.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <span className="small muted">{audience.count == null ? 'Counting…' : `Currently about ${num(audience.count)} users (recounted at send time)`}</span>
          </label>
          <label className="field">
            <span>Send at (your local time)</span>
            <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
          </label>
          <Preview m={msg} />
        </div>
        <div className="stack">
          <MessageFields meta={meta} value={msg} onChange={setMsg} />
        </div>
      </div>
      {error ? <div className="error-box" style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}

function Delivery() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const health = useApi<any>('/notifications/health');
  const logs = useApi<any>(`/notifications/logs${qs({ status })}`);
  const [running, setRunning] = useState(false);
  const [digest, setDigest] = useState<Record<string, unknown> | null>(null);

  const runDigest = async () => {
    setRunning(true);
    try {
      const r = await api<Record<string, unknown>>('/notifications/daily-suggestions', { method: 'POST', body: {} });
      setDigest(r || {});
      toast('Daily suggestions run finished');
    } catch (e: any) {
      toast(e?.message || 'Run failed', 'bad');
    } finally {
      setRunning(false);
    }
  };

  const h = health.data;
  return (
    <>
      {health.error ? <ErrorBox error={health.error} onRetry={health.reload} /> : null}
      {h ? (
        <div className="stats">
          <Stat label="Push (FCM)" value={h.fcmEnabled ? 'Enabled' : 'Disabled'} tone={h.fcmEnabled ? 'good' : 'bad'} />
          <Stat label="Queued" value={h.logs?.queued ?? 0} tone={(h.logs?.queued || 0) > 500 ? 'warn' : undefined} />
          <Stat label="Sent (30 days)" value={h.logs?.sent ?? 0} />
          <Stat label="Failed (30 days)" value={h.logs?.failed ?? 0} tone={h.logs?.failed ? 'warn' : undefined} />
        </div>
      ) : null}

      {can('notifications.send') ? (
        <Card title="Daily suggestions digest">
          <div className="row gap wrap">
            <span className="muted small">Runs today's "people you may like" digest now. Users already notified today are skipped automatically.</span>
            <span className="spacer" />
            <button className="btn" onClick={runDigest} disabled={running}>{running ? 'Running… (can take a minute)' : 'Run now'}</button>
          </div>
          {digest ? (
            <div style={{ marginTop: 12 }}>
              <KeyValue rows={Object.entries(digest).map(([k, v]) => [label(k), typeof v === 'object' ? JSON.stringify(v) : String(v)])} />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="Recent deliveries"
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All</option>
            <option value="failed">Failed</option>
            <option value="partial">Partial</option>
            <option value="skipped">Skipped</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
          </select>
        }
      >
        {logs.error ? <ErrorBox error={logs.error} onRetry={logs.reload} /> : null}
        {logs.loading && !logs.data ? <Loading /> : null}
        {logs.data && !logs.data.logs.length ? <Empty text="No delivery records." /> : null}
        {logs.data?.logs.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Type</th><th>Status</th><th className="num">Devices ok / failed</th><th>Error</th><th>When</th></tr></thead>
              <tbody>
                {logs.data.logs.map((l: any) => (
                  <tr key={l.id}>
                    <td><UserChip user={l.user} /></td>
                    <td className="small">{label(l.type)} · {l.channel}</td>
                    <td><Badge value={l.status} tone={l.status === 'partial' ? 'warn' : l.status === 'skipped' ? 'muted' : undefined} /></td>
                    <td className="num small">{num(l.successCount)} / {num(l.failureCount)}</td>
                    <td className="small">{l.error || l.errorCodes.join(', ') || '—'}</td>
                    <td className="small" title={dateTime(l.createdAt)}>{ago(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}

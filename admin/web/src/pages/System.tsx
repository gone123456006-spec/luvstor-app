import type { ReactNode } from 'react';
import { useApi } from '../hooks';
import { Card, ErrorBox, KeyValue, Loading, PageHeader, Stat } from '../components/ui';
import { ago, label, num } from '../format';

type Probe = { ok: boolean; status: number; ms: number; data?: any; error?: string };

function Dot({ ok, warn }: { ok: boolean | null | undefined; warn?: boolean }) {
  const color = ok == null ? 'var(--muted)' : ok ? (warn ? 'var(--warn)' : 'var(--good)') : 'var(--bad)';
  return <span className="health-dot" style={{ background: color }} />;
}

function probeText(p: Probe) {
  if (p.error) return p.error;
  return `HTTP ${p.status} · ${num(p.ms)} ms`;
}

function flatRows(obj: Record<string, unknown> | null | undefined): [ReactNode, ReactNode][] {
  if (!obj || typeof obj !== 'object') return [['Status', 'Unavailable']];
  return Object.entries(obj).map(([k, v]) => [
    label(k),
    typeof v === 'boolean' ? (
      <><Dot ok={v} /> {v ? 'Yes' : 'No'}</>
    ) : v == null ? '—' : typeof v === 'object' ? <span className="mono">{JSON.stringify(v)}</span> : String(v),
  ]);
}

function uptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default function System() {
  const { data, error, loading, reload } = useApi<any>('/system/health');

  if (loading && !data) return <Loading text="Checking services (the app server may take a moment to wake up)…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { admin, mainApi, integrations: i, realtime, collections } = data;
  const push = i.push || {};
  const smtpOk = i.smtp ? i.smtp.configured && i.smtp.verified !== false && !i.smtp.devMode : null;

  return (
    <>
      <PageHeader
        title="System health"
        subtitle={`Checked ${ago(data.checkedAt)}`}
        actions={<button className="btn" onClick={reload} disabled={loading}>{loading ? 'Checking…' : 'Check again'}</button>}
      />

      <div className="stats">
        <Stat label="App server" value={<><Dot ok={mainApi.health.ok} /> {mainApi.health.ok ? 'Up' : 'Down'}</>} hint={probeText(mainApi.health)} tone={mainApi.health.ok ? undefined : 'bad'} />
        <Stat label="App ready" value={<><Dot ok={mainApi.ready.ok} /> {mainApi.ready.ok ? 'Ready' : 'Not ready'}</>} hint={probeText(mainApi.ready)} tone={mainApi.ready.ok ? undefined : 'bad'} />
        <Stat label="Database" value={<><Dot ok={admin.dbState === 'connected'} /> {admin.dbState}</>} hint={admin.dbPingMs != null ? `ping ${admin.dbPingMs} ms` : 'ping failed'} tone={admin.dbState === 'connected' ? undefined : 'bad'} />
        <Stat label="Push (FCM)" value={<><Dot ok={push.error ? false : push.fcmEnabled} /> {push.error ? 'Unknown' : push.fcmEnabled ? 'Enabled' : 'Disabled'}</>} hint={push.error} tone={push.fcmEnabled && !push.error ? undefined : 'bad'} />
        <Stat label="Email (OTP)" value={<><Dot ok={smtpOk} /> {i.smtp ? (smtpOk ? 'Working' : 'Check config') : 'Unknown'}</>} hint={i.smtp?.mode} tone={smtpOk === false ? 'warn' : undefined} />
        <Stat label="Google sign-in" value={<><Dot ok={i.firebaseAdmin} /> {i.firebaseAdmin ? 'Ready' : 'Check config'}</>} tone={i.firebaseAdmin === false ? 'warn' : undefined} />
      </div>

      <div className="stats">
        <Stat label="Live calls" value={realtime.liveCalls} />
        <Stat label="Stuck call records" value={realtime.stuckCalls} tone={realtime.stuckCalls ? 'warn' : undefined} hint="Still 'live' after 3+ hours" />
        <Stat label="Active push devices" value={realtime.activePushTokens} />
        <Stat label="Users" value={collections.users} />
        <Stat label="Messages" value={collections.messages} />
        <Stat label="Calls (all time)" value={collections.calls} />
      </div>

      <div className="grid grid-3">
        <Card title="App server">
          <KeyValue
            rows={[
              ['URL', <span className="mono">{mainApi.url}</span>],
              ['/health', <><Dot ok={mainApi.health.ok} /> {probeText(mainApi.health)}</>],
              ['/ready', <><Dot ok={mainApi.ready.ok} /> {probeText(mainApi.ready)}</>],
              ...flatRows(mainApi.ready.data && typeof mainApi.ready.data === 'object' ? mainApi.ready.data : null).slice(0, 8),
            ]}
          />
        </Card>
        <Card title="Integrations">
          <h3>Google sign-in</h3>
          <KeyValue rows={[['Firebase Admin', <><Dot ok={i.firebaseAdmin} /> {i.firebaseAdmin == null ? '—' : i.firebaseAdmin ? 'Ready' : 'Not ready'}</>], ...flatRows(i.google)]} />
          <div className="section-gap" />
          <h3>Email</h3>
          <KeyValue rows={flatRows(i.smtp)} />
          <div className="section-gap" />
          <h3>Push queue</h3>
          <KeyValue rows={push.error ? [['Error', push.error]] : flatRows(push.logs)} />
          <div className="section-gap" />
          <KeyValue rows={[['Razorpay (admin read-only)', <><Dot ok={i.razorpayConfigured} /> {i.razorpayConfigured ? 'Configured' : 'Not configured'}</>]]} />
        </Card>
        <Card title="Admin service">
          <KeyValue
            rows={[
              ['Uptime', uptime(admin.uptimeSec)],
              ['Node', admin.node],
              ['Memory', `${num(admin.rssMb)} MB (heap ${num(admin.heapMb)} MB)`],
              ['Database', admin.dbState],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

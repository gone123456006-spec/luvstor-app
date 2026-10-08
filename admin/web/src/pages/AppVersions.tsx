import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { Card, Empty, ErrorBox, Loading, PageHeader, Pager, Stat, Tabs, UserChip, useToast } from '../components/ui';
import { platformLabel, VersionStatusBadge, type AppInfo } from '../components/AppVersion';
import { ago, num } from '../format';

type Status = 'all' | 'outdated' | 'latest' | 'unknown';
type Counts = { total: number; latest: number; outdated: number; unknown: number };
type Summary = {
  activeDays: string;
  latest: string | null;
  latestSource: 'manual' | 'detected' | 'none';
  detectedLatest: string | null;
  setting: { version: string | null; updatedAt: string; updatedByEmail: string } | null;
  counts: Counts;
  percent: { latest: number; outdated: number; unknown: number };
  fromPush: number;
  byPlatform: Record<string, Counts>;
  versions: { version: string | null; status: AppInfo['status']; count: number; ios: number; android: number; other: number }[];
};

const WINDOWS = [
  { key: '1', label: 'Active today' },
  { key: '7', label: 'Active in 7 days' },
  { key: '30', label: 'Active in 30 days' },
  { key: '90', label: 'Active in 90 days' },
  { key: 'all', label: 'All accounts' },
];

function LatestVersionCard({ summary, onSaved }: { summary: Summary; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(summary.setting?.version || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(summary.setting?.version || ''), [summary.setting?.version]);

  const save = async (version: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api('/versions/latest', { method: 'PUT', body: { version } });
      toast(version ? `Latest version set to ${version}` : 'Using the highest version seen');
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Latest version">
      <div className="stack" style={{ maxWidth: 420 }}>
        <p className="muted small">
          Users below this version count as outdated. Set it when a new build goes live on the stores; leave it empty to
          use the highest version seen{summary.detectedLatest ? ` (${summary.detectedLatest})` : ''}.
        </p>
        <div className="row gap">
          <input
            placeholder={summary.detectedLatest || '1.0.6'}
            value={value}
            onChange={(e) => setValue(e.target.value.trim())}
            style={{ maxWidth: 140 }}
            aria-label="Latest version"
          />
          <button className="btn btn-primary" disabled={busy || !value || value === summary.setting?.version} onClick={() => void save(value)}>
            Save
          </button>
          {summary.setting?.version ? (
            <button className="btn" disabled={busy} onClick={() => void save(null)}>Use highest seen</button>
          ) : null}
        </div>
        {summary.setting?.version ? (
          <div className="muted small">
            Set by {summary.setting.updatedByEmail || 'an admin'} {ago(summary.setting.updatedAt)}
          </div>
        ) : null}
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </Card>
  );
}

function share(n: number, total: number) {
  return total ? `${Math.round((n / total) * 1000) / 10}%` : '0%';
}

export default function AppVersions() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [activeDays, setActiveDays] = useState('30');
  const [status, setStatus] = useState<Status>('outdated');
  const [version, setVersion] = useState<string | null>(null);
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);

  const summary = useApi<Summary>(`/versions/summary${qs({ activeDays })}`);
  const list = useApi<any>(
    `/versions/users${qs({ activeDays, status: version ? 'all' : status, version: version || undefined, platform, page })}`,
  );

  useEffect(() => setPage(1), [activeDays, status, version, platform]);

  const s = summary.data;
  const reloadAll = () => {
    summary.reload();
    list.reload();
  };

  return (
    <>
      <PageHeader
        title="App versions"
        subtitle="Which app version your users run, and who still needs to update."
        actions={
          <select value={activeDays} onChange={(e) => setActiveDays(e.target.value)} aria-label="Audience">
            {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        }
      />

      {summary.error ? <ErrorBox error={summary.error} onRetry={summary.reload} /> : null}
      {summary.loading && !s ? <Loading /> : null}

      {s ? (
        <>
          <div className="stats">
            <Stat
              label="Latest version"
              value={s.latest || '—'}
              hint={s.latestSource === 'manual' ? 'Set by admin' : s.latestSource === 'detected' ? 'Highest seen' : 'No data yet'}
            />
            <Stat label="Users counted" value={num(s.counts.total)} hint={WINDOWS.find((w) => w.key === activeDays)?.label} />
            <Stat label="Up to date" value={num(s.counts.latest)} hint={`${s.percent.latest}% of users`} tone="good" />
            <Stat label="Not updated" value={num(s.counts.outdated)} hint={`${s.percent.outdated}% on an older version`} tone={s.counts.outdated ? 'warn' : undefined} />
            <Stat label="Version unknown" value={num(s.counts.unknown)} hint={`${s.percent.unknown}% — no version reported yet`} />
          </div>

          <div className="grid grid-2" style={{ marginBottom: 14 }}>
            <Card title="Versions in use">
              {!s.versions.length ? (
                <Empty text="No users in this audience." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Version</th><th>Status</th><th className="num">Users</th><th className="num">Share</th><th className="num">Android</th><th className="num">iOS</th></tr>
                    </thead>
                    <tbody>
                      {s.versions.map((v) => (
                        <tr
                          key={v.version || 'unknown'}
                          className="clickable"
                          onClick={() => {
                            if (v.version) setVersion(v.version);
                            else {
                              setVersion(null);
                              setStatus('unknown');
                            }
                          }}
                        >
                          <td className="mono">{v.version || 'Unknown'}</td>
                          <td><VersionStatusBadge status={v.status} /></td>
                          <td className="num">{num(v.count)}</td>
                          <td className="num">{share(v.count, s.counts.total)}</td>
                          <td className="num">{num(v.android)}</td>
                          <td className="num">{num(v.ios)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {s.fromPush ? (
                <div className="muted small" style={{ marginTop: 8 }}>
                  {num(s.fromPush)} users' versions come from their push registration because they haven't opened a
                  build that reports it on every request yet.
                </div>
              ) : null}
            </Card>

            <div className="stack">
              {can('versions.manage') ? <LatestVersionCard summary={s} onSaved={reloadAll} /> : null}
              <Card title="By platform">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Platform</th><th className="num">Users</th><th className="num">Up to date</th><th className="num">Not updated</th><th className="num">Unknown</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(s.byPlatform).map(([p, c]) => (
                        <tr key={p}>
                          <td>{platformLabel(p) || 'Unknown'}</td>
                          <td className="num">{num(c.total)}</td>
                          <td className="num">{num(c.latest)}</td>
                          <td className="num">{num(c.outdated)}</td>
                          <td className="num">{num(c.unknown)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        </>
      ) : null}

      <Card
        title={version ? `Users on ${version}` : 'Users'}
        actions={
          <div className="row gap">
            {version ? <button className="btn btn-sm" onClick={() => setVersion(null)}>Clear version filter</button> : null}
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
              <option value="">All platforms</option>
              <option value="android">Android</option>
              <option value="ios">iOS</option>
            </select>
          </div>
        }
      >
        {!version ? (
          <Tabs
            value={status}
            onChange={setStatus}
            tabs={[
              { key: 'outdated', label: `Not updated${s ? ` (${num(s.counts.outdated)})` : ''}` },
              { key: 'latest', label: `Up to date${s ? ` (${num(s.counts.latest)})` : ''}` },
              { key: 'unknown', label: `Unknown${s ? ` (${num(s.counts.unknown)})` : ''}` },
              { key: 'all', label: 'All' },
            ]}
          />
        ) : null}
        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && !list.data.users.length ? <Empty text="No users match." /> : null}
        {list.data?.users.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>User</th><th>Version</th><th>Status</th><th>Platform</th><th>Version seen</th><th>Last active</th></tr>
                </thead>
                <tbody>
                  {list.data.users.map((u: any) => (
                    <tr key={u.id} className="clickable" onClick={() => navigate(`/users/${u.id}`)}>
                      <td><UserChip user={{ ...u, status: undefined }} /></td>
                      <td className="mono">
                        {u.app.version || '—'}
                        {u.app.build ? <span className="muted small"> ({u.app.build})</span> : null}
                      </td>
                      <td><VersionStatusBadge status={u.app.status} /></td>
                      <td className="small">{platformLabel(u.app.platform) || '—'}</td>
                      <td className="small">
                        {u.app.source === 'push' ? <span className="muted">push registration</span> : u.app.seenAt ? ago(u.app.seenAt) : '—'}
                      </td>
                      <td className="small">{u.isOnline ? 'Online' : ago(u.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}

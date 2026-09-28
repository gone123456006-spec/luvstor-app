import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Pager } from '../components/ui';
import { ago, dateTime } from '../format';

const ACTION_GROUPS = [
  ['', 'All actions'],
  ['auth.', 'Sign-ins'],
  ['users.', 'User actions'],
  ['moderation.', 'Moderation'],
  ['support.', 'Support'],
  ['notifications.', 'Notifications'],
  ['admins.', 'Admin management'],
];

function Details({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details || {});
  if (!entries.length) return <span className="muted">—</span>;
  return (
    <span className="small">
      {entries.map(([k, v]) => (
        <span key={k} style={{ marginRight: 10 }}>
          <span className="muted">{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </span>
  );
}

export default function Audit() {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedTarget = useDebounced(target.trim());
  const { data, error, loading, reload } = useApi<any>(
    `/audit${qs({ action, targetId: debouncedTarget, failed: failed ? 'true' : '', page })}`,
  );

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every admin sign-in and action, kept for accountability. Entries cannot be edited." />
      <Card>
        <div className="toolbar">
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action">
            {ACTION_GROUPS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="Target ID (user, report, ticket…)" value={target} onChange={(e) => { setTarget(e.target.value); setPage(1); }} aria-label="Target ID" />
          <label className="row gap-sm small">
            <input type="checkbox" checked={failed} onChange={(e) => { setFailed(e.target.checked); setPage(1); }} />
            Failed only
          </label>
        </div>
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !data ? <Loading /> : null}
        {data && !data.entries.length ? <Empty text="No entries." /> : null}
        {data?.entries.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>
                {data.entries.map((e: any) => (
                  <tr key={e.id}>
                    <td className="small" title={dateTime(e.createdAt)}>{ago(e.createdAt)}</td>
                    <td className="small">{e.adminEmail || '—'}</td>
                    <td>
                      <span className="mono">{e.action}</span>
                      {!e.success ? <> <Badge value="failed" /></> : null}
                    </td>
                    <td className="small">
                      {e.targetType === 'user' && e.targetId ? (
                        <Link to={`/users/${e.targetId}`} className="mono">{e.targetId}</Link>
                      ) : e.targetId ? (
                        <span className="mono">{e.targetType}:{e.targetId}</span>
                      ) : e.targetType || '—'}
                    </td>
                    <td><Details details={e.details} /></td>
                    <td className="mono">{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}
      </Card>
    </>
  );
}

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Pager, PlanBadge, Stat, UserChip } from '../components/ui';
import { ago, dateOnly, num } from '../format';

function UserStats({ onStatus }: { onStatus: (status: string) => void }) {
  const { data } = useApi<any>('/users/summary');
  if (!data) return null;
  return (
    <div className="stats">
      <Stat label="Total users" value={data.total} hint={`${num(data.newToday)} joined today`} />
      <Stat label="Online now" value={data.onlineNow} tone="good" />
      <Stat label="Active today" value={data.active24h} hint="Opened the app in the last 24h" />
      <Stat label="Active this week" value={data.active7d} hint={`${num(data.active30d)} in the last 30 days`} />
      <Stat label="Finished profile" value={data.profileCompleted} />
      <button className="stat stat-link" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => onStatus('banned')}>
        <div className="stat-label">Blocked users</div>
        <div className="stat-value" style={{ color: data.banned ? 'var(--bad)' : undefined }}>{num(data.banned)}</div>
        <div className="stat-hint">Click to list them</div>
      </button>
    </div>
  );
}

export default function Users() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const debounced = useDebounced(q);
  const status = params.get('status') || '';
  const provider = params.get('provider') || '';
  const verification = params.get('verification') || '';
  const plan = params.get('plan') || '';
  const sort = params.get('sort') || 'newest';
  const page = Number(params.get('page') || 1);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, error, loading, reload } = useApi<any>(
    `/users${qs({ q: debounced, status, provider, verification, plan, sort, page })}`,
  );

  return (
    <>
      <PageHeader title="Users" subtitle="Search by name, email, public ID (ABCD1234) or user ID. Click a user for full details." />
      <UserStats onStatus={(s) => set('status', s)} />
      <Card>
        <div className="toolbar">
          <input type="search" placeholder="Search users…" value={q} onChange={(e) => { setQ(e.target.value); set('page', ''); }} aria-label="Search users" />
          <select value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="banned">Blocked</option>
            <option value="deleting">Deletion scheduled</option>
            <option value="deactivated">Deactivated</option>
          </select>
          <select value={provider} onChange={(e) => set('provider', e.target.value)} aria-label="Login method">
            <option value="">Any login</option>
            <option value="google">Google</option>
            <option value="email">Email</option>
          </select>
          <select value={verification} onChange={(e) => set('verification', e.target.value)} aria-label="Photo verification">
            <option value="">Any verification</option>
            <option value="approved">Photo verified</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
            <option value="none">Not submitted</option>
          </select>
          <select value={plan} onChange={(e) => set('plan', e.target.value)} aria-label="Plan">
            <option value="">Any plan</option>
            <option value="paid">Any paid plan</option>
            <option value="explore">Explore Plus</option>
            <option value="gold">Gold</option>
            <option value="platinum">Platinum</option>
            <option value="black">Black</option>
          </select>
          <select value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="lastSeen">Recently active</option>
            <option value="tokens">Most tokens</option>
          </select>
        </div>

        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !data ? <Loading /> : null}
        {data && !data.users.length ? <Empty text="No users match these filters." /> : null}
        {data?.users.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Login</th>
                  <th>Plan</th>
                  <th>Photo check</th>
                  <th className="num">Tokens</th>
                  <th>Last seen</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u: any) => (
                  <tr key={u.id} className="clickable" onClick={() => navigate(`/users/${u.id}`)}>
                    <td><UserChip user={{ ...u, status: undefined }} /></td>
                    <td><Badge value={u.status === 'banned' ? 'blocked' : u.status} tone={u.status === 'banned' ? 'bad' : undefined} />{!u.profileCompleted ? <span className="muted small"> · no profile</span> : null}</td>
                    <td className="small">{u.authProvider}</td>
                    <td><PlanBadge plan={u.plan} /></td>
                    <td><Badge value={u.photoVerification} /></td>
                    <td className="num">{num(u.tokenBalance)}</td>
                    <td className="small">{u.isOnline ? <Badge value="online" tone="good" /> : ago(u.lastSeen)}</td>
                    <td className="small">{dateOnly(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => set('page', String(p))} /> : null}
      </Card>
    </>
  );
}

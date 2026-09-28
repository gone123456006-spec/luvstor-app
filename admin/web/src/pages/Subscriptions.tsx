import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { Card, Empty, ErrorBox, Loading, PageHeader, Pager, PlanBadge, Stat, Tabs, UserChip } from '../components/ui';
import { ago, dateOnly, dateTime, inr, num } from '../format';

type Tab = 'subscribers' | 'subscriptionPurchases' | 'tokenPurchases';

const PLANS = [
  { key: '', label: 'All plans' },
  { key: 'explore', label: 'Explore Plus' },
  { key: 'gold', label: 'Gold' },
  { key: 'platinum', label: 'Platinum' },
  { key: 'black', label: 'Black' },
];

const PERIODS = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: '365', label: 'Last year' },
  { key: 'all', label: 'All time' },
];

export default function Subscriptions() {
  const [params, setParams] = useSearchParams();
  const tab = (['subscribers', 'subscriptionPurchases', 'tokenPurchases'].includes(params.get('tab') || '')
    ? params.get('tab')
    : 'subscribers') as Tab;
  const plan = PLANS.some((p) => p.key === params.get('plan')) ? params.get('plan') || '' : '';
  const summary = useApi<any>('/subscriptions/summary');

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const s = summary.data;
  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Who is subscribed, on which plan, and every subscription and token purchase." />
      {summary.error ? <ErrorBox error={summary.error} onRetry={summary.reload} /> : null}
      {s ? (
        <div className="stats">
          <Stat label="Active subscribers" value={s.activeTotal} tone="good" />
          {PLANS.slice(1).map((p) => (
            <Stat key={p.key} label={p.label} value={s.plans[p.key]?.active ?? 0} hint={`${num(s.plans[p.key]?.expired ?? 0)} expired`} />
          ))}
          <Stat label="Expiring in 7 days" value={s.expiring7d} tone={s.expiring7d ? 'warn' : undefined} />
          <Stat label="Token buyers" value={s.tokenBuyers} hint="Users who bought tokens at least once" />
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={(t) => set('tab', t === 'subscribers' ? '' : t)}
        tabs={[
          { key: 'subscribers', label: 'Subscribed users' },
          { key: 'subscriptionPurchases', label: 'Subscription purchases' },
          { key: 'tokenPurchases', label: 'Token purchases' },
        ]}
      />

      {tab !== 'tokenPurchases' ? (
        <div className="chips" role="group" aria-label="Plan filter" style={{ marginBottom: 12 }}>
          {PLANS.map((p) => {
            const count = !s ? null : p.key ? s.plans[p.key]?.active : s.activeTotal;
            return (
              <button key={p.key || 'all'} className={`chip ${plan === p.key ? 'active' : ''}`} onClick={() => set('plan', p.key)}>
                {p.label}
                {count != null && tab === 'subscribers' ? <span className="chip-count">{num(count)}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {tab === 'subscribers' ? <Subscribers key={plan} plan={plan} /> : null}
      {tab === 'subscriptionPurchases' ? <Purchases key={`sub-${plan}`} kind="subscription" plan={plan} /> : null}
      {tab === 'tokenPurchases' ? <Purchases key="tokens" kind="tokens" plan="" /> : null}
    </>
  );
}

function Subscribers({ plan }: { plan: string }) {
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q);
  const { data, error, loading, reload } = useApi<any>(`/subscriptions/subscribers${qs({ plan, status, q: debounced, page })}`);

  return (
    <Card>
      <div className="toolbar">
        <input type="search" placeholder="Search subscribers…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search subscribers" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Subscription status">
          <option value="active">Active</option>
          <option value="expiring">Expiring in 7 days</option>
          <option value="expired">Expired</option>
          <option value="all">All</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={reload}>Refresh</button>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.subscribers.length ? <Empty text="No subscribers match these filters." /> : null}
      {data?.subscribers.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Expires</th>
                <th className="num">Days left</th>
                <th className="num">Tokens</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.subscribers.map((r: any) => (
                <tr key={r.user.id}>
                  <td><UserChip user={r.user} /></td>
                  <td><PlanBadge plan={r.planId} /></td>
                  <td>
                    <span className={`badge badge-${r.active ? (r.daysLeft <= 7 ? 'warn' : 'good') : 'muted'}`}>
                      {r.active ? (r.daysLeft <= 7 ? 'expiring' : 'active') : 'expired'}
                    </span>
                  </td>
                  <td className="small" title={dateTime(r.expiresAt)}>{r.expiresAt ? dateOnly(r.expiresAt) : '—'}</td>
                  <td className="num">{r.active ? num(r.daysLeft) : '—'}</td>
                  <td className="num">{num(r.user.tokenBalance)}</td>
                  <td className="small">{dateOnly(r.user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}
    </Card>
  );
}

function Purchases({ kind, plan }: { kind: 'subscription' | 'tokens'; plan: string }) {
  const [days, setDays] = useState('30');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/subscriptions/purchases${qs({ kind, plan, days, page })}`);

  return (
    <Card>
      <div className="toolbar">
        {data?.configured !== false ? (
          <select value={days} onChange={(e) => { setDays(e.target.value); setPage(1); }} aria-label="Period">
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        ) : null}
        {data?.configured ? (
          <span className="muted small">
            {num(data.total)} purchases · <strong>{inr(data.totalAmount)}</strong>
          </span>
        ) : null}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={reload} disabled={loading}>Refresh</button>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading text="Fetching paid orders from Razorpay…" /> : null}
      {data?.truncated ? (
        <div className="warn-box" style={{ marginBottom: 12 }}>Only the most recent 5,000 orders were loaded; older purchases in this period are not listed.</div>
      ) : null}

      {data && data.configured === false ? (
        <>
          <div className="info-box" style={{ marginBottom: 12 }}>
            Razorpay keys are not configured for the admin service, so full purchase history is unavailable. Set{' '}
            <span className="mono">RAZORPAY_KEY_ID</span> and <span className="mono">RAZORPAY_KEY_SECRET</span> to see every purchase with amounts.
            {kind === 'tokens' ? ' Below: users who have bought tokens, with their latest payment.' : ''}
          </div>
          {kind === 'tokens' && data.buyers?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>User</th><th>Latest payment</th><th className="num">10-token packs bought</th><th className="num">Token balance</th><th>Last seen</th></tr>
                </thead>
                <tbody>
                  {data.buyers.map((b: any) => (
                    <tr key={b.user.id}>
                      <td><UserChip user={b.user} /></td>
                      <td className="mono small">{b.lastPaymentId}</td>
                      <td className="num">{num(b.pack10Purchases)}</td>
                      <td className="num">{num(b.user.tokenBalance)}</td>
                      <td className="small">{ago(b.user.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : kind === 'tokens' ? <Empty text="No token purchases yet." /> : null}
          {kind === 'tokens' ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}
        </>
      ) : null}

      {data?.configured && !data.purchases.length ? <Empty text="No purchases in this period." /> : null}
      {data?.configured && data.purchases.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>{kind === 'tokens' ? 'Pack' : 'Plan'}</th>
                <th className="num">Amount</th>
                <th>Order</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.map((p: any) => (
                <tr key={p.orderId}>
                  <td><UserChip user={p.user} /></td>
                  <td>
                    {kind === 'tokens' ? (
                      <strong>{num(p.tokens || Number(p.packId) || 0)} tokens</strong>
                    ) : (
                      <>
                        <PlanBadge plan={p.planId} />
                        {p.periodId ? <span className="muted small"> · {p.periodId}</span> : null}
                      </>
                    )}
                  </td>
                  <td className="num">{inr(p.amount)}</td>
                  <td className="mono small">{p.orderId}</td>
                  <td className="small" title={dateTime(p.createdAt)}>{ago(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data?.configured ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}
    </Card>
  );
}

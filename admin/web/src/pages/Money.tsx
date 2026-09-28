import { useState } from 'react';
import { qs } from '../api';
import { useApi } from '../hooks';
import { AreaChart, BarList } from '../components/charts';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, PLAN_LABELS, Stat, Tabs, UserChip } from '../components/ui';
import { ago, dateTime, inr, num, pct } from '../format';

type Tab = 'revenue' | 'payments' | 'tokens' | 'referrals';

export default function Money() {
  const [tab, setTab] = useState<Tab>('revenue');
  return (
    <>
      <PageHeader title="Revenue" subtitle="Total revenue from subscriptions and token packs, payments, the token economy and referrals." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'revenue', label: 'Total revenue' },
          { key: 'payments', label: 'Payments' },
          { key: 'tokens', label: 'Token economy' },
          { key: 'referrals', label: 'Referrals' },
        ]}
      />
      {tab === 'revenue' ? <Revenue /> : null}
      {tab === 'payments' ? <Payments /> : null}
      {tab === 'tokens' ? <Tokens /> : null}
      {tab === 'referrals' ? <Referrals /> : null}
    </>
  );
}

function NotConfigured() {
  return (
    <div className="info-box">
      Razorpay keys are not configured for the admin service. Set <span className="mono">RAZORPAY_KEY_ID</span> and{' '}
      <span className="mono">RAZORPAY_KEY_SECRET</span> (read-only use) to see revenue and payments.
    </div>
  );
}

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '1 year' },
  { key: 'all', label: 'All time' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] || ''} ${ym.slice(2, 4)}`;

function amounts(rows: Record<string, { amount: number }>, name: (key: string) => string) {
  return Object.entries(rows || {}).map(([key, v]) => ({ label: name(key), value: v.amount }));
}

function Revenue() {
  const [range, setRange] = useState('30');
  const { data, error, loading, reload } = useApi<any>(`/money/revenue${qs({ range })}`);
  const current = RANGES.find((r) => r.key === range)!;

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.key} className={`chip ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={reload} disabled={loading}>Refresh</button>
      </div>
      {loading && !data ? <Loading text="Fetching paid orders from Razorpay…" /> : null}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data && !data.configured ? <NotConfigured /> : null}
      {data?.configured ? (
        <>
          {data.truncated ? (
            <div className="warn-box" style={{ marginBottom: 14 }}>Only the most recent 5,000 orders were counted; the total for this period may be higher.</div>
          ) : null}
          <div className="stats">
            <Stat label={`Total revenue · ${current.label.toLowerCase()}`} value={inr(data.total)} tone="good" hint={`${num(data.orders)} paid orders`} />
            <Stat label="Subscriptions" value={inr(data.subscriptions.amount)} hint={`${num(data.subscriptions.count)} purchases`} />
            <Stat label="Token packs" value={inr(data.tokens.amount)} hint={`${num(data.tokens.count)} purchases`} />
            <Stat label="Paying users" value={data.payers} />
            <Stat label="Average order" value={data.orders ? inr(data.averageOrder) : '—'} />
            {data.other.count ? <Stat label="Other orders" value={inr(data.other.amount)} hint={`${num(data.other.count)} without plan/pack notes`} /> : null}
          </div>
          <Card title={data.series.unit === 'month' ? 'Revenue by month' : 'Revenue by day'}>
            <AreaChart
              series={data.series.points}
              format={inr}
              axisLabel={data.series.unit === 'month' ? monthLabel : undefined}
            />
          </Card>
          <div className="grid grid-2">
            <Card title="Subscription revenue by plan">
              <BarList data={amounts(data.byPlan, (k) => PLAN_LABELS[k] || k)} format={inr} />
            </Card>
            <Card title="Token revenue by pack">
              <BarList data={amounts(data.byPack, (k) => (/^\d+$/.test(k) ? `${num(Number(k))} tokens` : k))} format={inr} />
            </Card>
          </div>
          <p className="muted small">
            Gross amount of paid Razorpay orders (refunds are not deducted). Days are counted in UTC. Figures refresh every 5 minutes.
          </p>
        </>
      ) : null}
    </>
  );
}

function PaymentHealth() {
  const { data } = useApi<any>('/money/payment-stats?days=30');
  if (!data?.configured) return null;
  return (
    <div className="stats">
      <Stat label="Captured · 30 days" value={data.captured} />
      <Stat label="Failed · 30 days" value={data.failed} tone={data.failed ? 'warn' : undefined} />
      <Stat label="Success rate" value={pct(data.successRate)} />
      <Stat label="Refunded" value={data.refunded} />
    </div>
  );
}

function Payments() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/money/payments${qs({ status, page })}`);

  return (
    <>
    <PaymentHealth />
    <Card>
      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="captured">Captured</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
          <option value="authorized">Authorized (not captured)</option>
        </select>
        <span className="muted small">Last 30 days, newest first</span>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.configured ? <NotConfigured /> : null}
      {data?.configured && !data.payments.length ? <Empty text="No payments." /> : null}
      {data?.payments?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Method</th>
                <th>Customer</th>
                <th>Description</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p: any) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td className="num">{inr(p.amount)}</td>
                  <td>
                    <Badge value={p.status} />
                    {p.errorReason ? <div className="muted small">{p.errorReason}</div> : null}
                  </td>
                  <td className="small">{p.method || '—'}</td>
                  <td className="small">{p.email || p.contact || '—'}</td>
                  <td className="small">{p.description || Object.values(p.notes || {}).join(' · ') || '—'}</td>
                  <td className="small" title={dateTime(p.createdAt)}>{ago(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data?.configured ? (
        <div className="pager">
          <span className="muted small">Page {page}</span>
          <div className="row gap-sm">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn btn-sm" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      ) : null}
    </Card>
    </>
  );
}

function Tokens() {
  const { data, error, loading, reload } = useApi<any>('/money/summary');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { subscriptions: s, tokens: t } = data;
  return (
    <>
      <div className="stats">
        <Stat label="Active subscriptions" value={s.active} />
        <Stat label="Expiring in 7 days" value={s.expiringIn7Days} tone={s.expiringIn7Days ? 'warn' : undefined} />
        <Stat label="Tokens in circulation" value={t.circulating} />
        <Stat label="Users holding tokens" value={t.holders} />
        <Stat label="10-token packs sold" value={t.packPurchases} />
        <Stat label="Free tokens granted (est.)" value={t.freeGrantedTotal} />
      </div>
      <div className="grid grid-2">
        <Card title="Subscriptions by plan">
          <BarList data={s.byPlan} />
        </Card>
        <Card title="Free tokens granted by source">
          <BarList
            data={{
              'Welcome bonus': t.freeGranted.welcome,
              'Photo verification': t.freeGranted.photoVerification,
              'Gallery posts': t.freeGranted.galleryPosts,
              Referrals: t.freeGranted.referrals,
            }}
          />
          <p className="muted small" style={{ marginTop: 10 }}>
            Estimated from one-time grant records. Spin rewards and subscription allowances are not included.
          </p>
        </Card>
      </div>
    </>
  );
}

function Referrals() {
  const { data, error, loading, reload } = useApi<any>('/money/referrals');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <>
      {data.suspicious.length ? (
        <div className="warn-box" style={{ marginBottom: 14 }}>
          {data.suspicious.length} user{data.suspicious.length > 1 ? 's' : ''} referred 10+ people in the last 24 hours. Check for fake accounts.
        </div>
      ) : null}
      <div className="grid grid-3">
        <Card title="Referrals · last 30 days" className="span-2">
          <AreaChart series={data.series} />
        </Card>
        <Card title="Flags">
          <Stat label="Revoked referrals (all time)" value={data.revoked} />
          <div className="section-gap" />
          {data.suspicious.length ? (
            <div className="stack">
              {data.suspicious.map((s: any) => (
                <div key={s.user.id} className="row gap">
                  <UserChip user={s.user} />
                  <Badge value={`${s.referrals24h} in 24h`} tone="bad" />
                </div>
              ))}
            </div>
          ) : <Empty text="No referral bursts." />}
        </Card>
      </div>
      <Card title="Top referrers">
        {data.leaders.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th className="num">Referrals</th><th className="num">Tokens earned</th><th>Latest</th></tr></thead>
              <tbody>
                {data.leaders.map((l: any) => (
                  <tr key={l.user.id}>
                    <td><UserChip user={l.user} /></td>
                    <td className="num">{num(l.referrals)}</td>
                    <td className="num">{num(l.tokens)}</td>
                    <td className="small">{ago(l.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="No rewarded referrals yet." />}
      </Card>
    </>
  );
}

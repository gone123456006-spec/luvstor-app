import { useState } from 'react';
import { qs } from '../api';
import { useApi } from '../hooks';
import { AreaChart, BarList, Funnel } from '../components/charts';
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat, Tabs, UserChip } from '../components/ui';
import { dateOnly, duration, num, pct } from '../format';

type Tab = 'funnel' | 'retention' | 'calls' | 'links';

export default function Engagement() {
  const [tab, setTab] = useState<Tab>('funnel');
  const [days, setDays] = useState(30);
  return (
    <>
      <PageHeader
        title="Engagement & growth"
        subtitle="How new users move through the app and whether they come back."
        actions={
          tab === 'funnel' || tab === 'calls' ? (
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          ) : null
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'funnel', label: 'Funnel' },
          { key: 'retention', label: 'Retention' },
          { key: 'calls', label: 'Calls' },
          { key: 'links', label: 'Share links' },
        ]}
      />
      {tab === 'funnel' ? <FunnelTab days={days} /> : null}
      {tab === 'retention' ? <Retention /> : null}
      {tab === 'calls' ? <Calls days={days} /> : null}
      {tab === 'links' ? <Links /> : null}
    </>
  );
}

function FunnelTab({ days }: { days: number }) {
  const { data, error, loading, reload } = useApi<any>(`/engagement/funnel${qs({ days })}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <Card title={`Activity funnel · last ${data.days} days`}>
      <Funnel steps={data.steps} />
      <p className="muted small" style={{ marginTop: 12 }}>
        Signups and profile setup count new users only. Later steps count all activity in the period, so percentages
        between them are ratios rather than strict conversion.
      </p>
    </Card>
  );
}

function Retention() {
  const { data, error, loading, reload } = useApi<any>('/engagement/retention?weeks=12');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const cell = (n: number | null, size: number) => {
    if (n == null) return <td className="num muted">—</td>;
    const r = size ? n / size : 0;
    return (
      <td className="num" style={{ background: `rgba(108, 76, 230, ${Math.min(0.08 + r * 0.6, 0.68)})`, color: r > 0.5 ? '#fff' : undefined }}>
        {pct(r)}
      </td>
    );
  };
  return (
    <Card title="Weekly signup cohorts">
      {data.cohorts.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th className="num">Signups</th>
                <th className="num">Finished profile</th>
                <th className="num">Back after 1 day</th>
                <th className="num">Back after 7 days</th>
                <th className="num">Back after 30 days</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c: any) => (
                <tr key={c.week}>
                  <td>{dateOnly(c.week)}</td>
                  <td className="num">{num(c.size)}</td>
                  {cell(c.profileCompleted, c.size)}
                  {cell(c.d1, c.size)}
                  {cell(c.d7, c.size)}
                  {cell(c.d30, c.size)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty text="No signups in this period." />}
      <p className="muted small" style={{ marginTop: 12 }}>
        "Back after N days" means the user's last activity was at least N days after they signed up. Cells stay empty
        until the cohort is old enough to measure.
      </p>
    </Card>
  );
}

function Calls({ days }: { days: number }) {
  const { data, error, loading, reload } = useApi<any>(`/engagement/calls${qs({ days })}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const missed = data.byStatus.missed || 0;
  return (
    <>
      <div className="stats">
        <Stat label="Calls" value={data.total} />
        <Stat label="Answered" value={data.answered} />
        <Stat label="Answer rate" value={pct(data.answerRate)} tone={data.answerRate != null && data.answerRate < 0.3 ? 'warn' : undefined} />
        <Stat label="Average length" value={duration(data.avgDurationSec)} />
        <Stat label="Total talk time" value={`${num(data.totalTalkMinutes)} min`} />
        <Stat label="Missed" value={missed} hint={`${num(data.byStatus.rejected || 0)} declined · ${num(data.byStatus.failed || 0)} failed`} />
      </div>
      <div className="grid grid-3">
        <Card title="Calls per day (purple) vs answered (green)" className="span-2">
          <AreaChart series={data.series} secondary={data.answeredSeries} />
        </Card>
        <Card title="Call type">
          <BarList data={data.byType} />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card title="Final status">
          <BarList data={data.byStatus} />
        </Card>
        <Card title="Why calls ended">
          <BarList data={data.byEndReason} />
        </Card>
      </div>
    </>
  );
}

function Links() {
  const { data, error, loading, reload } = useApi<any>('/engagement/links');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const types = Object.entries(data.byType as Record<string, { links: number; clicks: number }>);
  return (
    <div className="grid grid-3">
      <Card title="Clicks by link type">
        <BarList data={Object.fromEntries(types.map(([k, v]) => [k, v.clicks]))} />
        <div className="section-gap" />
        <div className="muted small">
          {types.map(([k, v]) => `${k}: ${num(v.links)} links`).join(' · ') || 'No links yet.'}
        </div>
      </Card>
      <Card title="Most clicked links" className="span-2">
        {data.top.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Link</th><th>Type</th><th>Owner</th><th className="num">Clicks</th><th>Created</th></tr></thead>
              <tbody>
                {data.top.map((l: any) => (
                  <tr key={l.slug}>
                    <td className="mono">/{l.slug}</td>
                    <td className="small">{l.type}</td>
                    <td>{l.owner ? <UserChip user={l.owner} /> : <span className="muted">—</span>}</td>
                    <td className="num">{num(l.clicks)}</td>
                    <td className="small">{dateOnly(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="No share links yet." />}
      </Card>
    </div>
  );
}

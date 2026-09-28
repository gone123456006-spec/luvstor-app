import { useApi } from '../hooks';
import { useAuth } from '../auth';
import { AreaChart, BarList } from '../components/charts';
import { Card, ErrorBox, Loading, PageHeader, Stat } from '../components/ui';
import { ago, inr, num, pct } from '../format';

export default function Overview() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<any>('/overview');

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { users, queues, subscriptions, activity, revenue } = data;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Updated ${ago(data.generatedAt)} · figures refresh every minute`}
        actions={<button className="btn" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      />

      <div className="stats">
        <Stat label="Open reports" value={queues.openReports} tone={queues.openReports ? 'warn' : undefined} to={can('moderation.view') ? '/moderation' : undefined} />
        <Stat label="Pending photo checks" value={queues.pendingVerifications} tone={queues.pendingVerifications ? 'warn' : undefined} to={can('moderation.view') ? '/moderation?tab=verification' : undefined} />
        <Stat label="Open support tickets" value={queues.openTickets} tone={queues.openTickets ? 'warn' : undefined} to={can('support.view') ? '/support' : undefined} />
        <Stat label="Online now" value={users.onlineNow} tone="good" />
      </div>

      <div className="stats">
        <Stat label="Total users" value={users.total} />
        <Stat label="Signups today" value={users.signupsToday} hint={`${num(users.signupsWeek)} this week · ${num(users.signupsMonth)} in 30 days`} />
        <Stat label="Daily active" value={users.dau} hint={`${num(users.wau)} weekly · ${num(users.mau)} monthly`} />
        <Stat label="Finished profile setup" value={pct(users.profileCompletionRate)} hint={`${num(users.profileCompleted)} of ${num(users.total)}`} />
        <Stat label="Active subscriptions" value={subscriptions.active} />
        <Stat label="Calls today" value={activity.callsToday} hint={`${num(activity.liveCalls)} live now`} />
        <Stat label="Messages today" value={activity.messagesToday} />
        {revenue ? (
          revenue.configured === false ? (
            <Stat label="Revenue" value="—" hint="Add Razorpay keys to enable" />
          ) : revenue.error ? (
            <Stat label="Revenue" value="—" hint={revenue.error} tone="bad" />
          ) : (
            <Stat label="Revenue today" value={inr(revenue.revenueToday)} hint={`${inr(revenue.revenueMonth)} in 30 days`} tone="good" to="/money" />
          )
        ) : null}
      </div>

      <div className="grid grid-3">
        <Card title="Signups · last 30 days" className="span-2">
          <AreaChart series={data.signupsSeries} />
        </Card>
        <Card title="Login method">
          <BarList data={{ Google: users.byProvider.google, Email: users.byProvider.email }} />
          <div className="section-gap" />
          <h2 style={{ marginBottom: 10 }}>Subscriptions by plan</h2>
          <BarList data={subscriptions.byPlan} />
        </Card>
      </div>
    </>
  );
}

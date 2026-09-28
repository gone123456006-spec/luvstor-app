import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { AreaChart, BarList } from '../components/charts';
import { Badge, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Pager, Tabs, UserChip, useToast } from '../components/ui';
import { ago, dateTime, label, mediaUrl, num } from '../format';

type Tab = 'reports' | 'verification' | 'risk';

export default function Moderation() {
  const [params, setParams] = useSearchParams();
  const tab = (['reports', 'verification', 'risk'].includes(params.get('tab') || '') ? params.get('tab') : 'reports') as Tab;
  const setTab = (t: Tab) => setParams(t === 'reports' ? {} : { tab: t }, { replace: true });

  return (
    <>
      <PageHeader title="Reports & safety" subtitle="Who reported whom, permanent blocks, photo verification and risk signals." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'reports', label: 'Reports' },
          { key: 'verification', label: 'Photo verification' },
          { key: 'risk', label: 'Risk signals' },
        ]}
      />
      {tab === 'reports' ? <Reports /> : null}
      {tab === 'verification' ? <Verifications /> : null}
      {tab === 'risk' ? <Risk /> : null}
    </>
  );
}

// ── Reports ────────────────────────────────────────────────────────────
function Reports() {
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<any>(null);
  const stats = useApi<any>('/moderation/reports/stats');
  const list = useApi<any>(`/moderation/reports${qs({ status, reason, page })}`);

  return (
    <>
      {stats.data ? (
        <div className="grid grid-3">
          <Card title="Reports · last 30 days" className="span-2">
            <AreaChart series={stats.data.series} />
          </Card>
          <Card title="Open reports by reason">
            <BarList data={stats.data.openByReason} />
          </Card>
        </div>
      ) : null}

      <Card>
        <div className="toolbar">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="open">Open ({num(stats.data?.byStatus?.open || 0)})</option>
            <option value="reviewed">Reviewed</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <select value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }} aria-label="Reason">
            <option value="">Any reason</option>
            {['underage', 'harassment', 'inappropriate', 'fake_profile', 'spam', 'other'].map((r) => (
              <option key={r} value={r}>{label(r)}</option>
            ))}
          </select>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={list.reload}>Refresh</button>
        </div>

        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && !list.data.reports.length ? <Empty text="No reports in this queue." /> : null}
        {list.data?.reports.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reported user</th>
                  <th>Reason</th>
                  <th>Details</th>
                  <th>Reporter</th>
                  <th>History</th>
                  <th>Status</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.reports.map((r: any) => (
                  <tr key={r.id}>
                    <td><UserChip user={r.reported} /></td>
                    <td><Badge value={r.reason} tone={r.reason === 'underage' ? 'bad' : r.reason === 'harassment' ? 'warn' : 'info'} /></td>
                    <td className="small" style={{ maxWidth: 260 }}>{r.details || <span className="muted">—</span>}</td>
                    <td><UserChip user={r.reporter} /></td>
                    <td className="small">
                      {num(r.reportedHistory.total)} reports
                      <div className="muted">{num(r.reportedHistory.distinctReporters)} people</div>
                    </td>
                    <td><Badge value={r.status} />{r.actionTaken !== 'none' ? <div className="muted small">{label(r.actionTaken)}</div> : null}</td>
                    <td className="small">{ago(r.createdAt)}</td>
                    <td className="right">
                      {can('moderation.act') ? (
                        <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm" onClick={() => setActive({ report: r })}>Review</button>
                          {r.reported && r.reported.status !== 'banned' ? (
                            <button className="btn btn-sm btn-danger" onClick={() => setActive({ report: r, action: 'banned' })}>Block</button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data ? <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} /> : null}
      </Card>

      {active ? (
        <ReviewReport
          report={active.report}
          initialAction={active.action}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            list.reload();
            stats.reload();
          }}
        />
      ) : null}
    </>
  );
}

const ACTIONS: { key: string; label: string; status: string; hint: string }[] = [
  { key: 'dismissed', label: 'Dismiss', status: 'dismissed', hint: 'No violation found.' },
  { key: 'none', label: 'Mark reviewed', status: 'reviewed', hint: 'Reviewed, no action needed right now.' },
  { key: 'warned', label: 'Warn', status: 'actioned', hint: 'Record a warning against the user.' },
  { key: 'hidden', label: 'Hide from reporter', status: 'actioned', hint: 'Blocks the pair so they no longer see each other.' },
  {
    key: 'banned',
    label: 'Block permanently',
    status: 'actioned',
    hint: 'Signs the reported user out of the app right away and permanently stops them signing in with this Google / email account.',
  },
];

function ReviewReport({ report, initialAction, onClose, onDone }: { report: any; initialAction?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [action, setAction] = useState(initialAction || (report.reason === 'underage' ? 'banned' : 'dismissed'));
  const [note, setNote] = useState(report.moderatorNote || '');
  const [alsoDeactivate, setAlsoDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = ACTIONS.find((a) => a.key === action)!;

  const submit = async () => {
    if ((action === 'banned' || action === 'warned') && !note.trim()) {
      setError('Add a moderator note explaining the decision');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/moderation/reports/${report.id}`, {
        method: 'PATCH',
        body: { status: chosen.status, actionTaken: action, moderatorNote: note.trim(), alsoDeactivate: action === 'hidden' && alsoDeactivate },
      });
      toast(action === 'banned' ? 'User permanently blocked and signed out' : 'Report updated');
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not update report');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Review report"
      wide
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${action === 'banned' ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : chosen.label}
          </button>
        </>
      }
    >
      <div className="stack">
        {report.reason === 'underage' ? (
          <div className="warn-box">Possible minor. Child safety reports should be resolved first and within 24 hours.</div>
        ) : null}
        <div className="grid grid-2">
          <div>
            <div className="muted small">Reported user</div>
            <UserChip user={report.reported} />
            <div className="muted small" style={{ marginTop: 6 }}>
              {num(report.reportedHistory.total)} reports from {num(report.reportedHistory.distinctReporters)} people
            </div>
          </div>
          <div>
            <div className="muted small">Reported by</div>
            <UserChip user={report.reporter} />
            <div className="muted small" style={{ marginTop: 6 }}>{dateTime(report.createdAt)}</div>
          </div>
        </div>
        <div className="note">
          <strong>{label(report.reason)}</strong>
          <div>{report.details || <span className="muted">No details given.</span>}</div>
        </div>
        <label className="field">
          <span>Decision</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
          <span className="muted small">{chosen.hint}</span>
        </label>
        {action === 'hidden' ? (
          <label className="row gap-sm">
            <input type="checkbox" checked={alsoDeactivate} onChange={(e) => setAlsoDeactivate(e.target.checked)} />
            <span>Also deactivate the reported account</span>
          </label>
        ) : null}
        <label className="field">
          <span>Moderator note {action === 'banned' || action === 'warned' ? '(required)' : '(optional)'}</span>
          <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </Modal>
  );
}

// ── Photo verification ─────────────────────────────────────────────────
function Verifications() {
  const { admin, can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data, error, loading, reload } = useApi<any>(`/moderation/verifications${qs({ status, page })}`);
  const base = admin?.mediaBaseUrl || '';

  const decide = async (userId: string, decision: 'approve' | 'reject') => {
    const reviewNote = (notes[userId] || '').trim();
    if (decision === 'reject' && !reviewNote) {
      setErrors((e) => ({ ...e, [userId]: 'Enter a reason so the user knows what to fix' }));
      return;
    }
    setBusy(userId);
    setErrors((e) => ({ ...e, [userId]: '' }));
    try {
      await api(`/moderation/verifications/${userId}`, { method: 'POST', body: { decision, reviewNote } });
      toast(decision === 'approve' ? 'Verification approved' : 'Verification rejected');
      reload();
    } catch (e: any) {
      setErrors((x) => ({ ...x, [userId]: e?.message || 'Failed' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={reload}>Refresh</button>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.items.length ? <Empty text={status === 'pending' ? 'Queue is clear.' : 'Nothing here.'} /> : null}
      <div className="stack">
        {data?.items.map((item: any) => (
          <div key={item.user.id} className="card verify-card">
            <div className="stack">
              <div className="row gap wrap">
                <UserChip user={item.user} />
                {item.matchScore != null ? <Badge value={`match ${Math.round(item.matchScore)}`} tone={item.matchScore >= 80 ? 'good' : item.matchScore >= 50 ? 'warn' : 'bad'} /> : null}
                {item.pose ? <span className="muted small">Pose: {label(item.pose)}</span> : null}
                <span className="muted small">Submitted {ago(item.submittedAt)}</span>
              </div>
              <div className="photo-grid">
                {item.selfieUrl ? (
                  <a href={mediaUrl(base, item.selfieUrl)} target="_blank" rel="noreferrer noopener" title="Verification selfie">
                    <img className="selfie" src={mediaUrl(base, item.selfieUrl)} alt="Selfie" referrerPolicy="no-referrer" />
                  </a>
                ) : (
                  <div className="photo-box">No selfie</div>
                )}
                {item.photos.map((p: string, i: number) => (
                  <a key={i} href={mediaUrl(base, p)} target="_blank" rel="noreferrer noopener">
                    <img src={mediaUrl(base, p)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
              {item.reviewNote && status !== 'pending' ? <div className="muted small">Note: {item.reviewNote} · {ago(item.reviewedAt)}</div> : null}
            </div>
            {status === 'pending' && can('moderation.act') ? (
              <div className="stack" style={{ minWidth: 240 }}>
                <textarea
                  rows={3}
                  placeholder="Reason (required to reject, shown to user)"
                  maxLength={500}
                  value={notes[item.user.id] || ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [item.user.id]: e.target.value }))}
                />
                <div className="row gap-sm">
                  <button className="btn btn-primary" disabled={busy === item.user.id} onClick={() => decide(item.user.id, 'approve')}>Approve</button>
                  <button className="btn btn-danger" disabled={busy === item.user.id} onClick={() => decide(item.user.id, 'reject')}>Reject</button>
                </div>
                {errors[item.user.id] ? <div className="error-box">{errors[item.user.id]}</div> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {data ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}
    </Card>
  );
}

// ── Risk signals ───────────────────────────────────────────────────────
function Risk() {
  const { data, error, loading, reload } = useApi<any>('/moderation/risk');
  if (loading && !data) return <Loading text="Scanning for risk signals…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const cs = data.childSafety;

  return (
    <>
      <p className="muted small">Computed {ago(data.generatedAt)} · refreshed every 5 minutes. Signals are leads to investigate, not proof.</p>

      <Card title={<>Child safety <Badge value={String(cs.openUnderageReports.length + cs.underageProfiles.length)} tone={cs.openUnderageReports.length + cs.underageProfiles.length ? 'bad' : 'good'} /></>}>
        {!cs.openUnderageReports.length && !cs.underageProfiles.length ? <Empty text="No open underage reports or under-18 profiles." /> : null}
        {cs.openUnderageReports.length ? (
          <>
            <h3>Open underage reports</h3>
            <RiskTable
              rows={cs.openUnderageReports}
              cols={[
                ['Reported', (r) => <UserChip user={r.reported} />],
                ['Reporter', (r) => <UserChip user={r.reporter} />],
                ['Details', (r) => <span className="small">{r.details || '—'}</span>],
                ['Waiting', (r) => <span className="small">{ago(r.createdAt)}</span>],
              ]}
            />
          </>
        ) : null}
        {cs.underageProfiles.length ? (
          <>
            <h3>Profiles with age under 18</h3>
            <RiskTable rows={cs.underageProfiles} cols={[['User', (u) => <UserChip user={u} />], ['Age', (u) => u.age], ['Joined', (u) => <span className="small">{ago(u.createdAt)}</span>]]} />
          </>
        ) : null}
      </Card>

      <div className="grid grid-2">
        <Card title="Reported by 3+ people (90 days)">
          <RiskTable
            rows={data.repeatOffenders}
            cols={[
              ['User', (r) => <UserChip user={r.user} />],
              ['People', (r) => num(r.distinctReporters)],
              ['Reports', (r) => num(r.total)],
              ['Last', (r) => <span className="small">{ago(r.lastReportAt)}</span>],
            ]}
          />
        </Card>
        <Card title="Blocked by 3+ people">
          <RiskTable rows={data.blockedMany} cols={[['User', (r) => <UserChip user={r.user} />], ['Blocked by', (r) => num(r.blockedBy)]]} />
        </Card>
        <Card title="Messaging 20+ conversations in 24h">
          <RiskTable
            rows={data.messageBursts}
            cols={[
              ['User', (r) => <UserChip user={r.user} />],
              ['Conversations', (r) => num(r.conversations24h)],
              ['Messages', (r) => num(r.messages24h)],
            ]}
          />
        </Card>
        <Card title="100+ likes in 24h">
          <RiskTable rows={data.likeBursts} cols={[['User', (r) => <UserChip user={r.user} />], ['Likes', (r) => num(r.likes24h)]]} />
        </Card>
      </div>

      <Card title="One device, 3+ accounts">
        {data.sharedDevices.length ? (
          <div className="stack">
            {data.sharedDevices.map((d: any) => (
              <div key={d.deviceId} className="note">
                <div className="muted small">Device {d.deviceId} · {d.accounts.length} accounts</div>
                <div className="row gap wrap">
                  {d.accounts.map((a: any) => <UserChip key={a.id} user={a} />)}
                </div>
              </div>
            ))}
          </div>
        ) : <Empty text="No shared devices detected." />}
      </Card>
    </>
  );
}

function RiskTable({ rows, cols }: { rows: any[]; cols: [string, (row: any) => ReactNode][] }) {
  if (!rows.length) return <Empty text="None detected." />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.user?.id || i}>{cols.map(([h, render]) => <td key={h}>{render(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

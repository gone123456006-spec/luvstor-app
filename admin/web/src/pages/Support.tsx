import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced } from '../hooks';
import { Badge, Card, Empty, ErrorBox, KeyValue, Loading, Modal, PageHeader, Pager, UserChip, useToast } from '../components/ui';
import { ago, dateTime, num } from '../format';

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

export default function Support() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q);
  const { data, error, loading, reload } = useApi<any>(`/support/tickets${qs({ status, category, q: debounced, page })}`);
  const openId = params.get('ticket');
  const close = () => setParams({}, { replace: true });

  return (
    <>
      <PageHeader title="Support" subtitle="Oldest open tickets are shown first so nothing waits too long." />
      {data ? (
        <div className="row gap wrap" style={{ marginBottom: 12 }}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <Badge key={k} value={`${v}: ${num(data.counts[k] || 0)}`} tone={k === 'open' ? 'warn' : k === 'in_progress' ? 'info' : 'muted'} />
          ))}
        </div>
      ) : null}
      <Card>
        <div className="toolbar">
          <input type="search" placeholder="Ticket number, subject or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search tickets" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="active">Open + in progress</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
            <option value="">All categories</option>
            {['Account', 'Billing', 'Safety', 'Bug Report', 'Other'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {loading && !data ? <Loading /> : null}
        {data && !data.tickets.length ? <Empty text="No tickets here." /> : null}
        {data?.tickets.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Subject</th><th>Category</th><th>User</th><th>Status</th><th>Opened</th></tr></thead>
              <tbody>
                {data.tickets.map((t: any) => (
                  <tr key={t.id} className="clickable" onClick={() => setParams({ ticket: t.id })}>
                    <td className="mono">{t.ticketNumber}</td>
                    <td><strong>{t.subject}</strong><div className="muted small">{t.description.slice(0, 90)}{t.description.length > 90 ? '…' : ''}</div></td>
                    <td><Badge value={t.category} tone={t.category === 'Safety' ? 'bad' : 'info'} /></td>
                    <td onClick={(e) => e.stopPropagation()}>{t.user ? <UserChip user={t.user} /> : <span className="small">{t.email}</span>}</td>
                    <td><Badge value={t.status} /></td>
                    <td className="small" title={dateTime(t.createdAt)}>{ago(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data ? <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} /> : null}
      </Card>
      {openId ? <TicketDetail id={openId} onClose={close} onChanged={reload} /> : null}
    </>
  );
}

function TicketDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<any>(`/support/tickets/${encodeURIComponent(id)}`);
  const [status, setStatus] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.ticket) {
      setStatus(data.ticket.status);
      setAdminNote(data.ticket.adminNote);
    }
  }, [data?.ticket]);

  const saveStatus = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/support/tickets/${id}`, { method: 'PATCH', body: { status, adminNote } });
      toast('Ticket updated');
      reload();
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (kind: 'note' | 'reply') => {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/support/tickets/${id}/notes`, { method: 'POST', body: { kind, text } });
      setText('');
      toast(kind === 'reply' ? 'Reply sent to the user' : 'Internal note added');
      reload();
    } catch (e: any) {
      setErr(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const t = data?.ticket;
  return (
    <Modal title={t ? `${t.ticketNumber} · ${t.subject}` : 'Ticket'} wide onClose={busy ? () => undefined : onClose}>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {t ? (
        <div className="stack">
          <KeyValue
            rows={[
              ['User', t.user ? <UserChip user={t.user} /> : t.email || '—'],
              ['Contact email', t.email || '—'],
              ['Category', t.category],
              ['Status', <Badge value={t.status} />],
              ['Opened', dateTime(t.createdAt)],
              ['Resolved', t.resolvedAt ? dateTime(t.resolvedAt) : '—'],
            ]}
          />
          <div className="note" style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div>

          {data.notes.length ? (
            <div className="stack">
              <h3>Activity</h3>
              {data.notes.map((n: any) => (
                <div key={n.id} className={`note ${n.kind === 'reply' ? 'reply' : ''}`}>
                  <div className="muted small">
                    {n.kind === 'reply' ? 'Reply to user' : 'Internal note'} · {n.adminEmail} · {ago(n.createdAt)}
                    {n.kind === 'reply' && n.notified ? ' · notified' : ''}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                </div>
              ))}
            </div>
          ) : null}

          {can('support.act') ? (
            <>
              <label className="field">
                <span>Write a reply (sent to the user as an app notification) or an internal note</span>
                <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="row gap-sm">
                <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => addNote('reply')}>Send reply</button>
                <button className="btn" disabled={busy || !text.trim()} onClick={() => addNote('note')}>Add internal note</button>
              </div>

              <div className="section-gap" />
              <div className="grid grid-2">
                <label className="field">
                  <span>Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Resolution note (saved on the ticket, not shown to the user)</span>
                  <input value={adminNote} onChange={(e) => setAdminNote(e.target.value)} maxLength={2000} />
                </label>
              </div>
              <div>
                <button className="btn" disabled={busy} onClick={saveStatus}>Save status</button>
              </div>
            </>
          ) : null}
          {err ? <div className="error-box">{err}</div> : null}
        </div>
      ) : null}
    </Modal>
  );
}

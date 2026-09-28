import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';

type Queues = { openReports: number; pendingVerifications: number; openTickets: number };

const NAV: { to: string; label: string; permission: string; count?: (q: Queues) => number; section?: string }[] = [
  { to: '/', label: 'Overview', permission: 'overview.view' },
  { section: 'Operate', to: '/users', label: 'Users', permission: 'users.view' },
  { to: '/moderation', label: 'Reports & safety', permission: 'moderation.view', count: (q) => q.openReports + q.pendingVerifications },
  { to: '/notifications', label: 'Notifications', permission: 'notifications.view' },
  { to: '/support', label: 'Support', permission: 'support.view', count: (q) => q.openTickets },
  { section: 'Business', to: '/subscriptions', label: 'Subscriptions', permission: 'money.view' },
  { to: '/money', label: 'Revenue', permission: 'money.view' },
  { to: '/engagement', label: 'Engagement', permission: 'engagement.view' },
  { section: 'Admin', to: '/system', label: 'System health', permission: 'system.view' },
  { to: '/audit', label: 'Audit log', permission: 'audit.view' },
  { to: '/admins', label: 'Admins', permission: 'admins.manage' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { admin, can, logout } = useAuth();
  const [queues, setQueues] = useState<Queues | null>(null);

  useEffect(() => {
    if (!can('overview.view')) return;
    let alive = true;
    const load = () =>
      api<{ queues: Queues }>('/overview')
        .then((r) => alive && setQueues(r.queues))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [can]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Luvstor<span>Admin console</span>
        </div>
        {NAV.filter((n) => can(n.permission)).map((n) => {
          const count = queues && n.count ? n.count(queues) : 0;
          return (
            <div key={n.to}>
              {n.section ? <div className="nav-section">{n.section}</div> : null}
              <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span>{n.label}</span>
                {count > 0 ? <span className="nav-count">{count > 99 ? '99+' : count}</span> : null}
              </NavLink>
            </div>
          );
        })}
        <div className="sidebar-foot">
          <div style={{ color: '#fff' }}>{admin?.name || admin?.email}</div>
          <div style={{ textTransform: 'capitalize', marginBottom: 8 }}>{admin?.role}</div>
          <div className="row gap">
            <NavLink to="/account" style={{ color: '#d9d3ee' }}>Password</NavLink>
            <button className="link-btn" onClick={() => void logout()}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

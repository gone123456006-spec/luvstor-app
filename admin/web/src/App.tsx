import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import MfaSetupForced from './pages/MfaSetup';
import Overview from './pages/Overview';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Moderation from './pages/Moderation';
import Money from './pages/Money';
import Subscriptions from './pages/Subscriptions';
import Engagement from './pages/Engagement';
import Notifications from './pages/Notifications';
import Support from './pages/Support';
import System from './pages/System';
import Audit from './pages/Audit';
import Admins from './pages/Admins';
import AppVersions from './pages/AppVersions';

function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return <div className="card">You don't have access to this section. Ask an owner to change your role.</div>;
  }
  return <>{children}</>;
}

export default function App() {
  const { admin, loading } = useAuth();

  if (loading) return <Loading text="Checking session…" />;
  if (!admin) return <Login />;
  if (admin.mustChangePassword) return <ChangePassword forced />;
  if (admin.mfaSetupRequired) return <MfaSetupForced />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Guard permission="overview.view"><Overview /></Guard>} />
        <Route path="/users" element={<Guard permission="users.view"><Users /></Guard>} />
        <Route path="/users/:id" element={<Guard permission="users.view"><UserDetail /></Guard>} />
        <Route path="/moderation" element={<Guard permission="moderation.view"><Moderation /></Guard>} />
        <Route path="/money" element={<Guard permission="money.view"><Money /></Guard>} />
        <Route path="/subscriptions" element={<Guard permission="money.view"><Subscriptions /></Guard>} />
        <Route path="/engagement" element={<Guard permission="engagement.view"><Engagement /></Guard>} />
        <Route path="/app-versions" element={<Guard permission="versions.view"><AppVersions /></Guard>} />
        <Route path="/notifications" element={<Guard permission="notifications.view"><Notifications /></Guard>} />
        <Route path="/support" element={<Guard permission="support.view"><Support /></Guard>} />
        <Route path="/system" element={<Guard permission="system.view"><System /></Guard>} />
        <Route path="/audit" element={<Guard permission="audit.view"><Audit /></Guard>} />
        <Route path="/admins" element={<Guard permission="admins.manage"><Admins /></Guard>} />
        <Route path="/account" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

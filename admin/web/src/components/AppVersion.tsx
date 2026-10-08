import { Badge } from './ui';

export type AppInfo = {
  version: string | null;
  build?: string | null;
  platform: string | null;
  source: 'app' | 'push' | 'none';
  seenAt?: string | null;
  status: 'latest' | 'outdated' | 'unknown';
  latest?: string | null;
};

const STATUS_LABEL: Record<AppInfo['status'], { label: string; tone: string }> = {
  latest: { label: 'up to date', tone: 'good' },
  outdated: { label: 'outdated', tone: 'warn' },
  unknown: { label: 'unknown', tone: 'muted' },
};

export function platformLabel(p?: string | null) {
  if (p === 'ios') return 'iOS';
  if (p === 'android') return 'Android';
  return '';
}

export function VersionStatusBadge({ status }: { status: AppInfo['status'] }) {
  const s = STATUS_LABEL[status] || STATUS_LABEL.unknown;
  return <Badge value={s.label} tone={s.tone} />;
}

/** "1.0.5 · Android" + status badge, compact for tables */
export function AppVersionCell({ app }: { app?: AppInfo | null }) {
  if (!app?.version) return <span className="muted small">—</span>;
  return (
    <span className="small" title={app.source === 'push' ? 'From push registration (older app build)' : undefined}>
      <span className="mono">{app.version}</span>
      {app.platform ? <span className="muted"> · {platformLabel(app.platform)}</span> : null}{' '}
      {app.status === 'outdated' ? <VersionStatusBadge status="outdated" /> : null}
    </span>
  );
}

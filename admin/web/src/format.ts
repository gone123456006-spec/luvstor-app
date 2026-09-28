const nf = new Intl.NumberFormat('en-IN');
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const num = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const inr = (n: number | null | undefined) => (n == null ? '—' : money.format(n));
export const pct = (r: number | null | undefined, digits = 0) =>
  r == null || !Number.isFinite(r) ? '—' : `${(r * 100).toFixed(digits)}%`;

export function dateTime(v?: string | Date | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function dateOnly(v?: string | Date | null) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export function ago(v?: string | Date | null) {
  if (!v) return '—';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return dateOnly(v);
}

export function duration(sec: number) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function mediaUrl(base: string, path?: string | null) {
  const p = String(path || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
  return `${base}${p.startsWith('/') ? '' : '/'}${p}`;
}

export const label = (s?: string | null) => String(s || '').replace(/_/g, ' ');

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

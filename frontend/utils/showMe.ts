/** Canonical Nearby / profile preference: Man | Woman | Other | All */

export const SHOW_ME_OPTIONS = [
  { label: 'Men', value: 'Man' },
  { label: 'Women', value: 'Woman' },
  { label: 'Other', value: 'Other' },
  { label: 'Everyone', value: 'All' },
] as const;

export type ShowMeValue = 'Man' | 'Woman' | 'Other' | 'All';

export function canonicalShowMe(value?: string | null): ShowMeValue | '' {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (['man', 'male', 'm', 'men', 'boy'].includes(raw)) return 'Man';
  if (['woman', 'female', 'w', 'women', 'girl'].includes(raw)) return 'Woman';
  if (['other', 'non-binary', 'nonbinary', 'nb'].includes(raw)) return 'Other';
  if (['all', 'everyone', 'any', 'both'].includes(raw)) return 'All';
  return '';
}

export function oppositeShowMe(gender?: string | null): ShowMeValue {
  const g = canonicalShowMe(gender);
  if (g === 'Woman') return 'Man';
  if (g === 'Man') return 'Woman';
  return 'All';
}

/**
 * Who should appear in Nearby.
 * Priority: saved filter → showMe field → opposite of own gender → Everyone.
 */
export function resolveShowMe(
  ownGender?: string | null,
  showMe?: string | null,
  savedFilter?: string | null,
): ShowMeValue {
  const explicit =
    canonicalShowMe(savedFilter) || canonicalShowMe(showMe);
  if (explicit) return explicit;
  return oppositeShowMe(ownGender);
}

export function followGenderChange(
  prevGender: string,
  prevShowMe: string,
  nextGender: string,
): ShowMeValue {
  const explicit = canonicalShowMe(prevShowMe);
  const wasFollowingOpposite =
    !explicit || explicit === oppositeShowMe(prevGender);
  if (wasFollowingOpposite) return oppositeShowMe(nextGender);
  return explicit;
}

export function showMeLabel(
  ownGender?: string | null,
  showMe?: string | null,
): string {
  const resolved = resolveShowMe(ownGender, showMe);
  const match = SHOW_ME_OPTIONS.find((o) => o.value === resolved);
  return match?.label || 'Everyone';
}

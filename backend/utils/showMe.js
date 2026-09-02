/**
 * Who a user wants to see in Nearby, derived from their own gender plus an
 * optional explicit preference (`showMe`).
 *
 * Canonical values: Man | Woman | Other | All
 * Empty / unknown preference falls back to the opposite of the viewer's gender
 * (Woman → Man, Man → Woman, anything else → All).
 */

const CANONICAL = new Set(['Man', 'Woman', 'Other', 'All']);

function canonicalShowMe(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (['man', 'male', 'm', 'men', 'boy'].includes(raw)) return 'Man';
  if (['woman', 'female', 'w', 'women', 'girl'].includes(raw)) return 'Woman';
  if (['other', 'non-binary', 'nonbinary', 'nb'].includes(raw)) return 'Other';
  if (['all', 'everyone', 'any', 'both'].includes(raw)) return 'All';
  return CANONICAL.has(String(value || '').trim()) ? String(value).trim() : '';
}

function oppositeShowMe(gender) {
  const g = canonicalShowMe(gender);
  if (g === 'Woman') return 'Man';
  if (g === 'Man') return 'Woman';
  return 'All';
}

/**
 * Preference used for Nearby filtering.
 *
 * Priority: explicit saved filter → showMe field → opposite of own gender → All.
 */
function resolveShowMe(user = {}, savedFilter = '') {
  const explicit =
    canonicalShowMe(savedFilter) ||
    canonicalShowMe(user.showMe) ||
    canonicalShowMe(user.discoveryPrefs?.gender);
  if (explicit) return explicit;
  return oppositeShowMe(user.gender);
}

/**
 * When the user changes their own gender, keep Show me on the opposite sex
 * unless they already picked something else (Everyone, same gender, etc.).
 */
function followGenderChange(prevGender, prevShowMe, nextGender) {
  const explicit = canonicalShowMe(prevShowMe);
  const wasFollowingOpposite = !explicit || explicit === oppositeShowMe(prevGender);
  if (wasFollowingOpposite) return oppositeShowMe(nextGender);
  return explicit;
}

/** Value to send into buildEligibilityFilter (`all` means no gender constraint). */
function toGenderFilter(showMe) {
  const canonical = canonicalShowMe(showMe);
  if (!canonical || canonical === 'All') return 'all';
  return canonical.toLowerCase();
}

module.exports = {
  canonicalShowMe,
  oppositeShowMe,
  resolveShowMe,
  followGenderChange,
  toGenderFilter,
};

import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_RECENT = 12;

export const RECENT_SEARCH_HOME = 'recent_searches_home_v2';
export const RECENT_SEARCH_CHAT = 'recent_searches_chat_v2';

export type RecentSearchPerson = {
  id: string;
  name: string;
  photo?: string;
  /** Optional text query used to find them */
  query?: string;
};

function normalizePerson(
  raw: Partial<RecentSearchPerson> | string | null | undefined,
): RecentSearchPerson | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const q = raw.trim();
    if (!q) return null;
    return { id: q.toLowerCase(), name: q, photo: '', query: q };
  }
  const id = String(raw.id || '').trim();
  const name = String(raw.name || raw.query || '').trim();
  if (!id && !name) return null;
  return {
    id: id || name.toLowerCase(),
    name: name || id,
    photo: typeof raw.photo === 'string' ? raw.photo : '',
    query: typeof raw.query === 'string' ? raw.query.trim() : undefined,
  };
}

export async function getRecentSearches(
  key: string,
): Promise<RecentSearchPerson[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentSearchPerson[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const person = normalizePerson(item);
      if (!person) continue;
      const k = person.id.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(person);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function addRecentSearch(
  key: string,
  person: RecentSearchPerson | string,
): Promise<RecentSearchPerson[]> {
  const nextPerson = normalizePerson(person);
  if (!nextPerson) return getRecentSearches(key);
  const prev = await getRecentSearches(key);
  const next = [
    nextPerson,
    ...prev.filter((x) => x.id.toLowerCase() !== nextPerson.id.toLowerCase()),
  ].slice(0, MAX_RECENT);
  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

export async function removeRecentSearch(
  key: string,
  id: string,
): Promise<RecentSearchPerson[]> {
  const target = String(id || '').toLowerCase();
  const prev = await getRecentSearches(key);
  const next = prev.filter((x) => x.id.toLowerCase() !== target);
  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

export async function clearRecentSearches(
  key: string,
): Promise<RecentSearchPerson[]> {
  await AsyncStorage.removeItem(key);
  return [];
}

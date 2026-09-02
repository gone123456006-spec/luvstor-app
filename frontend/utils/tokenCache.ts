import { fetchTokenBalance } from './chatTokens';

export type TokenBalanceSnapshot = Awaited<
  ReturnType<typeof fetchTokenBalance>
> & {
  at: number;
};

let cached: TokenBalanceSnapshot | null = null;
let inflight: Promise<TokenBalanceSnapshot | null> | null = null;

const CACHE_TTL_MS = 60_000;

export function getCachedTokenBalance(): TokenBalanceSnapshot | null {
  if (!cached) return null;
  if (Date.now() - cached.at > CACHE_TTL_MS) return null;
  return cached;
}

export function setCachedTokenBalance(
  data: Awaited<ReturnType<typeof fetchTokenBalance>>,
) {
  cached = { ...data, at: Date.now() };
}

export function updateCachedTokenBalance(
  patch: Partial<Awaited<ReturnType<typeof fetchTokenBalance>>>,
) {
  if (!cached) return;
  cached = { ...cached, ...patch, at: Date.now() };
}

export function clearTokenBalanceCache() {
  cached = null;
  inflight = null;
}

/** Background preload for the Tokens tab — safe to call from tab layout. */
export async function preloadTokenBalance(
  authToken: string,
  { force = false }: { force?: boolean } = {},
): Promise<TokenBalanceSnapshot | null> {
  if (!force) {
    const fresh = getCachedTokenBalance();
    if (fresh) return fresh;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const data = await fetchTokenBalance(authToken);
      setCachedTokenBalance(data);
      return cached;
    } catch {
      return getCachedTokenBalance();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

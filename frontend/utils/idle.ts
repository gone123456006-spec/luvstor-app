/**
 * Run non-urgent work once the JS thread is idle (replacement for the
 * deprecated InteractionManager.runAfterInteractions).
 *
 * `timeout` caps the wait so the work still runs on a busy thread.
 */
export function runWhenIdle(
  fn: () => void,
  timeout = 500,
): { cancel: () => void } {
  const ric = (globalThis as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;
  const cic = (globalThis as any).cancelIdleCallback as
    | ((id: number) => void)
    | undefined;

  if (typeof ric === "function") {
    const id = ric(fn, { timeout });
    return { cancel: () => cic?.(id) };
  }
  const t = setTimeout(fn, 1);
  return { cancel: () => clearTimeout(t) };
}

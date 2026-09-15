/**
 * `next/navigation`, minus the router.
 *
 * The real hooks read App Router context that exists only inside a running Next tree. What the
 * till asks of the router is one thing — `refresh()`, to invalidate the server-rendered screens
 * a completed sale makes stale — so the stub records that it was asked rather than performing
 * navigation, and a test can assert the invalidation happened.
 */

let refreshCount = 0;

export function useRouter() {
  return {
    refresh: () => {
      refreshCount += 1;
    },
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
}

export function refreshCalls(): number {
  return refreshCount;
}

export function resetRefreshCalls(): void {
  refreshCount = 0;
}

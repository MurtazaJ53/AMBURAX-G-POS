/**
 * Shared "the datastore didn't answer" screen for authenticated server components.
 *
 * Found at A9 by smoke-testing every page with the database deliberately unreachable:
 * `/dashboard`, `/onboarding/store`, `/onboarding/team` and `/onboarding/pos` all returned a
 * raw HTTP 500, while every API route and the public `/invite/[token]` page degraded
 * politely. A brief connection blip is an operational event, not a crash, and the merchant
 * should be told to try again rather than shown Next's generic error page.
 *
 * Note for callers: wrap only the data-loading calls in try/catch, never the `redirect()`
 * calls. Next implements `redirect()` by throwing, so a try/catch around it would swallow
 * the redirect and render this screen instead of navigating.
 */
export function ServiceUnavailableScreen() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">One moment.</h1>
          <p className="text-sm text-slate-300">We&apos;re having trouble reaching your data right now.</p>
        </div>
        <p className="text-xs text-slate-400">Nothing you&apos;ve set up has been lost.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Temporarily unavailable</h2>
          <div
            role="alert"
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            We couldn&apos;t load this page right now. Please try again in a few minutes — nothing
            you&apos;ve already set up has been lost.
          </div>
        </div>
      </section>
    </div>
  );
}

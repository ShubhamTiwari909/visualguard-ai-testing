export function Hero() {
  return (
    <section data-testid="hero" className="rounded-2xl border border-slate-200 p-10">
      <h1 className="text-4xl font-bold tracking-tight">Ship UI without surprises</h1>
      <p className="mt-4 max-w-xl text-slate-600">
        VisualGuard compares production and staging and explains every visual difference.
      </p>
      <a
        href="/pricing"
        data-testid="cta"
        className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white"
      >
        Start free trial
      </a>
    </section>
  );
}

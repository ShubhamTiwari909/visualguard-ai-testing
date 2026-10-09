export function CheckoutSummary({ total }: { total: string }) {
  return (
    <div className="checkout-summary mt-8 flex h-24 items-start justify-between rounded-xl bg-slate-50 px-6">
      <span className="text-2xl font-bold">{total}</span>
      <a
        href="/pay"
        data-testid="pay"
        className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white"
      >
        Pay now
      </a>
    </div>
  );
}

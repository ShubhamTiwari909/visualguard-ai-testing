export function PricingCard({
  name,
  price,
  features,
}: {
  name: string;
  price: string;
  features: string[];
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-6">
      <h2 className="text-lg font-semibold">{name}</h2>
      <p className="mt-2 text-3xl font-bold">{price}</p>
      <ul className="mt-4 space-y-1 text-sm text-slate-600">
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </article>
  );
}

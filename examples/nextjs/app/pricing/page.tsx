import { PricingCard } from "@/components/PricingCard";

export default function Pricing() {
  return (
    <>
      <h1 className="text-3xl font-bold">Pricing</h1>
      <div className="mt-8 grid grid-cols-3 gap-6">
        <PricingCard name="Starter" price="$0" features={["1 project", "Pixel diffs"]} />
        <PricingCard name="Pro" price="$49" features={["10 projects", "AI analysis"]} />
        <PricingCard name="Team" price="$199" features={["Unlimited", "Fixes & PRs"]} />
      </div>
    </>
  );
}

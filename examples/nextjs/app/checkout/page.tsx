import { CheckoutSummary } from "@/components/CheckoutSummary";

export default function Checkout() {
  return (
    <>
      <h1 className="text-3xl font-bold">Checkout</h1>
      <p className="mt-2 text-slate-600">Review your order before paying.</p>
      <CheckoutSummary total="$49.00" />
    </>
  );
}

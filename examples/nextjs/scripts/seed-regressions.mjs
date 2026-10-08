// Seeds three visual regressions into the source so you can try `visualguard test` and
// `visualguard fix`. Run with --undo to put them back.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const undo = process.argv.includes("--undo");
const changes = [
  [
    "components/CheckoutSummary.tsx",
    "flex h-24 items-center justify-between",
    "flex h-24 items-start justify-between",
  ],
  [
    "components/Hero.tsx",
    "inline-block rounded-lg bg-blue-600 px-5",
    "inline-block rounded-lg bg-violet-600 px-5",
  ],
  [
    "components/PricingCard.tsx",
    "rounded-xl border border-slate-200 p-6",
    "rounded-xl border border-slate-200 p-3",
  ],
];
for (const [file, good, bad] of changes) {
  const path = join(root, file);
  const [from, to] = undo ? [bad, good] : [good, bad];
  const content = readFileSync(path, "utf8");
  if (!content.includes(from)) {
    console.log(`skip ${file}: already ${undo ? "restored" : "seeded"}`);
    continue;
  }
  writeFileSync(path, content.replace(from, to));
  console.log(`${undo ? "restored" : "seeded"} ${file}`);
}

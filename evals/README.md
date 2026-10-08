# Evals

Measures how well VisualGuard classifies visual differences (PLAN.md §10.8). Each route in
[`labels.json`](labels.json) is a page in [`fixtures/site`](../fixtures/site) with a production and
a staging variant; the label is what a reviewer would call the difference:

| Label         | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `regression`  | Broken: misalignment, overlap, clipping, overflow, missing UI |
| `intentional` | A deliberate change: new copy, restyle, new element           |
| `content`     | Data changes: prices, posts, dates                            |
| `noise`       | Rendering differences nobody would notice                     |

Every route runs at desktop and mobile, so the labels give about 40 cases.

```bash
pnpm eval                                       # heuristics only (the baseline)
pnpm eval -- --provider gemini                  # needs GEMINI_API_KEY
pnpm eval -- --provider gemini --model <id>
pnpm eval -- --provider ollama --model qwen2.5vl
```

The runner prints precision and recall per class, a confusion matrix and the misses, and saves the
results to `evals/results/`. Run it before changing prompts or default models. The 1.0 target is
regression precision ≥ 0.85 and recall ≥ 0.90 on the default Gemini model.

Without AI, statuses stand in for classes (regression → regression, review → intentional,
pass → noise), so heuristics can never score on `content`.

# Fixture site

Static pages used by VisualGuard's integration tests and evals. Every page exists in a
`production/` and a `staging/` variant. The fixture server (`packages/visualguard/test/helpers/fixture-server.ts`)
serves `/name` from `name.html` and replaces `{{origin}}` in `.xml` and `.txt` files.

| Page                                    | Difference on staging                       | Expected without AI                      |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| `/` `/identical` `/pricing` `/checkout` | none                                        | pass                                     |
| `/animated`                             | none (infinite animation + transition)      | pass                                     |
| `/dynamic`                              | random price (masked) and clock (frozen)    | pass                                     |
| `/dynamic-change`                       | random price (not masked) + CTA colour      | review: only the CTA (noise map)         |
| `/a11y`                                 | image `alt` and button label removed        | pass (with `--a11y`: review)             |
| `/heavy`                                | 60 KB script added, same pixels             | pass (with `--perf`: review)             |
| `/marked-dynamic`                       | random text marked `data-visualguard-ignore` | pass                                    |
| `/text-change`                          | CTA copy "Start free trial" → "Start trial" | review: text change on the CTA           |
| `/color-change`                         | CTA background colour                       | review: background-color on the CTA      |
| `/alignment`                            | `align-items: center` → `flex-start`        | review: align-items on `div.actions`     |
| `/spacing`                              | feature card padding 24px → 12px            | review: padding on `div.card`            |
| `/layout-shift`                         | banner inserted above the hero              | review: one shift caused by the banner   |
| `/missing-image`                        | image points to a missing file              | regression: broken image                 |
| `/overflow`                             | promo box wider than a 390px viewport       | regression on mobile: horizontal overflow |
| `/overlap`                              | badge moved on top of the hero              | regression: new overlap                  |
| `/hidden`                               | CTA hidden                                  | regression: control missing              |
| `/contrast`                             | paragraph text turned light grey            | regression: low contrast                 |
| `/clipped`                              | CTA narrowed, text cut off                  | regression: text cut off                 |
| `/misaligned-grid`                      | one card pushed down 28px                   | review (AI: regression)                  |
| `/wrapped-nav`                          | larger nav links wrap the header            | review (AI: regression)                  |
| `/font-size`                            | bigger heading                              | review (AI: intentional)                 |
| `/nav-item`                             | new "Blog" link                             | review (AI: intentional)                 |
| `/rounded`                              | rounder cards and pill buttons              | review (AI: intentional)                 |
| `/button-style`                         | uppercase dark buttons                      | review (AI: intentional)                 |
| `/price`                                | $49 → $59                                   | review (AI: content)                     |
| `/blog-list`                            | different posts                             | review (AI: content)                     |
| `/footer-year`                          | © 2025 → © 2026                             | review (AI: content)                     |
| `/subpixel`                             | text nudged 0.4px                           | review (AI: noise)                       |

Labels for AI evals are in [`evals/labels.json`](../../evals/labels.json).

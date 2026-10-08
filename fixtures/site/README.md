# Fixture site

Static pages used by VisualGuard's integration tests and evals. Every page exists in a
`production/` and a `staging/` variant. The fixture server (`packages/visualguard/test/helpers/fixture-server.ts`)
serves `/name` from `name.html` and replaces `{{origin}}` in `.xml` and `.txt` files.

| Page             | Difference on staging                         | Expected (no AI)          |
| ---------------- | --------------------------------------------- | ------------------------- |
| `/` `/identical` `/pricing` `/checkout` | none                    | pass                      |
| `/animated`      | none (infinite animation + transition)        | pass                      |
| `/dynamic`       | random price (masked) and clock (frozen)      | pass                      |
| `/text-change`   | CTA copy "Start free trial" → "Start trial"   | review                    |
| `/color-change`  | CTA background colour                         | review                    |
| `/alignment`     | `align-items: center` → `flex-start`          | review                    |
| `/spacing`       | feature card padding 24px → 12px              | review                    |
| `/layout-shift`  | banner inserted above the hero                | review (one shift)        |
| `/missing-image` | image points to a missing file                | regression                |
| `/overflow`      | promo box wider than a 390px viewport         | regression on mobile      |
| `/overlap`       | badge overlaps the hero                       | review                    |
| `/hidden`        | CTA hidden                                    | review                    |

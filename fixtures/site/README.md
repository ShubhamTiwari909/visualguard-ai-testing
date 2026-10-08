# Fixture site

Static pages used by VisualGuard's integration tests and evals. Every page exists in a
`production/` and a `staging/` variant. The fixture server (`packages/visualguard/test/helpers/fixture-server.ts`)
serves `/name` from `name.html` and replaces `{{origin}}` in `.xml` and `.txt` files.

| Page                                    | Difference on staging                       | Expected without AI                      |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| `/` `/identical` `/pricing` `/checkout` | none                                        | pass                                     |
| `/animated`                             | none (infinite animation + transition)      | pass                                     |
| `/dynamic`                              | random price (masked) and clock (frozen)    | pass                                     |
| `/text-change`                          | CTA copy "Start free trial" → "Start trial" | review: text change on the CTA           |
| `/color-change`                         | CTA background colour                       | review: background-color on the CTA      |
| `/alignment`                            | `align-items: center` → `flex-start`        | review: align-items on `div.actions`     |
| `/spacing`                              | feature card padding 24px → 12px            | review: padding on `div.card`            |
| `/layout-shift`                         | banner inserted above the hero              | review: one shift caused by the banner   |
| `/missing-image`                        | image points to a missing file              | regression: broken image                 |
| `/overflow`                             | promo box wider than a 390px viewport       | regression on mobile: horizontal overflow |
| `/overlap`                              | badge moved on top of the hero              | regression: new overlap                  |
| `/hidden`                               | CTA hidden                                  | regression: control missing              |

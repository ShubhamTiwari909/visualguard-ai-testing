---
"visualguard": patch
---

Pass sub-pixel moves of large text blocks as rendering noise. In 3.6.0 the rule only covered changed areas up to 64×64 pixels, so a paragraph nudged 0.4px still asked for review. A larger area now passes when at most a quarter of its pixels changed and it stays within the moved elements, and sub-pixel noise may cover up to 3% of the page, enough for text-heavy phone screens. Report a missing object storage SDK as a setup problem (exit code 3, with install guidance) and storage URL mistakes as configuration errors (exit code 2), instead of "Unexpected error".

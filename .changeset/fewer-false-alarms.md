---
"visualguard": minor
---

Raise fewer false alarms. Differences caused only by moving an element less than one pixel now pass as rendering noise. Videos are paused only after they finish seeking to their first frame, so a busy machine no longer screenshots a playing frame. Add a `quarantine` config option: a check with an owner, reason and expiry date still runs and reports its status but no longer fails the run, JUnit or the exit code; capture errors and health problems still fail, and expired or unmatched entries warn. The evals gain stabilization fixtures (slow web font, slow lazy images, video, sticky header), a false-alarm rate and a `--max-false-alarm-rate` gate.

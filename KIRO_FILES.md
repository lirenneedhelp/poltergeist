## 2026-11-16: Task 4.2 Fog as overlay
**Kiro feature:** spec task (haunt-engine 4.2)
**What I asked:** Start task 4.2
**What happened:** Kiro rewrote fog.js as a backdrop-filter overlay; jsdom tests passed.
**What I caught/changed:** jsdom can't verify blur, so added a Playwright check (task 7.3).
**Evidence:** commit abc1234, 12 new tests
**Write-up angle:** knowing which tests jsdom can't prove

## 2026-11-16: Task 4.1 Teardown lifecycle
**Kiro feature:** spec task (haunt-engine 4.1, Req 5.10)
**What happened:** Kiro made the effect states explicit (live, fading, dead).
**Bug found:** in the original vibe-coded skeleton, a second fade-out call
cancelled the running fade and removed the effect instantly. Requirement 5.10
said it should be a no-op, so writing the spec exposed it.
**Caveat:** no test yet; task 4.5 must cover it.
**Evidence:** commit <hash>, 39 tests still passing
## 2026-11-16: Task 4.2 Fog as overlay
**Kiro feature:** spec task (haunt-engine 4.2)
**What I asked:** Start task 4.2
**What happened:** Kiro rewrote fog.js as a backdrop-filter overlay; jsdom tests passed.
**What I caught/changed:** jsdom can't verify blur, so added a Playwright check (task 7.3).
**Evidence:** commit abc1234, 12 new tests
**Write-up angle:** knowing which tests jsdom can't prove
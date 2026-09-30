---
name: Agent task
about: Work for the agent loop (see agents/README.md). Keep the block's fields valid.
labels: agent-backlog, from:human
---

```agent-task
kind: feature        # bug | feature | experiment | refactor | test | docs | infra
priority: P2         # P0 (now) .. P3 (someday); also add the matching label
impact: 3            # 1-5: how much better for golfers or the project
confidence: 3        # 1-5: how sure we are it will pay off
effort: 3            # 1-5: 1 is an hour, 5 is several days
area: python         # python | ml | web | ios | desktop | product | docs | infra
needs: none          # none | data | swift | browser (comma-separated)
depends-on: none     # #N, #M or none
```

## Why

## What

## Acceptance criteria
- [ ]

## Verification

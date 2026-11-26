# The agent loop

Stem improves itself between your messages. Three agents with separate jobs share
one backlog and check each other's work:

```
            ┌──────────── backlog: GitHub issues labelled agent-backlog ────────────┐
            │                                                                        │
  Strategist ──files, ranks, prunes──▶ items ──rank (agents/loop.py)──▶ Builder     │
  every 4 h                                                            continuous    │
      ▲                                                                   │ pushes   │
      │ reads journal, QA findings,                  integration branch ◀─┘ (PR #4)  │
      │ what landed, the docs                                  │                     │
      │                                                        ▼                     │
      └─────────── control issue journal ◀──────────────── QA, hourly ──findings────┘
                                                  reviews every new commit, audits
                                                  an area when nothing landed
```

- **Strategist** (`roles/strategist.md`): decides what matters next, with evidence;
  keeps 3 to 15 well-specified items ready; writes a brief every run.
- **Builder** (`roles/builder.md`): the main agent. Fixes what is broken first,
  then takes the top-ranked item, builds it, runs `agents/check.sh`, pushes to the
  integration branch, and posts evidence. Continues while ready work remains.
- **QA** (`roles/qa.md`): reviews every commit range the Builder lands, runs the
  checks itself, verifies claimed acceptance criteria, reopens what does not
  hold, and files findings that the ranker puts ahead of new work.

All three obey `CHARTER.md`: no fabricated numbers, the holdout only through the
release gate, no forbidden ball or club outputs, parity across engines, no push
to `main`, and a list of decisions only a human makes.

## Where things live

| What | Where |
|---|---|
| Backlog | GitHub issues labelled `agent-backlog` (format: `loop.py` docstring; template: New issue → Agent task) |
| Journal, kill switch, human queue | The control issue, number `[loop].control_issue` in `config.toml` |
| Code review | Review comments on the integration pull request |
| Settings | `config.toml` |
| Ranking, validation, health | `loop.py` (tested in `tests/`, run in CI) |
| The one check gate | `check.sh` |
| Fresh-container setup | `bootstrap.sh` |

## How it runs

| Agent | Runs in | Woken by |
|---|---|---|
| Builder | The original Claude Code session (it has the GolfDB data, CPU PyTorch and a Swift toolchain) | Its own continuation after each cycle, a heartbeat routine every 2 hours, and PR activity |
| QA | Its own Claude Code cloud session | An hourly routine |
| Strategist | Its own Claude Code cloud session | A routine every 4 hours |

The routines are listed at claude.ai/code under Routines. The sessions can't
message each other; everything they share goes through GitHub and this
directory, which is what makes the loop survive restarts.

## Steering it

- **Add work:** open an issue with the *Agent task* template and the
  `agent-backlog` label. Add `human-priority` to put it first.
- **Change priorities:** edit an item's priority label and its `priority:` line.
- **Pause everything:** add the label `agents-paused` to the control issue, or set
  `enabled = false` in `config.toml`. Remove it to resume.
- **Answer a decision:** items labelled `needs-human` wait for you; comment your
  decision and remove the label.
- **Stop for good:** delete the three routines and set `enabled = false`.

## Cost

Every run costs tokens. The caps in `config.toml` bound the Builder's cycles per
day and how much QA and the Strategist file per run. A run with nothing to do
ends early and costs little. Lower the caps or pause the loop to spend less.

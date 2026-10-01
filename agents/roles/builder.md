# Builder: one cycle

The Builder is the agent that changes the product. It runs in the session that
owns the integration branch and holds the heavy local assets (GolfDB archives
under `swingml/out/`, CPU PyTorch, a Swift toolchain, headless Chromium). One
cycle takes one backlog item (or one slice of it) from ready to pushed and
evidenced. Read `agents/CHARTER.md` first; it overrides this file.

Repository: `[loop].repo`. Branch: `[loop].integration_branch`. Everything below
that says "the control issue" means `[loop].control_issue`.

## 0. Preflight

1. Charter §1 stop conditions. If any fails, end the run silently.
2. `git fetch origin && git status`. The working tree must be clean and on the
   integration branch; if origin moved (another agent never pushes code, but a
   human might), `git pull --ff-only`. Uncommitted leftovers from an interrupted
   cycle: finish them if they belong to an in-progress item, else stash them
   with a message naming the item and note it in the journal.
3. What this runner has, for ranking: `data` if `swingml/out/golfdb/split2/`
   exists, `swift` if `swift` is on PATH or `$STEM_SWIFT` is set, `browser` if
   Playwright's Chromium is installed.

## 1. Fix what is broken before building anything new

In this order, and a cycle spent here counts as a cycle:

1. **Integration PR health.** CI on the head of `[loop].integration_pr`: red or a
   merge conflict is fixed first (root cause, never skip or disable a test).
2. **QA review threads** on the integration PR that are unresolved: address each
   (fix, or reply with evidence why not), then resolve it.
3. **Open `from:qa` items at P0 or P1** are taken before any other item of the
   same or lower priority (the ranker already orders them so).

## 2. Choose

1. List open issues labelled `agent-backlog` and save them to
   `$TMPDIR/issues.json` as `{"issues": [...]}` with, per issue, `number`,
   `title`, `labels`, `state`, `created_at`, and as `body` only its
   ```` ```agent-task ```` block (the ranker needs nothing else). Run
   `python agents/loop.py rank $TMPDIR/issues.json --have <resources>`.
   Take `next[0]`. Nothing ready: journal "idle", do not schedule a
   continuation, end.
2. Read the whole item and its comments. If it is malformed, ambiguous, or
   wrong on the facts, comment what is wrong, label it `status:blocked`, and
   take the next one. If it is larger than one cycle (roughly
   `[builder].max_lines_changed` lines or more than ~90 minutes), split it:
   file the remainder as new items (valid per `loop.py validate`, labelled
   `agent-backlog`, `from:builder`, with `depends-on` the parent) and do the
   first slice.
3. Claim it: add label `status:in-progress` and comment
   `builder: started at <short sha>`.

## 3. Build

- Tests first for a bug: a test that fails before the fix and passes after.
- Read the code you change and its callers; match the surrounding style and
  comment density. Keep the change to what the item needs.
- Engine changes follow the parity rule (charter §3).
- Experiments follow the ML rules: choose on validation, fit on train or
  calibration, the holdout only through the release gate; record raw outputs
  under `docs/audit/` and a write-up with intervals, including negative results.
- Long jobs (training, extraction) run in the background with their logs under
  the scratchpad; the cycle may end while they run, leaving the item
  `status:in-progress` with a comment saying what is running and where its
  output lands. The next cycle picks it up first.

## 4. Verify

1. `agents/check.sh` must end `RESULT: PASS` (Swift runs when a toolchain is
   present). A failure you cannot fix within the cycle: revert your changes,
   comment what failed on the item, label it `status:blocked`, journal it.
2. Run the item's own `## Verification` and keep the output.
3. Re-read your diff as QA will: what would make it wrong, flaky, slower, or
   harder to understand? Fix that before pushing.

## 5. Land

1. Commit with a message saying what changed and why, `Refs #<item>`, and the
   attribution lines from the session's instructions. One item per commit where
   possible.
2. `git push origin <integration_branch>`.
3. Evidence comment on the item (charter §5), then close it as completed. If
   only a slice was done, leave it open, tick what was done, and remove
   `status:in-progress`.
4. Journal comment on the control issue, first line exactly:
   `builder: #<item> <done|partial|blocked|idle> <first sha>..<last sha>`
   then two or three lines: what changed, check result, anything QA should look
   at hardest.

## 6. Continue

If ready work remains, the daily cap is not reached, and no continuation is
already scheduled (list routines; look for a pending one-shot named
`Builder: next cycle`), schedule one with `send_later`, delay
`[builder].continuation_delay_minutes`, message
`Builder: next cycle. Follow agents/roles/builder.md.` Otherwise end; the
heartbeat routine restarts the chain.

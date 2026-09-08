# Contributing

The database is 32 entries across 17 categories. That is a seed, not a survey, and the
gaps are visible: `aimodeldb categories` prints the entry count for each one, and several
have a single entry.

## Setup

```bash
git clone https://github.com/thegolfercoder/ai-model-database
cd ai-model-database
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

aimodeldb validate     # must pass with zero errors and zero warnings
pytest -q
```

## Adding an entry

1. **Find the official source first.** The provider's own docs, pricing page, model card or
   release note. An entry backed only by a third-party comparison will be rejected by the
   validator, and that is deliberate — see `docs/METHODOLOGY.md`.

2. **Copy an existing entry as a template.** `data/entries/claude-opus-5.yaml` is the most
   complete; `data/entries/kimi-k3.yaml` shows what a deliberately thin entry looks like
   when only existence could be verified.

3. **Fill in only what the source states.** If the page does not give a context window,
   leave `context_window` out. A blank is honest; a plausible guess is not, and it will
   outlive your memory of having guessed.

4. **List `verified_fields` accurately.** Only the fields you actually checked against a
   source. Everything else is editorial judgement and the tool labels it as such.

5. **Write at least one weakness.** The validator rejects an entry without one. Every tool
   has trade-offs, and an entry that lists none is advertising. "The licence is not
   OSI-approved", "pricing is not recorded here", "there is no independent evidence yet" are
   all real weaknesses.

6. **Do not claim it is the best.** The validator rejects comparative superlatives in a
   rationale unless `evidence` cites a source. If a leaderboard genuinely says it, cite the
   leaderboard.

7. **Run the checks.**

   ```bash
   aimodeldb validate      # zero errors AND zero warnings
   pytest -q
   ruff check . && ruff format --check . && mypy
   ```

## Updating an entry

This is the common case, and the one the repository is built around.

```bash
aimodeldb stale                  # what is due
aimodeldb show <slug>            # what the entry currently claims
```

Open the entry's official source. Check each field listed in `verified_fields`. Then:

- Correct anything that has changed.
- Set `verification.last_verified` to **today**, and `sources[].retrieved` on any source you
  reopened.
- If a field can no longer be verified — the page stopped publishing it — delete the field
  rather than leaving a stale value with a fresh date on it.

**Do not bump `last_verified` without opening the source.** It is the only signal this
repository has that an entry might be wrong, and a date that tracks edits rather than checks
is worse than no date at all, because it looks like a check.

## Changing a tier

Tiers are judgements and they can be wrong. Change the `tier` *and* the `rationale` in the
same commit, so the reasoning is visible in the diff. A tier change with an unchanged
rationale will be asked about in review.

## Adding a category

Categories live in `data/taxonomy.yaml` and adding one is a deliberate act: it needs an
`id`, a `label`, the `question` it answers, and a `definition` that says what is in scope
and what is not. Add at least two entries in the same pull request — a category with no
entries answers its own question with silence, and the validator warns about it.

Do not add a category that is a synonym of an existing one. Free-text categories are how a
database becomes an unqueryable pile of near-duplicates within a month, which is why the
vocabulary is controlled.

## Removing an entry

Deprecated or retired models stay, with `status` updated. They are hidden from search by
default and remain reachable with `--include-deprecated`, which is what someone maintaining
an older system needs. Delete an entry only if it never existed.

Check nothing else lists it in `alternatives` first — the validator will catch it, but it is
faster to look.

## What gets rejected

- No official source
- No weaknesses
- An unsupported superlative in a rationale
- A price or context window recorded but not listed in `verified_fields`
- A `last_verified` in the future, or more than 365 days old
- An unknown category, tier, kind, or openness value
- A dangling `alternatives` or `evidence` reference
- A slug that does not match its filename

All of these are checked by `aimodeldb validate`, which runs in CI.

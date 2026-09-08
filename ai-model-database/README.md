# ai-model-database

A structured, source-verified catalogue of AI models and tools, organised by **what they are
for** rather than by who makes them.

```bash
$ aimodeldb ask "what is best for coding"

Which model or tool should I use to write and edit code?
========================================================
Writing, editing, reviewing and debugging code, including agentic work across a
repository rather than single-function completion.

Recommended
-----------
  A sound default for this category for most people, given the evidence cited on the
  entry. Not a claim that it is the best: several entries in one category can hold
  this tier, and where they do the differences between them are in the notes rather
  than in a ranking.

  * Claude Opus 5 (Anthropic)   1M ctx · $5 in / $25 out per 1M tokens
      Positioned by the provider for complex agentic coding, and the model behind
      Claude Code. The 1M-token window matters here specifically: it is what lets a
      session hold a repository rather than a file.
      https://platform.claude.com/docs/en/about-claude/models/overview
  ...
```

Every entry cites the provider's own documentation, records the date a person last checked
it, and lists what it is bad at. Nothing here claims any model is objectively the best,
because that claim cannot be supported — and the validator rejects it if you try.

---

## The three rules

Everything else follows from these, and each is enforced by `aimodeldb validate` in CI
rather than promised in a README.

**1. Every entry cites an official source.** The provider's own docs, pricing page, model
card or release note. An entry backed only by a third-party comparison is a claim about a
claim, and the intermediate step is where errors enter — every aggregator page consulted
while building this contained at least one figure the provider's own documentation
contradicted.

**2. Every entry says what it is bad at.** An entry with no weaknesses is advertising.
The validator refuses to accept one.

**3. Nothing is "the best".** A rationale containing "the best", "state-of-the-art",
"unmatched", "beats all" and similar is rejected unless it cites a source. Sometimes a
leaderboard really does say that, and quoting it with a citation is fine.

## Quick start

```bash
git clone https://github.com/thegolfercoder/ai-model-database
cd ai-model-database
pip install -e .

aimodeldb ask "what should I use for deep research"
aimodeldb ask "what can I run locally"
aimodeldb recommend coding --max-price 1.0
aimodeldb search --open-weights --kind model
aimodeldb show claude-opus-5
aimodeldb compare claude-opus-5 gpt-6-astra
aimodeldb categories
aimodeldb stale
aimodeldb coverage
```

The database is plain YAML in [`data/entries/`](data/entries) — one file per entry. Read it
directly if you would rather not install anything, or build a single JSON document with
`aimodeldb build`.

## What "verified" means here

Two fields do the work, and the distinction between them is the point of the repository.

```yaml
verification:
  last_verified: 2026-09-07
  method: official_docs
  verified_fields: [existence, model_id, pricing, context_window, api, openness]
```

`last_verified` is **the date a person checked the entry against its sources** — not the
date the file was edited. Fixing a typo does not make a price current, and a date that
tracked file changes would destroy the only signal this repository has that something is out
of date.

`verified_fields` lists **only what was actually checked**. Anything not in that list is
editorial judgement, and `aimodeldb show` says so at the bottom of every entry:

```
Last verified 2026-09-07 (1 day ago) by official_docs; fields checked:
existence, model_id, openness, api.
Anything not in that list is editorial judgement rather than a verified fact.
```

This is why some entries have blanks. Google's model listing does not state token limits;
third-party sites do. Rather than copy a number nobody here has read from a primary source,
`gemini-3.8-flash` has no `context_window` and says why in its verification note. `aimodeldb
coverage` reports the gaps rather than hiding them:

```
32 entries from 13 providers

  context_window        22%  #######
  modalities           100%  ##############################
  official_source      100%  ##############################
  pricing               78%  #######################
  pricing_verified      34%  ##########
  weaknesses           100%  ##############################
```

A 22% context-window coverage is a poor showing and it is displayed as one. That is the
intended behaviour: an omitted price is honest, an invented one is not.

## Staleness is a feature, not a chore

An AI model catalogue is wrong by default. Prices change, context windows grow, models are
deprecated, and an entry that was right in March is quietly misleading by July.

- `data/taxonomy.yaml` sets the policy: **90 days to a warning, 365 to a build failure**
- `aimodeldb stale` lists what is due, oldest first
- A [scheduled workflow](.github/workflows/staleness.yml) opens a single tracking issue each
  month naming every stale entry
- CI fails on anything past the hard limit

The automation deliberately does **not** edit a `last_verified` date. An automated bump is
indistinguishable in the file from a real check, and it would erase the signal entirely.

## Categories

17 of them, each defined by the question it answers:

| | |
|---|---|
| General reasoning | Coding |
| Mathematics | Research and synthesis |
| Writing and editing | Image generation |
| Video generation | Audio, speech and music |
| Speech to text | Data analysis |
| Vision and documents | Agentic workflows |
| Long context | Running locally |
| Education | Productivity |
| Embeddings and retrieval | |

The vocabulary is controlled — `data/taxonomy.yaml` — because a free-text category field
turns a database into a pile of near-synonyms within a month and nothing can be queried
afterwards.

Within a category, entries are grouped into evidence-based tiers:

| Tier | Means |
|---|---|
| **Recommended** | A sound default for most people, given the cited evidence. Several entries can hold this. |
| **Strong alternative** | Comparable capability, different price, licence, latency or ecosystem. Choose on constraints. |
| **Specialized** | Better for a narrower slice, worse outside it. The entry says which slice. |
| **Open-weight** | Weights are downloadable. Listed separately because "can I run this myself" overrides capability comparisons rather than sitting on the same axis. |
| **Budget** | Materially cheaper, with a capability gap the entry describes. Cheap and adequate is a real answer. |

Entries are alphabetical within a tier. Any other order would be a ranking nobody can
defend — see [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

## Open weights is not open source

Three values, not two, because conflating them is the most common error in AI catalogues:

| Value | Means |
|---|---|
| `closed` | API only |
| `open-weights` | Downloadable, under a licence that may restrict use |
| `open-source` | OSI-approved licence, no field-of-use restriction |

Llama 4 is `open-weights`: the Llama Community Licence carries acceptable-use terms and a
scale threshold above which you need separate permission. Mistral Large 3 is `open-source`
under Apache 2.0. For a deployment in healthcare, legal or finance, that distinction decides
the answer and outranks every benchmark comparison — which is why it is a schema field and
not a footnote.

```bash
$ aimodeldb search --open-weights --kind model
ministral-3-8b     Ministral 3 8B (Mistral AI)   open-source, Apache-2.0 · self-hosted
llama-4-scout      Llama 4 Scout (Meta)   open-weights, Llama Community License · self-hosted
```

## Architecture

```
ai-model-database/
├── data/
│   ├── entries/          # one YAML file per model or tool — the database
│   └── taxonomy.yaml     # categories, tiers, vocabularies, freshness policy
├── schema/
│   └── entry.schema.json # the machine-readable shape
├── src/aimodeldb/
│   ├── models.py         # typed views over the YAML
│   ├── loader.py         # reading and normalising
│   ├── validate.py       # schema, references, and the editorial rules
│   ├── recommend.py      # question matching, constraints, tier grouping
│   ├── freshness.py      # staleness and coverage
│   ├── render.py         # terminal and markdown output
│   └── cli.py
├── tests/                # 106 tests, most of them over the real data
├── scripts/build_index.py
└── docs/                 # schema reference, methodology
```

**One file per entry** is deliberate. A single large file means every contribution conflicts
with every other, and a review of a one-line price change shows a diff against a
five-thousand-line document. One file per entry makes a price update a four-line diff that
one person can check in a minute — which is the difference between a database that stays
current and one that does not.

## Validation

Three layers, and the third is the unusual one:

1. **JSON Schema** — required keys, types, enums, string lengths
2. **Referential** — categories and tiers that exist, source ids that resolve, slugs matching
   filenames, `alternatives` pointing at real entries
3. **Editorial** — an official source, at least one weakness, no unsupported superlatives, no
   marketing language, no price recorded that nobody verified

A catalogue with no stated weaknesses and a "best in class" on every page is a marketing
site, and nothing about its file format would tell you that. Layer 3 is how the promise at
the top of this README is kept by the build rather than by good intentions.

The test suite includes cases aimed at each rule with data that should trip it. A validator
nobody has tested against bad input is a validator that reports nothing on bad input.

## The recommendation layer

`aimodeldb ask` maps a plain question onto a category and reads the constraints the question
implies — "locally" and "self-host" set an open-weights filter, "cheap" sets a price ceiling.

There is deliberately **no scoring function**. A weighted sum over price, context window and
a benchmark number would produce a number that looks objective and silently asserts an
exchange rate between dollars and capability that holds for nobody. Filtering on constraints
and grouping by evidence is what the data actually supports.

Question matching counts how many of a category's keywords appear, with the longest match as
a tie-break. The first version used longest-match alone and sent *"help me write code"* to
the writing category, because "write" is longer than "code". There is a regression test.

## Current state, honestly

32 entries, 13 providers, 17 categories. That is a seed, not a survey.

- Several categories have one entry. `aimodeldb categories` prints the counts and says a
  single-entry category is a gap.
- Context-window coverage is 22%, because most providers' model pages do not state token
  limits and this database will not copy them from elsewhere.
- Video generation is the thinnest category: most credible options are consumer products
  without public API documentation.
- No benchmark scores are recorded at all. They date faster than everything else, they are
  gameable, and reproducing them properly is a different project.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers adding an entry, updating one, and changing a
tier. Adding an entry is a single YAML file.

## Development

```bash
pip install -e ".[dev]"

aimodeldb validate        # zero errors and zero warnings required
pytest -q                 # 106 tests
ruff check . && ruff format --check .
mypy                      # strict, and clean
python scripts/build_index.py
```

CI runs all of it on Python 3.11 and 3.12, plus every example question in this README — a
documented command that no longer returns an answer fails the build.

## Licence

MIT — see [LICENSE](LICENSE).

The catalogue records what providers publish about their own products. It is not affiliated
with, endorsed by, or reviewed by any of them, and prices and capabilities change without
notice. Check the `last_verified` date on an entry before relying on it.

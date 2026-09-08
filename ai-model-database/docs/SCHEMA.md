# Schema

One YAML file per entry in `data/entries/`, named after its `slug`. The machine-readable
definition is [`schema/entry.schema.json`](../schema/entry.schema.json); this page explains
what each field is *for*, which a JSON Schema cannot.

Run `aimodeldb validate` after any edit. It checks three things: the shape (JSON Schema),
the references (categories, tiers, source ids, alternatives), and the editorial rules.

## Required fields

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Lower-case identifier, must equal the filename stem. Stable forever — other entries reference it. |
| `name` | string | Display name, as the provider writes it. |
| `provider` | string | The organisation responsible. |
| `kind` | enum | `model`, `tool` or `runtime`. Defined in `data/taxonomy.yaml`. |
| `summary` | string | One or two sentences: what it is and who it is for. 20–400 characters. |
| `categories` | list | At least one placement. See below. |
| `sources` | list | At least one, and at least one with `kind: official`. |
| `verification` | object | When a person last checked, how, and which fields. |

## `categories`

```yaml
categories:
  - id: coding                 # must exist in data/taxonomy.yaml
    tier: recommended          # recommended | strong-alternative | specialized | open-weight | budget
    rationale: >               # 20-500 chars: why this tier, for this category
      Positioned by the provider for complex agentic coding, and the 1M-token
      window is what lets a session hold a repository rather than a file.
    evidence: [anthropic-models]   # optional; source ids backing the rationale
```

The tiers are groupings, not a ranking. Several entries can be `recommended` in one
category; where they are, the difference between them belongs in the `rationale` and the
`weaknesses`, not in an ordering. `docs/METHODOLOGY.md` explains why there is no "best"
tier and no score.

`evidence` becomes required in practice if the rationale contains a comparative superlative
— the validator rejects "the best", "state-of-the-art", "unmatched" and similar unless a
source is cited.

## `sources`

```yaml
sources:
  - id: anthropic-pricing      # referenced from pricing.source, context_window.source, evidence
    url: https://platform.claude.com/docs/en/about-claude/pricing
    kind: official             # official | benchmark | secondary
    title: Pricing
    retrieved: 2026-09-07      # the day someone actually opened it
```

`kind: official` means the provider's own documentation, pricing page, model card or
release note. Every entry needs at least one. An entry backed only by journalism or a
third-party comparison cannot be checked by a reader, and the validator refuses it.

## `verification`

```yaml
verification:
  last_verified: 2026-09-07
  method: official_docs        # official_docs | official_site | vendor_announcement | secondary_only
  verified_fields: [existence, model_id, pricing, context_window, api, openness]
  note: >
    Price and context window read directly from the pricing page on the
    retrieval date.
```

Two rules that matter more than the rest of this document:

**`last_verified` is the date a person checked the entry against its sources.** Not the
date the file was edited. Fixing a typo does not make a price current, and a
`last_verified` that tracks file mtime would destroy the only signal this repository has
that something is out of date.

**`verified_fields` lists only what was actually checked.** Anything not in the list is
editorial judgement rather than a verified fact, and `aimodeldb show` says so at the bottom
of every entry. If you record a price you did not read from a source, either read it or
delete it.

## Optional fields

| Field | Notes |
|---|---|
| `model_id` | The exact identifier used in an API call or weight download. |
| `released` | `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, as precisely as it is known. |
| `status` | `available` (default), `preview`, `limited`, `deprecated`, `retired`. Deprecated entries are hidden from search unless `--include-deprecated`. |
| `use_cases` | What people actually reach for it to do. |
| `strengths` | What it is good at. Checked for marketing language. |
| `weaknesses` | **Effectively required** — the validator rejects an entry without one. |
| `context_window` | `input_tokens`, `output_tokens`, a `source` id, and an optional `note` for surcharges and caveats. |
| `modalities` | `input` and `output` lists from a fixed vocabulary. |
| `api` | `available`, `docs_url`, `note`. |
| `openness` | `weights` (`closed` / `open-weights` / `open-source`), `license`, `weights_url`, `parameters`. |
| `pricing` | `unit`, plus `input_usd` / `output_usd` / `amount_usd` and a `source` id. |
| `notes` | Anything a reader should know that does not fit elsewhere. |
| `alternatives` | Slugs of entries worth comparing against. Must resolve. |

### `openness`: three values, not two

`open-weights` and `open-source` are different, and conflating them is the most common
error in AI catalogues. Weights you can download under a licence with acceptable-use terms
and a scale threshold — Llama's, for instance — are **not** open source. Apache 2.0 and MIT
models are. For a deployment in a regulated industry that distinction decides the answer,
and it outranks any benchmark comparison.

### Omitting a field is the correct behaviour

If a source does not state the context window, leave `context_window` out. `aimodeldb
coverage` reports what fraction of entries carry each field, so gaps are visible rather than
hidden — and a blank is honest in a way a plausible guess is not.

Several shipped entries omit `context_window` for exactly this reason: Google's model
listing does not state token limits, third-party sites do, and this database does not carry
a number nobody here has read from a primary source.

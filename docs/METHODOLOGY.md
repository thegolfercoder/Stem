# Methodology

## The question

"Which AI model or tool should I use for X" has a real answer, and it is almost never one
name. It is a short list, with the trade-offs attached, and a note about what would change
the answer. This repository is an attempt to store that shape of answer in a form that can
be kept current.

## Why there is no "best"

Three reasons, in increasing order of how much they matter.

**Benchmarks measure benchmarks.** A model that leads a coding leaderboard may be worse on
your codebase, in your language, at your context length. Published scores are evidence about
published tasks.

**"Best" depends on constraints the catalogue cannot see.** Price, latency, licence,
jurisdiction, whether data may leave your network, whether you have a GPU. An
Apache 2.0 model that runs on your own hardware beats a better hosted model outright for
anyone who cannot send data to a third party — and that is not a capability comparison at
all.

**Any ranking encodes an opinion nobody asked for.** A weighted score over price, context
window and a benchmark number looks objective and is not: it silently asserts an exchange
rate between dollars and tokens and capability. There is no such rate that holds for
everyone.

So entries are grouped into tiers with stated definitions, alphabetical within a tier, and
the differences between them live in the rationale and the weaknesses. `aimodeldb ask`
prints the tier definitions alongside the answers for the same reason.

The rule is enforced rather than promised: the validator rejects a rationale containing "the
best", "state-of-the-art", "unmatched", "beats all" and similar unless it cites a source.
Sometimes a leaderboard really does say that, and quoting it with a citation is fine.

## Why every entry needs an official source

A catalogue is only useful if a reader can check it. An entry backed by a third-party
comparison is a claim about a claim, and the intermediate step is where errors enter — every
aggregator page consulted while building this database contained at least one figure that
the provider's own documentation contradicted.

So: at least one source with `kind: official`, meaning the provider's own docs, pricing page,
model card or release note. Secondary sources may support an entry and may never be its only
support.

## Why `verified_fields` exists

An entry can cite an official source and still contain a number nobody read from it. That is
the failure mode a "sources" list alone does not prevent, and it is the most common one in
practice: someone adds an entry, links the pricing page, and fills the context window in from
memory.

`verified_fields` names what was actually checked. Everything else is editorial judgement,
and `aimodeldb show` says so in as many words at the bottom of each entry. The validator
warns when a price or a context window is recorded but not listed as verified.

This is also why several shipped entries have blanks. Google's model listing does not state
token limits; third-party sites do. The blank is the honest record.

## Why staleness is a first-class feature

An AI model catalogue is wrong by default. Prices change, context windows grow, models are
deprecated, and an entry that was right in March is quietly misleading by July. Nothing about
the file format tells you that.

- Every entry records `last_verified`.
- `data/taxonomy.yaml` sets the policy: 90 days to a warning, 365 to an error.
- `aimodeldb stale` lists what is due.
- A scheduled workflow opens a single tracking issue each month naming every stale entry.
- CI fails on an entry past the hard limit.

The one thing the automation deliberately does *not* do is edit a `last_verified` date.
Bumping the date without opening the source would remove the only signal the repository has,
and an automated bump is indistinguishable from a real check in the file.

## What this database does not do

- **Benchmarks.** No scores are recorded. They date faster than everything else, they are
  gameable, and reproducing them properly is a different project.
- **Rank entries within a tier.** Alphabetical, deliberately.
- **Track terms of service.** Whether generated images can be used commercially, what a
  provider does with your prompts, and what the data-retention policy is are all real
  questions and none of them are here. Several entries say so in their weaknesses.
- **Cover everything.** 32 entries across 17 categories is a seed, not a survey. Categories
  with one entry are gaps, and `aimodeldb categories` prints them as such.

## Contributing to the judgement, not just the data

The tier a model sits in for a category is a judgement, and judgements can be wrong. The
useful form of disagreement is a pull request that changes the tier *and* the rationale, so
the reasoning is visible in the diff. `CONTRIBUTING.md` has the mechanics.

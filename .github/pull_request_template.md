<!--
What this is for: a reader six months from now who is trying to work out why the
code looks like this. Not a changelog - git already has one.
-->

## What changed, and why it needed to

## What it was measured against

<!--
Any accuracy figure here says which clips it came from and whether the model had
seen them. A number from a split the model trained on is not a result. If the
change is not measurable, say so - "no measurable effect, this is a refactor" is
a complete answer.
-->

## What got worse

<!--
Something usually does. A regression written down is a known limitation; the
same regression left out is a surprise for whoever hits it.
-->

## Checks

- [ ] `ruff check .` and `ruff format --check .`
- [ ] `mypy -p swingml -p synth` and `mypy scripts`
- [ ] `pytest -q`, including the real-swing regression rather than only the
      generated clips

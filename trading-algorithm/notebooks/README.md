# Notebooks

`01_research_walkthrough.ipynb` is the same workflow the CLI performs, written
out step by step: load and validate data, split it, run a strategy, read the
result honestly, and check what happens when the cost assumptions change.

The notebook is checked in **without executed output**. That is deliberate: a
notebook carrying its outputs turns every rerun into a diff of base64 images,
and the interesting change is always to the code. Run it yourself:

```bash
pip install -e ".[dev]"
jupyter lab notebooks/01_research_walkthrough.ipynb
```

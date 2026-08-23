"""Synthetic swing sequences with exact ground truth.

No golf video comes with the frame of impact written down. Labelling it by hand
is slow, subjective at the boundaries, and produces a few hundred examples at
best. A generated swing knows exactly where every event falls, can be produced by
the thousand, and can be posed at camera angles nobody happened to film from.

What it cannot do is contain the things nobody thought to model. Everything here
is an argument for training on synthetic data *and then* measuring on real
footage, never for skipping the second part.
"""

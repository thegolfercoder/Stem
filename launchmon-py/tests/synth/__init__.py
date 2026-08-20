"""Synthetic input generators with known ground truth.

Every stage of the pipeline must be testable against an input whose answer is
known exactly. These generators are that input. They are deliberately part of
the test tree and not of the shipped package: nothing in `launchmon` may import
them, so no synthetic assumption can leak into a measurement path.
"""

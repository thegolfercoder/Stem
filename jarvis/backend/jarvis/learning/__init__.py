"""Measuring the assistant, and improving it on evidence.

Five modules, one loop:

    telemetry   every turn is recorded, well or badly
    metrics     what the recorded turns add up to
    versions    the persona as numbered, retirable rows
    evaluation  a deterministic suite, run against any version
    pipeline    propose, evaluate, compare, and the human gate at the end

The rule the whole subsystem exists to enforce: the assistant may propose a
change to its own instructions, but it may not apply one. Proposals are rows,
activation is a person's call, and the version that was live yesterday is still
there to go back to.
"""

from jarvis.learning import evaluation, graders, metrics, pipeline, telemetry, versions

__all__ = ["evaluation", "graders", "metrics", "pipeline", "telemetry", "versions"]

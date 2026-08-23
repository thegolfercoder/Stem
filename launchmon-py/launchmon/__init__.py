"""launchmon: research and validation environment for a budget golf launch monitor.

This package is the reference implementation. Algorithms are developed and proven
here against synthetic inputs with known ground truth, then ported to Swift and
held to the Python results by the golden vector fixture suite.

No module in this package holds global mutable state. Every processing function
takes its parameters explicitly so that replay can vary them.
"""

__all__ = ["constants", "physics", "quantity"]

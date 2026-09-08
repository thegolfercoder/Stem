"""aimodeldb - a source-verified catalogue of AI models and tools, by use case.

Every entry cites at least one official source and records the date a person
last checked it. Nothing here says any model is objectively the best, because
that claim cannot be supported; entries are grouped into evidence-based tiers
and the trade-offs are written down.
"""

from aimodeldb.freshness import assess, coverage, stale
from aimodeldb.loader import Database, DatabaseError, load
from aimodeldb.models import Category, Entry, Taxonomy
from aimodeldb.recommend import Constraints, answer, recommend, search
from aimodeldb.validate import validate_all

__version__ = "0.1.0"

__all__ = [
    "Category",
    "Constraints",
    "Database",
    "DatabaseError",
    "Entry",
    "Taxonomy",
    "__version__",
    "answer",
    "assess",
    "coverage",
    "load",
    "recommend",
    "search",
    "stale",
    "validate_all",
]

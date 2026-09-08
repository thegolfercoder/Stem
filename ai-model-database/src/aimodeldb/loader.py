"""Reading the database off disk.

One YAML file per entry, named after its slug. That choice is deliberate: a
single large file means every contribution conflicts with every other, and a
review of a one-line price change shows a diff against a five-thousand-line
document. One file per entry makes a pull request that updates a price a
four-line diff that one person can check in a minute, which is the difference
between a database that stays current and one that does not.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

from aimodeldb.models import Entry, Taxonomy

DEFAULT_DATA_DIR = Path("data")


class DatabaseError(RuntimeError):
    """Raised when the database cannot be read at all."""


@dataclass(frozen=True)
class Database:
    """Every entry, plus the vocabulary they are written against."""

    entries: tuple[Entry, ...]
    taxonomy: Taxonomy
    root: Path

    def __len__(self) -> int:
        return len(self.entries)

    def __iter__(self) -> Any:
        return iter(self.entries)

    def get(self, slug: str) -> Entry | None:
        for entry in self.entries:
            if entry.slug == slug:
                return entry
        return None

    def by_category(self, category_id: str) -> tuple[Entry, ...]:
        """Entries in a category, ordered by tier then by name.

        Ordering is by tier, and tier order is a display convention rather than
        a ranking. Two entries in the same tier are in alphabetical order,
        because any other order within a tier would be a ranking nobody can
        defend.
        """

        def key(entry: Entry) -> tuple[int, str]:
            placement = entry.placement(category_id)
            tier = placement.tier if placement else ""
            return (self.taxonomy.tier_order(tier), entry.name.lower())

        return tuple(sorted((e for e in self.entries if category_id in e.category_ids), key=key))

    @property
    def providers(self) -> list[str]:
        return sorted({entry.provider for entry in self.entries})


def _isoformat_dates(value: Any) -> Any:
    """Turn the dates YAML helpfully parsed back into ISO strings.

    ``last_verified: 2026-09-07`` is a ``datetime.date`` by the time PyYAML has
    finished with it, and JSON Schema has no date type - only a string with a
    format. Normalising here means a contributor can write a bare date and the
    schema still sees the string it expects, rather than the schema rejecting
    perfectly good YAML for a reason that would take an afternoon to work out.
    """
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _isoformat_dates(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_isoformat_dates(item) for item in value]
    return value


def read_yaml(path: Path) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise DatabaseError(f"{path}: not valid YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise DatabaseError(f"{path}: the top level must be a mapping")
    normalised = _isoformat_dates(raw)
    assert isinstance(normalised, dict)
    return normalised


def load_taxonomy(data_dir: Path | str = DEFAULT_DATA_DIR) -> Taxonomy:
    path = Path(data_dir) / "taxonomy.yaml"
    if not path.exists():
        raise DatabaseError(f"no taxonomy at {path}")
    return Taxonomy.parse(read_yaml(path))


def load_raw_entries(data_dir: Path | str = DEFAULT_DATA_DIR) -> list[tuple[Path, dict[str, Any]]]:
    """Every entry file, unparsed. The validator needs the raw form and the path."""
    directory = Path(data_dir) / "entries"
    if not directory.is_dir():
        raise DatabaseError(f"no entries directory at {directory}")
    paths = sorted(directory.glob("*.yaml")) + sorted(directory.glob("*.yml"))
    if not paths:
        raise DatabaseError(f"no entry files in {directory}")
    return [(path, read_yaml(path)) for path in paths]


def load(data_dir: Path | str = DEFAULT_DATA_DIR) -> Database:
    """Load the whole database.

    Parsing failures name the file. An entry that will not parse is a hard
    error rather than a skipped file: silently dropping one would make
    ``aimodeldb search`` quietly incomplete, which is worse than not running.
    """
    directory = Path(data_dir)
    taxonomy = load_taxonomy(directory)
    entries = []
    for path, raw in load_raw_entries(directory):
        try:
            entries.append(Entry.parse(raw))
        except (KeyError, TypeError, ValueError) as exc:
            raise DatabaseError(f"{path}: {type(exc).__name__}: {exc}") from exc
    return Database(entries=tuple(entries), taxonomy=taxonomy, root=directory)

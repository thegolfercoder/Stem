"""No page module declares the same top-level name twice.

Two function declarations of one name in a module do not fail: the later one
silently replaces the earlier everywhere. A new session summary's `renderSession`
did exactly that to the range session's board, which then never updated (#59).
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import pytest

WEBAPP = Path(__file__).resolve().parent.parent / "webapp"
DECLARED = re.compile(
    r"^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)


@pytest.mark.parametrize("module", sorted(WEBAPP.glob("*.js")), ids=lambda p: p.name)
def test_each_top_level_name_is_declared_once(module: Path) -> None:
    names = Counter(DECLARED.findall(module.read_text(encoding="utf-8")))
    twice = sorted(name for name, count in names.items() if count > 1)
    assert not twice, f"{module.name} declares {twice} more than once"

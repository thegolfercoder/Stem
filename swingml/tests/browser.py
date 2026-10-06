"""Which Chromium the page tests drive, shared by tests/test_page.py and agents/check.sh.

In order: `STEM_CHROMIUM`, the Chromium preinstalled in the cloud containers the
agents run in, and the one `python -m playwright install chromium` downloads (what
CI uses). None when Playwright or every browser is missing, so the caller can say
the page tests did not run rather than that they passed.

    python -m tests.browser    prints the path, or exits 1 saying what is missing
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PREINSTALLED = "/opt/pw-browsers/chromium"


def chromium_path() -> str | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    for candidate in (os.environ.get("STEM_CHROMIUM"), PREINSTALLED):
        if candidate and Path(candidate).exists():
            return candidate
    with sync_playwright() as playwright:
        installed = playwright.chromium.executable_path
    return installed if Path(installed).exists() else None


if __name__ == "__main__":
    found = chromium_path()
    if found is None:
        sys.exit("no Chromium for the page tests: pip install playwright, then "
                 "python -m playwright install chromium (or set STEM_CHROMIUM)")  # fmt: skip
    print(found)

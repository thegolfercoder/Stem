#!/usr/bin/env python3
"""Compile the browser viewer into a single, self-contained HTML file.

The result is one ``.html`` you can double-click (``file://`` -- no local web
server) and it runs. Everything of *ours* is inlined: the bundled ``evosim``
engine source and the front-end script are embedded directly into the page, so
there are no sibling files to keep next to it.

The only thing not embedded is the Pyodide runtime itself (CPython+NumPy on
WebAssembly, ~15 MB), which still streams from its public CDN the first time
the page is opened -- it is far too large to bake into a clickable file, and
the browser caches it after the first load. So the single file needs internet
access on first open, then works from cache.

Usage::

    python -m scripts.build_single                 # -> dist/index.html (Survival view)
    python -m scripts.build_single --page index     # bundle the full scientific viewer
    python -m scripts.build_single --out where.html
"""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

# Which front-end each page uses (its <script src> that we must inline).
PAGES = {
    "survival": ("survival.html", "survival.js"),
    "index": ("index.html", "app.js"),
    "evidence": ("evidence.html", "evidence.js"),
}


def inline(page: str) -> str:
    html_name, js_name = PAGES[page]
    html = (WEB / html_name).read_text(encoding="utf-8")
    pkg = (WEB / "evosim_pkg.js").read_text(encoding="utf-8")
    appjs = (WEB / js_name).read_text(encoding="utf-8")

    # Guard against an accidental </script> inside embedded source closing our
    # inline block early (there is none today, but stay safe).
    pkg = pkg.replace("</script>", "<\\/script>")
    appjs = appjs.replace("</script>", "<\\/script>")

    replacements = {
        '<script src="evosim_pkg.js"></script>': f"<script>\n{pkg}\n</script>",
        f'<script src="{js_name}"></script>': f"<script>\n{appjs}\n</script>",
    }
    for src, inlined in replacements.items():
        if src not in html:
            raise SystemExit(f"Could not find script tag to inline: {src!r}")
        html = html.replace(src, inlined)

    if "evosim_pkg.js" in html or f'src="{js_name}"' in html:
        raise SystemExit("Inlining left a dangling local reference.")
    return html


def main() -> None:
    ap = argparse.ArgumentParser(description="Compile a single-file EvoSim page")
    ap.add_argument("--page", choices=sorted(PAGES), default="survival",
                    help="which viewer to bundle (default: survival)")
    ap.add_argument("--out", help="output path (default: dist/index.html)")
    args = ap.parse_args()

    out = Path(args.out) if args.out else ROOT / "dist" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(inline(args.page), encoding="utf-8")
    kb = out.stat().st_size / 1024
    print(f"Wrote {out} ({kb:.0f} KB) — self-contained; open it directly in a browser.")


if __name__ == "__main__":
    main()

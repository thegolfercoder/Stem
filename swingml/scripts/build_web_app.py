"""Fuse the browser app into one file that can be opened by double-clicking it.

Modules are pleasant to write and a nuisance to distribute: a page split across
four scripts cannot be opened from a file path, because browsers refuse
cross-origin module imports from ``file://``. Inlining them removes the last
reason this needs a server, a terminal or an install.

The weights go in as base64 in the same file. It costs a third in size and buys
the property that matters - the whole analyser is one thing that can be emailed,
copied to a memory stick and opened.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

MODULES = ("engine.js", "model.js", "metrics.js", "app.js")

EXPORT_PATTERN = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
IMPORT_PATTERN = re.compile(
    r"^import\s*\{([^}]*)\}\s*from\s*['\"]\./([\w.]+)['\"];?\s*$", re.MULTILINE
)


def module_key(name: str) -> str:
    return "__mod_" + name.replace(".js", "").replace("-", "_")


def bundle(source: str, name: str) -> str:
    """Wrap one module so it keeps its own scope and hands back its exports.

    Concatenating the files and deleting the keywords was the obvious approach and
    it is wrong: two modules that each define a private helper called `mid` then
    collide, the whole script dies on a duplicate declaration, and the page loads
    looking perfectly healthy while doing nothing at all. Which is exactly what
    happened.

    Giving each module a function scope costs four lines and makes that class of
    fault impossible rather than merely unlikely.
    """
    exported = EXPORT_PATTERN.findall(source)
    body = IMPORT_PATTERN.sub(
        lambda m: f"const {{{m.group(1).strip()}}} = {module_key(m.group(2))};", source
    )
    body = re.sub(r"^export\s+", "", body, flags=re.MULTILINE)
    names = ", ".join(exported)
    return (
        f"const {module_key(name)} = (function () {{\n{body}\n"
        f"return {{ {names} }};\n}})();\n"
        f"const {{ {names} }} = {module_key(name)};\n"
    )


def mp4box(source: Path) -> str:
    """The MP4 demuxer, inlined, with the copyright notice its licence requires.

    Inlined rather than loaded from a CDN because hosts that serve this page refuse
    scripts from most places, and a demuxer that fails to load would quietly send
    every phone clip down the slow path that drops frames.
    """
    vendor = source / "vendor"
    notice = (vendor / "mp4box.LICENSE").read_text(encoding="utf-8").strip()
    code = (vendor / "mp4box.all.min.js").read_text(encoding="utf-8")
    if "</script" in code.lower():
        raise SystemExit("mp4box.all.min.js contains </script and cannot be inlined")
    return "/* mp4box.js - " + notice.replace("*/", "* /") + " */\n" + code


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("out/web/model.json"))
    parser.add_argument("--source", type=Path, default=Path("webapp"))
    parser.add_argument("--out", type=Path, default=Path("out/web/swing-analysis.html"))
    args = parser.parse_args()

    if not args.model.is_file():
        raise SystemExit(f"{args.model} not found - run scripts/export_web_model.py first")

    html = (args.source / "index.html").read_text(encoding="utf-8")
    for token, name in zip(
        ("/*__ENGINE__*/", "/*__MODEL__*/", "/*__METRICS__*/", "/*__APP__*/"),
        MODULES,
        strict=True,
    ):
        html = html.replace(token, bundle((args.source / name).read_text("utf-8"), name))

    payload = args.model.read_text(encoding="utf-8")
    html = html.replace("/*__PAYLOAD__*/", payload)
    html = html.replace("/*__MP4BOX__*/", mp4box(args.source))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")

    size = args.out.stat().st_size
    weights = json.loads(payload)["architecture"]
    print(f"wrote {args.out}  ({size / 1e6:.1f} MB)")
    print(f"  {weights['channels']} channels, dilations {weights['dilations']}")
    print("  open it by double-clicking; no server, no install")


if __name__ == "__main__":
    main()

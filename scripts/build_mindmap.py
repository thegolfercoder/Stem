#!/usr/bin/env python3
"""Generate an Obsidian vault that maps the whole project as a mind map.

Obsidian renders a graph from markdown notes linked with ``[[wikilinks]]``. This
script writes one note per source file and links them along the *real* code
dependencies (parsed from Python ``import`` statements with :mod:`ast`), so the
graph is an accurate map of how EvoSim fits together rather than a hand-drawn
guess. A few manually described nodes cover the browser layer (JS/HTML) and the
top-level "map of content" hub.

Drop the output folder into Obsidian (open it as a vault, or copy it in) and
open the Graph view.

Usage::

    python -m scripts.build_mindmap                 # -> docs/obsidian/
    python -m scripts.build_mindmap --out my/vault
"""

from __future__ import annotations

import argparse
import ast
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY_ROOTS = ["evosim", "scripts", "tests"]


def dotted(path: Path) -> str:
    """Note name for a python file: dotted module path, package for __init__."""
    rel = path.relative_to(ROOT).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def is_pkg(path: Path) -> bool:
    return path.name == "__init__.py"


def summary(tree: ast.Module) -> str:
    doc = ast.get_docstring(tree)
    if not doc:
        return ""
    first = doc.strip().splitlines()[0].strip()
    return first.rstrip(".")


def layer(note: str) -> str:
    if note.startswith("evosim.behavior"):
        return "evosim/behavior"
    if note.startswith("evosim.render"):
        return "evosim/render"
    if note.startswith("evosim.analysis"):
        return "evosim/analysis"
    if note.startswith("evosim"):
        return "evosim/core"
    if note.startswith("scripts"):
        return "scripts"
    if note.startswith("tests"):
        return "tests"
    return "misc"


def resolve_relative(pkg: str, level: int, module: str | None) -> str:
    """Resolve a ``from ... import`` target module to a dotted name."""
    base_parts = pkg.split(".") if pkg else []
    if level > 1:
        base_parts = base_parts[: len(base_parts) - (level - 1)]
    base = ".".join(base_parts)
    if module:
        return f"{base}.{module}" if base else module
    return base


def collect_python() -> dict[str, dict]:
    files: dict[str, dict] = {}
    for r in PY_ROOTS:
        for path in sorted((ROOT / r).rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            note = dotted(path)
            tree = ast.parse(path.read_text(encoding="utf-8"))
            files[note] = {
                "path": str(path.relative_to(ROOT)),
                "summary": summary(tree),
                "tree": tree,
                "pkg": note if is_pkg(path) else note.rsplit(".", 1)[0] if "." in note else "",
                "imports": set(),
            }
    return files


def link_target(raw: str, known: set[str]) -> str | None:
    """Map an imported dotted name to the nearest known note (module or package)."""
    if raw in known:
        return raw
    parts = raw.split(".")
    for i in range(len(parts) - 1, 0, -1):
        prefix = ".".join(parts[:i])
        if prefix in known:
            return prefix
    return None


def parse_imports(files: dict[str, dict]) -> None:
    known = set(files)
    for note, info in files.items():
        for node in ast.walk(info["tree"]):
            if isinstance(node, ast.ImportFrom):
                if node.level:  # relative import -> resolve against this package
                    target = resolve_relative(info["pkg"], node.level, node.module)
                    candidates = [target]
                    for n in node.names:  # names could be submodules
                        candidates.append(f"{target}.{n.name}")
                else:  # absolute import -> module name is literal (e.g. __future__)
                    if not node.module:
                        continue
                    candidates = [node.module]
                for c in candidates:
                    t = link_target(c, known)
                    if t and t != note:
                        info["imports"].add(t)
            elif isinstance(node, ast.Import):
                for n in node.names:
                    t = link_target(n.name, known)
                    if t and t != note:
                        info["imports"].add(t)


# --- browser / non-python layer (described by hand) -------------------------
WEB_NOTES = {
    "web.survival (page)": {
        "path": "web/survival.html + survival.js",
        "layer": "web",
        "summary": "General-audience 'Survival of the Fittest' view (simple, no jargon)",
        "links": ["web.evosim_pkg"],
    },
    "web.index (page)": {
        "path": "web/index.html + app.js",
        "layer": "web",
        "summary": "Full scientific viewer with the live analytics dashboard",
        "links": ["web.evosim_pkg"],
    },
    "web.evosim_pkg": {
        "path": "web/evosim_pkg.js (generated)",
        "layer": "web",
        "summary": "The evosim engine source bundled for the browser (Pyodide)",
        "links": ["evosim", "scripts.build_web"],
    },
    "dist (single files)": {
        "path": "dist/index.html, dist/scientific.html",
        "layer": "web",
        "summary": "Self-contained, double-click single-file builds",
        "links": ["web.index (page)", "web.survival (page)", "scripts.build_single"],
    },
}


def write_vault(files: dict[str, dict], out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    reverse: dict[str, set[str]] = defaultdict(set)
    for note, info in files.items():
        for t in info["imports"]:
            reverse[t].add(note)

    def safe(name: str) -> str:
        return name.replace("/", "-")

    n = 0
    for note, info in files.items():
        lines = [
            "---",
            f"tags: [{layer(note)}]",
            f'file: "{info["path"]}"',
            "---",
            f"# {note}",
            "",
            f"> {info['summary']}" if info["summary"] else "> (no description)",
            "",
            f"**Path:** `{info['path']}`",
            "",
        ]
        if info["imports"]:
            lines.append("## Imports")
            lines += [f"- [[{t}]]" for t in sorted(info["imports"])]
            lines.append("")
        if reverse.get(note):
            lines.append("## Used by")
            lines += [f"- [[{u}]]" for u in sorted(reverse[note])]
            lines.append("")
        (out / f"{safe(note)}.md").write_text("\n".join(lines), encoding="utf-8")
        n += 1

    # browser-layer notes
    for note, info in WEB_NOTES.items():
        lines = [
            "---", f"tags: [{info['layer']}]", f'file: "{info["path"]}"', "---",
            f"# {note}", "", f"> {info['summary']}", "",
            f"**Path:** `{info['path']}`", "", "## Links",
        ]
        lines += [f"- [[{l}]]" for l in info["links"]]
        (out / f"{safe(note)}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        n += 1

    # Mermaid overview of the engine's real dependency edges (core + brains).
    def mid(name: str) -> str:
        return name.replace(".", "_")

    core = [k for k in files if k.startswith("evosim")]
    edges = []
    for note in core:
        for t in files[note]["imports"]:
            if t.startswith("evosim") and t != note:
                edges.append(f"    {mid(note)}[\"{note.replace('evosim.', '')}\"] --> "
                             f"{mid(t)}[\"{t.replace('evosim.', '')}\"]")
    mermaid = ["```mermaid", "graph LR"] + sorted(set(edges)) + ["```"]

    # Map of Content hub
    hub = [
        "---", "tags: [MOC]", "---",
        "# EvoSim — Project Map", "",
        "Open **Graph view** to see the whole system. Start here:", "",
        "## Engine core", "- [[evosim]] — package entry",
        "- [[evosim.simulation]] — perceive → decide → act → live",
        "- [[evosim.organism]] · [[evosim.genome]] · [[evosim.world]] · [[evosim.species]] · [[evosim.spatial]] · [[evosim.config]] · [[evosim.stats]]",
        "",
        "## Brains (pluggable)", "- [[evosim.behavior]] — [[evosim.behavior.base]] · [[evosim.behavior.rule_based]] · [[evosim.behavior.neural]]",
        "",
        "## Visualization & analysis", "- [[evosim.render]] · [[evosim.analysis]]",
        "",
        "## Entry points", "- [[scripts.run_simulation]] · [[scripts.run_headless]] · [[scripts.capture_animation]] · [[scripts.export_blender]]",
        "- [[scripts.build_web]] · [[scripts.build_single]] · [[scripts.build_mindmap]]",
        "",
        "## Browser layer", "- [[web.survival (page)]] · [[web.index (page)]] · [[web.evosim_pkg]] · [[dist (single files)]]",
        "",
        "## Tests", "- [[tests.test_simulation]] · [[tests.test_genome]] · [[tests.test_world]] · [[tests.test_analysis]]",
        "",
        "## Engine dependency graph",
        *mermaid,
    ]
    (out / "EvoSim — Project Map.md").write_text("\n".join(hub) + "\n", encoding="utf-8")
    n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate an Obsidian mind-map vault")
    ap.add_argument("--out", default="docs/obsidian", help="output vault folder")
    args = ap.parse_args()
    files = collect_python()
    parse_imports(files)
    out = ROOT / args.out if not Path(args.out).is_absolute() else Path(args.out)
    count = write_vault(files, out)
    print(f"Wrote {count} notes to {out} — open it as an Obsidian vault and view the graph.")


if __name__ == "__main__":
    main()

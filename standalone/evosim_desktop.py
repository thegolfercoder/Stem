#!/usr/bin/env python3
"""Native desktop shell for EvoSim.

Wraps the self-contained EvoSim.html in a native OS window using a system
webview (WebView2 / Edge-Chromium on Windows, WebKit on macOS/Linux) via
pywebview. The HTML — engine, fonts and all — is bundled into the executable,
so the packaged app has no external files and no browser dependency beyond the
WebView runtime that ships with the OS.

Run from source:      python evosim_desktop.py   (needs: pip install pywebview)
Package (Windows):    pyinstaller --onefile --windowed --name EvoSimApp \
                        --add-data "EvoSim.html;." --collect-all webview \
                        evosim_desktop.py
"""

from __future__ import annotations

import os
import sys

import webview


def resource(name: str) -> str:
    """Locate a bundled data file, whether running from source or a PyInstaller
    one-file build (which extracts data to sys._MEIPASS at runtime)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def main() -> None:
    html_file = resource("EvoSim.html")
    webview.create_window(
        "EvoSim — An Artificial-Life Observatory",
        url=html_file,                 # loaded as file:// so localStorage works
        width=1360,
        height=900,
        min_size=(1120, 760),
        background_color="#0B0E13",
    )
    webview.start()


if __name__ == "__main__":
    main()

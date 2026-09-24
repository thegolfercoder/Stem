"""The analyser as a desktop application: its own window, nothing in a browser tab.

The interface is the same local web application the command line serves, run on a
private port on this machine and shown in a native window through pywebview -
WebKit on a Mac, Edge WebView2 on Windows, GTK or Qt on Linux. Nothing is bundled
that the operating system already has, and nothing leaves the machine: the pose
estimator, the swing model and, when Ollama is installed, the coach all run here.

Where no native window can be opened - pywebview missing, or a machine with no
display - the same application opens in the default browser instead, so the
program never fails to start for want of a window.
"""

from __future__ import annotations

import argparse
import socket
import threading
import time
import urllib.request
import webbrowser
from collections.abc import Callable
from pathlib import Path

from werkzeug.serving import make_server

TITLE = "Swing Studio"


def free_port() -> int:
    """A port nothing is listening on, chosen by the operating system."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


class LocalServer:
    """The web application on 127.0.0.1, in a background thread.

    Bound to the loopback address only, so nothing else on the network can reach
    a person's swings while the window is open.
    """

    def __init__(self, model_path: Path | None = None, port: int | None = None) -> None:
        from swingml.web.app import create_app

        self.app = create_app(model_path=model_path)
        self.port = port or free_port()
        self._server = make_server("127.0.0.1", self.port, self.app, threaded=True)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/"

    def start(self) -> LocalServer:
        self._thread.start()
        self._wait_until_up()
        # The model and the pose estimator take a few seconds to build. Doing it
        # now, while the window opens, means the first clip starts at once.
        service = self.app.extensions["swingml"]["service"]
        threading.Thread(target=_quietly(service.warm_up), daemon=True).start()
        return self

    def _wait_until_up(self, timeout_s: float = 20.0) -> None:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(self.url + "health", timeout=2) as response:
                    if response.status == 200:
                        return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError(f"the local server did not come up on {self.url}")

    def stop(self) -> None:
        self._server.shutdown()


def _quietly(function: Callable[[], object]) -> Callable[[], None]:
    def run() -> None:
        try:
            function()
        except Exception as error:  # a missing model is reported by the page itself
            print(f"warm-up skipped: {error}")

    return run


def open_window(url: str) -> bool:
    """Show the application in a native window; False if one cannot be opened."""
    try:
        import webview  # type: ignore[import-not-found]  # pywebview
    except ImportError:
        return False
    try:
        webview.create_window(
            TITLE,
            url,
            width=1280,
            height=880,
            min_size=(900, 640),
            text_select=True,
        )
        webview.start()
    except Exception as error:  # no display, no GUI toolkit
        print(f"no native window ({error}); opening the browser instead")
        return False
    return True


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="swingml-desktop", description=__doc__)
    parser.add_argument("--model", type=Path, default=None, help="a specific checkpoint")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument(
        "--browser", action="store_true", help="open in the default browser, not a window"
    )
    args = parser.parse_args(argv)

    server = LocalServer(model_path=args.model, port=args.port).start()
    print(f"{TITLE} is running at {server.url}")
    if not args.browser and open_window(server.url):
        server.stop()
        return
    webbrowser.open(server.url)
    print("Close this terminal, or press Ctrl+C, to quit.")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        server.stop()


if __name__ == "__main__":
    main()

"""`jarvis` on the command line.

Three commands, which is all a personal application needs: start it, create the
owner without a browser, and say where the data is.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys

from jarvis import __version__
from jarvis.config import get_settings
from jarvis.db import create_all, init_engine, session_scope
from jarvis.services import auth as auth_service


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    settings = get_settings()
    host = args.host or settings.host
    port = args.port or settings.port
    if host not in ("127.0.0.1", "localhost", "::1"):
        print(
            f"warning: binding to {host} exposes every note, task and conversation\n"
            "         JARVIS holds to your network. Use 127.0.0.1 unless you mean it.",
            file=sys.stderr,
        )
    # The application builds its own Settings, which would otherwise report the
    # configured port rather than the one actually being bound - so `--port 9000`
    # printed a link to 8765 and sent you to a page that was not there. Writing
    # the resolved values back into the environment makes the settings true for
    # everything downstream, not just the banner.
    os.environ["JARVIS_HOST"] = host
    os.environ["JARVIS_PORT"] = str(port)
    get_settings.cache_clear()

    uvicorn.run(
        "jarvis.app:app",
        factory=True,
        host=host,
        port=port,
        reload=args.reload,
        log_level="info",
    )
    return 0


def _create_user(args: argparse.Namespace) -> int:
    settings = get_settings()
    settings.ensure_directories()
    init_engine(settings.db_path)
    create_all()

    username = args.username or input("username: ").strip()
    password = getpass.getpass("password: ")
    if password != getpass.getpass("repeat password: "):
        print("The passwords did not match.", file=sys.stderr)
        return 1

    with session_scope() as session:
        try:
            user = auth_service.create_user(
                session, username=username, password=password, display_name=args.display_name or ""
            )
        except auth_service.AuthError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        print(f"created {user.username}")
    return 0


def _reset(args: argparse.Namespace) -> int:
    """Delete the local data and start clean.

    Deliberately blunt: it removes the database file and the documents JARVIS
    copied in, rather than issuing DELETEs table by table. A reset that leaves
    an account, a session row or a stray file behind is not a reset, and the
    surest way to leave nothing behind is to not have a file.
    """
    import shutil

    settings = get_settings()
    targets = [settings.db_path, settings.documents_dir, settings.memory_dir, settings.uploads_dir]
    # An empty directory is not data. Without this, a second reset reports
    # deleting something because the first one recreated the folders.
    existing = [t for t in targets if t.is_file() or (t.is_dir() and any(t.iterdir()))]

    print("This deletes, permanently:")
    print(f"  the account, memories, documents and chat history in {settings.db_path}")
    print(f"  every file JARVIS copied into {settings.documents_dir}")
    print("Your API key and the code itself are untouched.")

    if not existing:
        print("\nNothing to delete - this installation is already clean.")
        return 0

    if not args.yes:
        try:
            answer = input('\nType "reset" to confirm: ').strip()
        except EOFError:
            answer = ""
        if answer != "reset":
            print("Left alone.")
            return 1

    for path in existing:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    # SQLite keeps a write-ahead log beside the database; it holds data too.
    for suffix in ("-wal", "-shm"):
        settings.db_path.with_name(settings.db_path.name + suffix).unlink(missing_ok=True)

    settings.ensure_directories()
    print("\nDone. The next start will ask you to create the account again.")
    return 0


def _where(_: argparse.Namespace) -> int:
    settings = get_settings()
    print(f"database   {settings.db_path}")
    print(f"documents  {settings.documents_dir}")
    print(f"uploads    {settings.uploads_dir}")
    print(f"memory     {settings.memory_dir}")
    print(f"logs       {settings.log_dir}")
    print(f"api key    {'found in environment' if settings.anthropic_api_key else 'NOT SET'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jarvis", description="A private, local-first assistant.")
    parser.add_argument("--version", action="version", version=f"jarvis {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the local web application")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    serve.add_argument("--reload", action="store_true", help="restart on code changes")
    serve.set_defaults(func=_serve)

    create = sub.add_parser("create-user", help="create the owner account")
    create.add_argument("--username", default=None)
    create.add_argument("--display-name", default=None)
    create.set_defaults(func=_create_user)

    where = sub.add_parser("where", help="print where local data lives")
    where.set_defaults(func=_where)

    reset = sub.add_parser("reset", help="delete all local data and start clean")
    reset.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    reset.set_defaults(func=_reset)

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

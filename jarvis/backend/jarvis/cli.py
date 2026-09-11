"""`jarvis` on the command line.

Three commands, which is all a personal application needs: start it, create the
owner without a browser, and say where the data is.
"""

from __future__ import annotations

import argparse
import getpass
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

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

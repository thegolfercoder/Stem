# JARVIS

A private, local-first personal assistant. It runs on one machine, keeps
everything it knows in a SQLite file you can copy or delete, and borrows
intelligence from a cloud model one request at a time.

```
you -> JARVIS (local) -> local memory and tools -> cloud model -> JARVIS -> you
```

The direction of that arrow matters. Your computer is the source of truth; the
model is a service it calls. Nothing is synced, there is no account, and the
only thing that ever leaves the machine is the context assembled for a single
question.

**Phase 1 is built and working.** Login, chat with streaming answers,
conversation history, local tool calling, settings, and a delete-everything
button. Memory, notes, files and RAG are phase 2; tasks, calendar, school and
projects are phase 3. The interface lists those sections and says plainly that
they are not built yet rather than showing invented rows.

## Running it

```bash
cd jarvis
pip install -e ".[dev]"          # once

cp .env.example .env             # then put your API key in .env
jarvis serve                     # http://127.0.0.1:8765
```

Open <http://127.0.0.1:8765>. The first visit asks you to create the account for
this machine; after that it asks for the password.

Other commands:

```bash
jarvis serve --reload            # restart on code changes, for development
jarvis serve --port 9000         # somewhere else
jarvis create-user               # create the owner without a browser
jarvis where                     # print where your data lives, and whether a key was found
```

The key goes in `jarvis/.env`:

```
JARVIS_ANTHROPIC_API_KEY=sk-ant-...
```

`ANTHROPIC_API_KEY` is accepted too, if you already export one. It is read from
the environment on every request and never written to the database, so no backup
of `data/` can carry it and no page can display it.

## How it is put together

```
jarvis/
  backend/jarvis/
    app.py                 the FastAPI application
    cli.py                 serve, create-user, where
    config.py              settings from the environment; where "local" is
    db.py  models.py       SQLite, and the five tables phase 1 needs
    security.py            scrypt passwords, hashed session tokens
    context.py             *the border* - assembles what leaves the machine
    ai/                    the cloud model, behind one small interface
    tools/                 local functions the model may ask for
    services/              what JARVIS does: auth, conversations, one chat turn
    api/                   HTTP; translation only
  frontend/                one HTML page, one stylesheet, one script
  config/system_prompt.md  the persona, editable without touching code
  data/                    your database, documents, uploads   (never committed)
  logs/                    rotating logs, no message content   (never committed)
  tests/
```

Four pieces are worth knowing about before changing anything.

**`context.py` is the border.** Every request to the cloud is assembled in one
place, with explicit ceilings on how much may go: twelve snippets, two thousand
characters each, twelve thousand overall. Retrieval happens through a registry
of `ContextSource` objects. Phase 1 registers none, so a request carries the
persona, the date, and the conversation - and a test asserts exactly that. Phase
2 registers the memory store and the document index against the same interface
and nothing else changes.

**`ai/` hides the provider.** The rest of the application speaks in neutral
types - `ProviderMessage`, `ToolSpec`, `TextEvent` - and `AnthropicProvider`
maps them to the Messages API. A second provider, or a local model in phase 5,
is a new file implementing `ChatProvider`, not a rewrite. The provider also
degrades: optional features (server-side refusal fallbacks, summarised thinking)
are dropped one at a time if your account or SDK rejects them, so a missing beta
costs you a feature rather than the assistant.

**`tools/` is how JARVIS acts.** A tool gets a `ToolContext` carrying the user
id and the database session, and can only touch that user's rows - the model
never names whose records to read. Phase 1 ships `search_conversations`, because
past conversations are the only data phase 1 has. `save_memory`, `create_task`,
`get_calendar` and the rest register with one line each when the tables they act
on exist.

**One chat turn** lives in `services/chat.py` and is a generator of plain
dictionaries. The router turns them into server-sent events; a voice interface
would turn the same events into something else. Nothing HTTP-shaped is in there.

## What keeps it private

- **The data never leaves.** One SQLite file plus a folder of documents, both
  under `data/`, both gitignored. No sync, no telemetry, no account.
- **Only the minimum is sent.** Enforced by the budgets in `context.py`, not by
  convention. `preview_request()` renders exactly what would be sent.
- **The key is environment-only.** There is no endpoint that returns it and no
  settings field that writes it.
- **Loopback by default.** `jarvis serve` binds to 127.0.0.1 and warns loudly if
  you bind anywhere else.
- **A real lock.** Locking deletes the session row; it does not merely hide the
  interface. Changing your password ends every session everywhere.
- **Cross-site requests are refused.** Every state-changing call must carry an
  `X-Jarvis-Client` header, which a browser will not attach to a cross-origin
  request without a preflight this server never answers.
- **Delete means delete.** The erase button issues a `DELETE` against the local
  database, and there is nowhere else holding a copy.

A caveat worth stating: the database is not encrypted at rest. Anyone with your
unlocked computer can read `jarvis.db` directly. Point `JARVIS_DATA_DIR` at an
encrypted volume if that matters to you.

## Checks

```bash
ruff check . && ruff format --check .
mypy -p jarvis
pytest -q
```

The suite runs against a temporary database and a scripted model, so it needs no
API key and no network. It covers the login and lock paths, conversation
scoping, one full chat turn including the tool round-trip, the context budgets,
the provider's event mapping and its degradation ladder, and the fact that the
API key never reaches the browser.

## Roadmap

| Phase | What arrives | State |
|---|---|---|
| 1 | Local web app, login, chat, streaming, SQLite, conversation history, tool architecture | **Done** |
| 2 | Persistent memory, notes, files, embeddings and RAG | Interfaces in place |
| 3 | Tasks, calendar, school, projects | Planned |
| 4 | More tools, automation, memory management, notifications | Planned |
| 5 | Voice, computer automation, a local model as fallback | Planned |

# JARVIS

A private, local-first personal assistant. It runs on one machine, keeps
everything it knows in a SQLite file and a folder you can copy or delete, and
borrows intelligence from a cloud model one request at a time.

```
you -> JARVIS (local) -> memory, documents, tools -> cloud model -> JARVIS -> you
```

The direction of that arrow is the whole design. Your computer is the source of
truth; the model is a service it calls. Nothing is synced, there is no account,
and the only thing that ever leaves the machine is the context assembled for a
single question - which you can read back afterwards, verbatim, on the settings
page.

**Phases 1 and 2 are built and working.** Login, streaming chat, conversation
history and tool calling; persistent memory, a document index, local retrieval
and the context manager that budgets what gets sent. Tasks, calendar, school and
projects are phase 3. The sections that are not built say so in the sidebar
rather than showing invented rows.

## Running it

```bash
cd jarvis
pip install -e ".[dev]"          # once

cp .env.example .env             # then put your API key in .env
jarvis serve                     # http://127.0.0.1:8765
```

Open <http://127.0.0.1:8765>. The first visit asks you to create the account for
this machine; after that it asks for the password.

```bash
jarvis serve --reload            # restart on code changes, for development
jarvis serve --port 9000         # somewhere else
jarvis create-user               # create the owner without a browser
jarvis where                     # where your data lives, and whether a key was found
```

The key goes in `jarvis/.env`:

```
JARVIS_ANTHROPIC_API_KEY=sk-ant-...
```

`ANTHROPIC_API_KEY` works too. It is read from the environment on every request
and never written to the database, so no backup of `data/` can carry it and no
page can display it.

Upgrading an existing installation needs no migration step: the phase 2 tables
are created on the next start, and nothing in the phase 1 tables changed.

## How memory works

A memory is one durable sentence about you - "Sam prefers concise answers", "Sam
wants an A* in Economics". Anything longer belongs in a document.

**Nothing is saved by accident.** There is no path from "a conversation
happened" to "a row was written". A memory appears only when you ask for one,
when you add it by hand on the Memory page, or when the model calls
`save_memory` - which shows in the transcript as a tool call and in the memory
page as a row marked `assistant`. You can turn that last one off in Settings.

Each memory carries a category (one of ten fixed ones), an importance from 1 to
5, a source, optional tags, and a record of when it was last actually used.

**Retrieval, per message:**

1. `intent.py` works out locally what kind of message this is - remember,
   forget, update, recall, or an ordinary question - and which categories the
   words point at. It never decides what is *stored*; a miss costs a little
   retrieval quality and never a lost memory.
2. `services/memory.py` narrows the table in SQL to rows that could match, then
   ranks them in Python with BM25, tilted by importance and by the category the
   intent suggested.
3. The same happens over document passages.
4. `context_manager.py` pools both, keeps the best few inside a hard budget, and
   writes them into the system prompt as a `<context>` block.
5. The request goes to the cloud. Nothing else does.

A search that matches nothing returns nothing. Padding the context with the
least-bad match is how an assistant ends up answering confidently from something
irrelevant.

## How documents work

Drop a file in through the Files page and JARVIS copies it into
`data/documents/`, extracts the text once, splits it into ~900-character
passages on paragraph boundaries, and stores those as rows. Retrieval works over
passages, so a question about one paragraph of a revision guide costs one
paragraph of context rather than the whole guide, and at most two passages from
any one document - otherwise the longest file wins every question on word count
alone.

Readable types: `txt`, `text`, `md`, `markdown`, `rst`, `csv`, `log`, `pdf`.
PDFs need `pypdf`, which is imported lazily: a machine without it loses PDFs and
keeps everything else.

**Notes** are documents you typed instead of uploaded. They are written to the
same folder as markdown and indexed by the same code, so searching, budgeting
and deleting all behave identically and there is no second store to keep in
step.

Deleting a document deletes JARVIS's copy of the file. A delete that leaves the
file indexed-but-hidden is the behaviour this application exists to avoid.

## Retrieval, and why there is no vector database

`retrieval.py` is BM25 over candidates the database has already narrowed, scored
in Python. For a machine holding a few thousand notes that is the right first
move: it works offline, starts instantly, needs no index server, and can be read
in one sitting.

The honest limitation is that it matches words, not meaning - "maths" will not
find "algebra" unless the word is there. `embeddings.py` is the seam where that
gets fixed: an `Embedder` protocol, a `NullEmbedder` that is what ships, a
`blend()` that combines a keyword ranking with a semantic one, and a
`DocumentChunk.embedding_norm` column already in the schema so adding vectors
later is a backfill rather than a migration. Nothing is wired to a model,
because the two ways to do it are a local download or a second cloud service
seeing every note, and neither belongs in a default.

SQLite's FTS5 is available and is the other obvious upgrade path if keyword
search needs to get faster before it needs to get smarter.

## Architecture

```
jarvis/
  backend/jarvis/
    app.py                 the FastAPI application
    cli.py                 serve, create-user, where
    config.py              settings from the environment; where "local" is
    db.py  models.py       SQLite, and the eight tables
    security.py            scrypt passwords, hashed session tokens
    context_manager.py     *the border* - assembles what leaves the machine
    context_sources.py     what it is allowed to consult
    intent.py              what kind of message this is, worked out locally
    retrieval.py           BM25 ranking
    embeddings.py          the seam for semantic search
    ingest.py              file -> text -> passages
    ai/                    the cloud model, behind one small interface
    tools/                 local functions the model may ask for
    services/              memory, documents, conversations, auth, one chat turn
    api/                   HTTP; translation only
  frontend/                one HTML page, one stylesheet, one script
  config/system_prompt.md  the persona, editable without touching code
  data/                    your database, documents, uploads   (never committed)
  logs/                    rotating logs, no message content   (never committed)
  tests/
```

```
                      JARVIS UI  (one page, no build step)
                             |
                      FastAPI  (jarvis/api)
                             |
        +--------------------+--------------------+
        |                    |                    |
     memory              documents           conversations
    (SQLite)         (SQLite + files)          (SQLite)
        |                    |                    |
        +---------> context_manager.py <----------+
                    intent, ranking, budgets
                             |
                       cloud model
                             |
                        response
```

Five things are worth knowing before changing anything.

**`context_manager.py` is the border.** Every request is assembled in one place,
with explicit ceilings: twelve snippets, eight per source, two thousand
characters each, twelve thousand overall. Retrieval happens through a registry
of `ContextSource` objects, and each is handed a `RetrievalRequest` carrying the
user id and the database session - scoping is the application's decision, never
the model's. Every build leaves a `ContextTrace` behind.

**`ai/` hides the provider.** The rest of the application speaks in neutral
types, and `AnthropicProvider` maps them to the Messages API. A second provider,
or a local model in phase 5, is a new file implementing `ChatProvider`. It also
degrades: optional features are dropped one at a time if your account or SDK
rejects them, so a missing beta costs a feature rather than the assistant.

**`tools/` is how JARVIS acts.** A tool gets a `ToolContext` with the user id and
session and can only touch that user's rows. Eight are registered:
`search_conversations`, `save_memory`, `search_memory`, `update_memory`,
`delete_memory`, `list_memories`, `search_files`, `list_documents`.

**`services/chat.py` is one turn**, as a generator of plain dictionaries. The
router turns them into server-sent events; a voice interface would turn the same
events into something else.

**Nothing is duplicated.** Notes reuse the document index; conversation search
reuses the ranker; the memory page, the tools and the retrieval path all go
through `services/memory.py`.

## Database

Eight tables, all in `data/jarvis.db`.

| Table | What it holds |
|---|---|
| `users` | The owner. One row. |
| `auth_sessions` | Logged-in browsers, as token *hashes* with an expiry. |
| `conversations` | One chat thread each. |
| `messages` | One turn each, with the model and token counts that produced it. |
| `app_settings` | Settings the page can change. Never secrets. |
| `memories` | `category`, `content`, `importance` 1-5, `source`, `tags`, `created_at`, `updated_at`, `last_used_at`, `use_count`. |
| `documents` | `filename`, `path`, `category`, `subject`, `tags`, `content_type`, `size_bytes`, `content_hash`, `excerpt`, `chunk_count`, timestamps. |
| `document_chunks` | `ordinal`, `text`, `char_start`, `embedding_norm` (null until an embedder exists). |

Memory categories: `personal`, `school`, `subjects`, `preferences`, `goals`,
`projects`, `people`, `routines`, `important_facts`, `instructions`.

## API

Everything is under `/api`, scoped to the signed-in owner, and every
state-changing call needs an `X-Jarvis-Client` header.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/setup` `/login` `/logout` `/password` | First run, sign in, lock, change password |
| GET | `/api/auth/status` `/me` | Who is signed in |
| GET | `/api/status` | Dashboard counts |
| GET/PUT | `/api/settings` | AI configuration (never the key) |
| POST | `/api/chat` | Send a message; answer streams back as SSE |
| GET/POST | `/api/conversations` | List, create |
| GET | `/api/conversations/search?q=` | Search past messages |
| GET/PATCH/DELETE | `/api/conversations/{id}` | Read, rename, delete |
| GET/POST | `/api/memory` | List, create |
| GET | `/api/memory/search?q=` | Ranked memory search |
| GET | `/api/memory/categories` | The fixed category list |
| GET/PUT/DELETE | `/api/memory/{id}` | Read, update, delete |
| GET/POST | `/api/documents` | List, upload (multipart) |
| GET | `/api/documents/search?q=` | Ranked passage search |
| GET/DELETE | `/api/documents/{id}` | Read, delete (removes the file too) |
| GET/POST | `/api/notes` | List, write |
| GET | `/api/notes/{id}/text` | The note's text, for editing |
| GET | `/api/context/recent` | **What was actually sent to the cloud** |
| POST | `/api/memory/erase` | Delete, by scope |

## What keeps it private

- **The data never leaves.** One SQLite file plus a folder of documents, both
  under `data/`, both gitignored. No sync, no telemetry, no account.
- **Only the minimum is sent.** Enforced by budgets in `context_manager.py`, not
  by convention, and asserted by tests that seed a database with an address and
  a passport number and check they stay put while the economics goal goes.
- **You can check it yourself.** Settings → *What was sent to the cloud* shows
  the last few requests verbatim: the system prompt, which local records were
  used, how many characters went. Held in memory only and cleared when you
  delete memory - a permanent record of the context would be a second copy of
  your data.
- **Retrieval is scoped by the application.** Sources are handed the user id;
  the model cannot name whose records to read.
- **The key is environment-only.** No endpoint returns it, no settings field
  writes it.
- **Loopback by default**, with a warning if you bind anywhere else.
- **A real lock.** Locking deletes the session row. Changing your password ends
  every session everywhere.
- **Cross-site requests are refused** via a required custom header a browser
  will not attach cross-origin without a preflight this server never answers.
- **Delete means delete.** `POST /api/memory/erase` with a scope of
  `conversations`, `memories`, `documents` or `all` issues real DELETEs and
  unlinks the document files. There is nowhere else holding a copy.

Two things it does not do: the database is **not encrypted at rest** (point
`JARVIS_DATA_DIR` at an encrypted volume if that matters), and turning on
*Log what is sent to the cloud* writes personal context into `logs/jarvis.log`,
which is useful while developing and worth turning off afterwards.

## Checks

```bash
ruff check . && ruff format --check .
mypy -p jarvis && mypy tests
pytest -q
```

166 tests, no API key and no network: a temporary database and a scripted model.
They cover the login and lock paths, conversation scoping, a full chat turn
including the tool round-trip, memory save/search/update/delete and relevance,
document indexing, chunking, PDF extraction and passage search, conversation
search, context construction and its budgets, intent detection, the ranker, the
embedding seam, and the privacy filtering above.

## Roadmap

| Phase | What arrives | State |
|---|---|---|
| 1 | Local web app, login, chat, streaming, SQLite, conversation history, tool architecture | **Done** |
| 2 | Persistent memory, notes, documents, local retrieval, RAG, context manager | **Done** |
| 3 | Tasks, calendar, school, projects | Planned |
| 4 | More tools, automation, memory management, notifications | Planned |
| 5 | Voice, computer automation, a local model as fallback | Planned |

# JARVIS

A private, local-first personal assistant. It runs on one machine, keeps
everything it knows in a SQLite file and a folder you can copy or delete, and
borrows intelligence one request at a time - from a cloud model, or from one
running on the same machine.

```
you -> JARVIS (local) -> memory, documents, tools -> cloud model -> JARVIS -> you
```

The direction of that arrow is the whole design. Your computer is the source of
truth; the model is a service it calls. Nothing is synced, there is no account,
and the only thing that ever leaves the machine is the context assembled for a
single question - which you can read back afterwards, verbatim, on the settings
page.

**Phases 1 to 4 are built and working.** Login, streaming chat, conversation
history and tool calling; persistent memory, a document index, local retrieval
and the context manager that budgets what gets sent; a versioned persona, voice,
and an improvement loop that measures itself without being allowed to change
itself; and tasks, with deadlines the assistant can read and write. Calendar,
school and projects are still to come. The sections that are not built say so in the sidebar rather than
showing invented rows.

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
jarvis reset                     # erase everything it knows, keep the code
```

`jarvis reset` returns the installation to a first-run state: the account,
memories, documents, notes, conversations and every recorded turn go, along with
the files under `data/documents`. It prints what it is about to remove and asks
before doing it (`--yes` skips the question). Your API key and the code are not
touched, and the next start asks you to create the account again.

The key goes in `jarvis/.env`:

```
JARVIS_ANTHROPIC_API_KEY=sk-ant-...
```

`ANTHROPIC_API_KEY` works too. It is read from the environment on every request
and never written to the database, so no backup of `data/` can carry it and no
page can display it.

Upgrading an existing installation needs no migration step: new tables are
created on the next start and existing ones are unchanged. On the first start
after upgrading, the persona in `config/system_prompt.md` is copied into the
database as version 1.

## Tasks

A task is a title, a deadline, a priority, and optionally a subject or a
project. The Tasks page groups them the way a person reads a day - overdue,
today, the next seven days, then the ones with no date - and the dashboard shows
only what needs attention, because that is the question the front page exists to
answer.

The part that makes it an assistant rather than a to-do list is that JARVIS can
work the list itself. "I've got a chemistry paper due Friday" creates the task;
"what should I start with?" reads it back in deadline order; "done the lab
report" ticks it off. Four tools do this - `create_task`, `list_tasks`,
`complete_task`, `update_task` - and every one goes through the same boundary as
everything else: the model requests, the local code performs, against a user id
the model never sees.

**On dates, because this is where a task list quietly goes wrong.** Every other
timestamp in the schema is UTC, because every other timestamp records when
something happened. A deadline is not that. "The chemistry paper is due Friday"
is a fact about a square on a calendar, and storing it as an instant means it
can land on Thursday for anyone whose offset works out that way. So `due_on` is
a plain date and `due_time` is an optional wall-clock string, and no conversion
can move a deadline a day.

Relative dates are resolved before they reach storage. The model is told the
current date, so "Friday" becomes a real date in the tool call; the storage layer
accepts `YYYY-MM-DD` and refuses everything else. A date parser on this side
would have to guess which Friday, and a wrong guess is silent - which is why
`create_task` returns an error rather than a best effort when it is handed the
word "friday".

Retrieval treats tasks differently from everything else, on purpose. Memories and
documents answer "what of this is relevant?", which is a search problem. Tasks
answer "what is due?", which is a calendar problem: a question about time gets
the next few deadlines in date order, and a task does not become less due because
the question happened not to contain its words.

## Hosting it

JARVIS binds to loopback by default, and on loopback the login form can only be
reached by whoever is already at the keyboard. Hosted, it is reachable by anyone
who finds the address, and the threat model changes completely. Three things
carry that weight:

- **Guessing is slow.** Failed logins are counted against both the account and
  the caller's address, and after a handful the wait doubles to a five-minute
  ceiling. Counting only the account would let anyone lock you out of your own
  assistant; counting only the address would let a botnet spread its guesses.
  A correct password forgives everything counted before it.
- **The session cookie goes `Secure` over https**, decided from the connection
  rather than a setting somebody has to remember. Behind a reverse proxy the app
  itself speaks http, so it reads `x-forwarded-proto` — which makes that header
  load-bearing, and the supplied Caddy config sets it.
- **TLS is not optional.** Over plain http your password and every answer cross
  the network in the clear. `compose.yaml` does not publish the app's port at
  all; only the proxy can reach it, so there is no way to arrive over http and
  skip the encryption.

```bash
cd jarvis
cp .env.example .env                  # put your key in, if you want the cloud model
$EDITOR Caddyfile                     # your domain instead of jarvis.example.com
docker compose up -d

# once, to create the owner account
docker compose run --rm -e JARVIS_SETUP_PASSWORD='your password' \
  jarvis jarvis create-user --username "Your Name" --display-name "Your Name"
```

The password is read from that command's environment rather than passed as an
argument, because a command line is visible to every other process on the
machine and lands in the shell's history. It is hashed with scrypt before it
touches the database; there is no way to read it back, including for you.

A username may contain a space. It is matched with case and extra whitespace
folded, so a name like "Ada Lovelace" works however carefully it was typed.

**The image holds no secrets.** Your database, documents and key live in a
volume at `/data`, so the image can be rebuilt, replaced or pushed somewhere by
accident without carrying anything personal — and there is a test asserting the
Dockerfile never copies `.env` and never contains a key-shaped string.

Two things to decide for yourself. The database is **not encrypted at rest**, so
anyone with access to the host can read it — point `JARVIS_DATA_DIR` at an
encrypted volume if that matters. And a hosted JARVIS is only as private as the
machine hosting it: on your own hardware nothing changes, on somebody else's the
"local-first" claim now means "first on their computer".

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

## Running without anyone's cloud

Everything here has been local since phase 1 - the data, the retrieval, the
tools, the whole boundary. The intelligence was the exception: it needed an API
key, an account, a bill, and a company that has to keep existing.

It no longer does. Settings → *Where the intelligence comes from* switches
between Claude and a model running on your own machine through
[Ollama](https://ollama.com):

```bash
ollama pull llama3.1:8b     # once
ollama serve                # if it is not already running
```

JARVIS finds it, lists what you have actually pulled, and switches without a
restart. With no `JARVIS_ANTHROPIC_API_KEY` set at all, everything still works:
chat, memory, documents, tasks, and the tools - nothing leaves the machine, and
there is no key to lose.

**The trade, stated rather than discovered.** A model you can run at home is
meaningfully weaker than the best cloud model: it follows long instructions less
reliably and calls tools worse. For "what's due this week?" over your own notes
it is entirely adequate. For hard reasoning it is not. Both are configured at
once and switching is a dropdown, which is the point - the cloud when you want
the better answer, your own machine when you would rather be beholden to nobody.

No SDK was added: Ollama's API is two JSON endpoints and newline-delimited JSON
streaming, and nothing in `ai/ollama_provider.py` is imported unless you select
it. Two shapes there are worth knowing, both found by calling the thing rather
than reading about it - Ollama's tool calls carry no id where Anthropic's do, so
ids are minted in that one file; and tool results go back as their own
`role: "tool"` messages rather than as blocks inside a user message. Absorbing
exactly that kind of disagreement is what the provider seam is for.

## Who it sounds like

The persona lives in `config/system_prompt.md`: lead with the answer, let length
follow substance, say the useful thing rather than the agreeable one, and never
invent what the local context does not support. It is written to be a colleague
who happens to know your files - dry rather than chirpy, and specifically not a
transcription of anyone's film dialogue.

That file is only a seed. On first start it is copied into the `prompt_versions`
table and **the database becomes the source of truth** from then on. Editing the
file afterwards changes nothing, on purpose: if the file still won, editing it
would be a way to put an untested prompt into production without passing any of
the checks below.

## Voice

Off by default; one switch on the settings page turns it on, and it saves
itself. When it is on, the composer grows a microphone and answers are read back.

**No paid dependency was added, because the free option was good enough to be
the default.** Speech recognition and playback run in the browser through the
Web Speech API, which means the audio never reaches the server at all - only the
text it transcribed. Chrome and Edge support it; Firefox does not, and there the
microphone stays hidden rather than pretending.

The point of `jarvis/voice/` is that this stays swappable. Four jobs are named
separately because they have different costs and failure modes - transcription,
speech, wake word, and the conversation loop that uses them - and each is a
`Protocol` in `voice/base.py` with implementations registered in
`voice/registry.py`. Swapping in a local Whisper is one `set_speech_to_text(...)`
call; the chat service imports neither and does not change. Every backend
declares where it runs (`browser`, `local`, `cloud`), and the settings page shows
it, so "does my audio leave this machine?" is answerable by looking rather than
by reading a vendor's documentation.

### Gemini, when the browser is not good enough

The browser's recogniser mangles accents and proper nouns, its voices sound like
a satnav, and Firefox has none of it at all. So there is a second backend:
Google's Gemini, reached over two plain JSON endpoints with no SDK added.

It is off unless you choose it, and **hearing and speaking are chosen
separately**, because they are different trades. Having answers read aloud in a
good voice sends the *answer text* out. Having your speech transcribed accurately
sends *your voice* out. Wanting the first is not consenting to the second, so the
settings page has two dropdowns and not one switch.

Everything that can be said about where the audio goes, is:

- Every Gemini capability reports `location: "cloud"`, and the interface prints
  the consequence in words - "What you say leaves this machine", "Answers leave
  this machine to be spoken" - next to the setting that caused it.
- The **key never reaches the browser.** The page posts text to `/api/voice/speak`
  and audio to `/api/voice/transcribe`; this server holds the key and makes the
  call. That is also why there is a server round trip for something the browser
  could almost do itself.
- The key is environment-only, exactly like the model's: `JARVIS_GEMINI_API_KEY`
  in `.env`, never written to the database, never returned by any endpoint. The
  settings page is told *whether* a key exists and nothing more.
- It travels in the `x-goog-api-key` header, not the `?key=` query parameter that
  every example uses, so it does not end up in anything that logs a URL.
- Choosing Gemini without a key does **not** quietly fall back to the browser. It
  reports unavailable and says what to set, because a privacy setting that
  silently does something other than what it says is worse than one that fails.
- Nothing about the audio is logged, at any level, and no recording is written to
  disk. The bytes go from the upload straight into the request.

Two shapes in that API are worth knowing, both found by calling it rather than
reading about it: synthesis returns **raw headerless PCM** that no browser will
play, so `voice/gemini.py` puts a RIFF header on it; and the transcription model
answers in `audioTranscription.text` rather than the `text` every other Gemini
response uses, so the reader accepts either.

Still on the browser side of the line: the wake word. Real always-on detection
wants a small local model (openWakeWord, Porcupine) and is the next thing here.
Gemini's realtime `bidi` models would do it, but that is a websocket protocol and
a different design, so it is named rather than half-built.

## How it improves, and what it is not allowed to do

The Improvement page is the honest version of "self-improving": the system
measures itself, finds its weak spots, and proposes changes. **A person decides
whether any of it ships.** Nothing here can be reached by the model - these are
owner endpoints behind the session cookie, and the assistant's tools do not
include them. It can be told its answer was bad; it cannot act on that by
changing itself.

The loop:

1. **Every turn is recorded** - question, answer, intent, how many snippets and
   characters of context went, tokens, latency, which tools ran and which
   failed. Local data like any other, covered by the same delete.
2. **You rate answers** with the arrows under any reply. Unrated is not silent
   approval, and the metrics say so.
3. **The numbers are few and actionable**: approval rate, error rate, median and
   95th-percentile latency, context size. *Where it is weak* turns them into
   plain sentences; *Needs a look* lists the turns that errored or you rejected.
4. **Good answers become tests.** *Make this a test case* freezes the question
   together with the context it was answered from, so the case exercises
   retrieval without ever touching your real memories.
5. **A change is a proposal.** New prompt versions are created as drafts and run
   nothing.
6. **The suite judges it against what is live.** Both versions run the same
   cases; the baseline is re-run rather than read from history, so a candidate
   is never credited or blamed for a change someone else made. Grading is
   deterministic - `contains`, `max_chars`, `uses_tool`, `cites_context` and so
   on - because a suite graded by a model has its own drift, and an unknown
   check kind is an error rather than a check that quietly always passes.
7. **Activation is a separate, explicit call.** A version that has not been
   evaluated is refused. A version that breaks a case which currently passes is
   refused, and forcing it writes the override into the record.
8. **Rolling back is one click**, and it skips every gate, because the moment
   you need it is the moment everything else has gone wrong.

What it deliberately does not do: no fine-tuning, no weight updates, and no
writing to its own source. "Improvement" here means a better prompt, chosen by
you, with evidence.

## Architecture

```
jarvis/
  backend/jarvis/
    app.py                 the FastAPI application
    cli.py                 serve, create-user, where, reset
    config.py              settings from the environment; where "local" is
    db.py  models.py       SQLite, and the fifteen tables
    security.py            scrypt passwords, hashed session tokens
    context_manager.py     *the border* - assembles what leaves the machine
    context_sources.py     what it is allowed to consult
    intent.py              what kind of message this is, worked out locally
    retrieval.py           BM25 ranking
    embeddings.py          the seam for semantic search
    ingest.py              file -> text -> passages
    ai/                    the cloud model, behind one small interface
    tools/                 local functions the model may ask for
    voice/                 speech, as protocols - no vendor, no paid dependency
    learning/              telemetry, metrics, graders, evals, prompt versions
    services/              memory, documents, tasks, conversations, auth, one turn
    api/                   HTTP; translation only
  frontend/                one HTML page, one stylesheet, one script
  config/system_prompt.md  the persona; a seed, copied into the database once
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
types; `AnthropicProvider` maps them to the Messages API and `OllamaProvider`
maps them to a model on this machine. Neither is imported by the chat service,
which is why adding the second one changed no code in the turn loop. Anthropic
also degrades: optional features are dropped one at a time if your account or
SDK rejects them, so a missing beta costs a feature rather than the assistant.

**`tools/` is how JARVIS acts.** A tool gets a `ToolContext` with the user id and
session and can only touch that user's rows. Twelve are registered:
`search_conversations`, `save_memory`, `search_memory`, `update_memory`,
`delete_memory`, `list_memories`, `search_files`, `list_documents`,
`create_task`, `list_tasks`, `complete_task`, `update_task`.

**`services/chat.py` is one turn**, as a generator of plain dictionaries. The
router turns them into server-sent events; a voice interface would turn the same
events into something else.

**Nothing is duplicated.** Notes reuse the document index; conversation search
reuses the ranker; the memory page, the tools and the retrieval path all go
through `services/memory.py`.

**`learning/` observes; it does not steer.** `telemetry.py` records turns,
`metrics.py` reads them, `graders.py` marks deterministically, `evaluation.py`
runs the suite and `versions.py` holds the gate that refuses a regression.
`pipeline.py` is the only module that combines them, and even it cannot ship a
version without a separate call from a person. The dependency arrow points one
way: `services/chat.py` writes a row and moves on, and nothing under
`learning/` is importable from a tool.

## Database

Fifteen tables, all in `data/jarvis.db`.

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
| `prompt_versions` | The persona ladder: `number`, `body`, `status` (`draft`/`candidate`/`active`/`retired`), `author`, `notes`, `parent_id`, and when it was activated or retired. |
| `interactions` | One recorded turn: query, answer, intent, snippets, context characters, tokens, latency, tools used, tool errors, error. |
| `feedback` | Your verdict on one interaction. One row per turn - rating again replaces it. |
| `eval_cases` | A question, the fixture context to answer it from, and the checks that must hold. |
| `eval_runs` | One pass of the suite: which version, which baseline, passed, failed, regressions. |
| `eval_results` | One case within a run, with every failure it produced rather than the first. |
| `tasks` | `title`, `notes`, `status`, `priority` 1-4, `due_on` (a date, not an instant), `due_time`, `subject`, `project`, `tags`, `source`, timestamps. |

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
| GET/POST | `/api/tasks` | List what is open, add one |
| GET | `/api/tasks/agenda` | Overdue, today, this week, undated - grouped once |
| GET | `/api/tasks/search?q=` | Find one by title, notes, subject or project |
| PUT/DELETE | `/api/tasks/{id}` | Change it, remove it |
| POST | `/api/tasks/{id}/complete` `/reopen` | Tick it off, put it back |
| POST | `/api/tasks/clear-completed` | Throw away what is finished |
| GET | `/api/voice/profile` | Which backends do speech here, and where they run |
| POST | `/api/voice/speak` | Text in, audio back. Only for non-browser backends |
| POST | `/api/voice/transcribe` | Audio in, text back. Only for non-browser backends |
| GET | `/api/learning/interactions` | Recorded turns |
| GET | `/api/learning/problems` | Turns that errored, failed a tool, or were rated down |
| POST | `/api/learning/feedback` | Rate one answer |
| GET | `/api/learning/metrics` | The numbers, plus what to look at |
| GET/POST | `/api/learning/versions` | The persona ladder; POST proposes a draft |
| POST | `/api/learning/versions/{id}/evaluate` | Run the suite on it and on what is live |
| POST | `/api/learning/versions/{id}/activate` | Ship it. Refused without evidence |
| POST | `/api/learning/versions/rollback` | Go back |
| GET/POST | `/api/learning/cases` | The regression suite |
| DELETE | `/api/learning/cases/{id}` | Remove a case |
| POST | `/api/learning/cases/promote` | Turn an approved answer into a test |
| GET | `/api/learning/runs/{id}` | One run, case by case |

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
  unlinks the document files. There is nowhere else holding a copy. `jarvis
  reset` goes further and returns the whole installation to first-run state.
- **The interface itself asks the network for nothing.** No fonts, no CDN, no
  analytics: every byte the page loads comes from this server, so opening JARVIS
  tells no one that you opened it, and it renders identically with the wifi off.
  A test walks the frontend and fails on any fetch that reaches outside.
- **Voice is local unless you say otherwise.** On the default setting the
  browser transcribes and speaks and no audio reaches even this server. Choosing
  Gemini for either direction sends that direction's audio or text to Google -
  which the settings page states in words, next to the setting, before you pick
  it. The key for it stays on the server and is never sent to the page.
- **Turns are recorded locally, for you.** The improvement loop's measurements
  live in the same database, are covered by the same delete, and are never sent
  anywhere - the model is not told how it scored.

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

294 tests, no API key and no network: a temporary database and a scripted model.
The Gemini backend is covered with `urlopen` replaced by a recorder, so the suite
runs with no key and no quota and a change to the request shape fails an
assertion rather than arriving as a bill.
They cover the login and lock paths, conversation scoping, a full chat turn
including the tool round-trip, memory save/search/update/delete and relevance,
document indexing, chunking, PDF extraction and passage search, conversation
search, context construction and its budgets, intent detection, the ranker, the
embedding seam, task deadlines and grouping, and the privacy filtering above.

The task tests are mostly about dates, because that is where a task list goes
wrong quietly: a deadline that lands a day early is worse than no deadline. None
of them read the clock - "today" is always passed in - so none can break by being
run at a different time of year, or pass only on the day they were written.

The ones worth knowing about are the safety tests around the improvement loop,
because they assert absences rather than features: that a proposal changes
nothing, that evaluation never activates as a side effect, that activation is
refused when a case would regress, that assessment with no cases refuses rather
than passing vacuously, and that no tool exposed to the model touches its own
instructions.

## Roadmap

| Phase | What arrives | State |
|---|---|---|
| 1 | Local web app, login, chat, streaming, SQLite, conversation history, tool architecture | **Done** |
| 2 | Persistent memory, notes, documents, local retrieval, RAG, context manager | **Done** |
| 3 | Persona and versioning, voice, the improvement loop, the command centre | **Done** |
| 4 | Tasks, with deadlines the assistant can read and write | **Done** |
| 5 | Calendar, school, projects | Planned |
| — | **A local model, so none of it needs a cloud at all** | **Done** |
| 6 | Automation, notifications, always-on wake word | Planned |

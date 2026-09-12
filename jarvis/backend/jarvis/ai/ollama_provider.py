"""A model running on this machine, through Ollama.

This is the file that makes JARVIS independent. Everything else here has been
local since phase 1 - the data, the retrieval, the tools, the whole boundary -
but the intelligence was always borrowed, which meant an API key, an account,
a bill, and a company that has to keep existing. With this, the assistant runs
on hardware you own and nothing leaves the machine at all.

The trade is honest and worth stating plainly rather than discovering: a model
you can run at home is meaningfully weaker than the best cloud model, follows
long instructions less reliably, and calls tools worse. For "what's due this
week?" over your own notes it is entirely adequate. For hard reasoning it is
not. Both providers are configured at once and switching is a dropdown, which
is the point - the cloud when you want the better answer, the local model when
you want to be beholden to nobody, and no cloud key needed to have a working
assistant at all.

No SDK: Ollama's API is two JSON endpoints and newline-delimited JSON streaming,
which is less code than the dependency would be, and nothing here is imported
unless the provider is selected.

Two shapes are worth knowing:

- Ollama's tool calls carry no id. Anthropic's do, and the rest of this codebase
  is built around matching a result to the call that asked for it, so ids are
  minted here and the mapping never leaves this file.
- Tool results go back as their own `role: "tool"` messages, not as blocks
  inside a user message the way Anthropic wants them. `_encode` does that
  translation, which is exactly the kind of thing the provider seam exists for.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Iterator, Sequence
from typing import Any

from jarvis.ai.base import (
    ChatRequest,
    CompletionEvent,
    ErrorEvent,
    ProviderEvent,
    ProviderMessage,
    TextContent,
    TextEvent,
    ToolResultContent,
    ToolUseContent,
)

log = logging.getLogger("jarvis.ai.ollama")

DEFAULT_HOST = "http://127.0.0.1:11434"
# A capable default that most machines can actually run, and that supports tool
# calling - which many small local models do not. Overridable in settings.
DEFAULT_MODEL = "llama3.1:8b"

# Generous: a local model on a laptop can take a while to produce its first
# token, especially the first time a model is loaded into memory.
CONNECT_TIMEOUT = 10
STREAM_TIMEOUT = 300


def _url(host: str, path: str) -> str:
    return host.rstrip("/") + path


def installed_models(host: str = DEFAULT_HOST, *, timeout: int = 3) -> list[str]:
    """What is actually pulled on this machine, for the settings page to offer.

    Returns an empty list when Ollama is not running, rather than raising: "not
    installed" is the normal state for most people and is not an error.
    """
    try:
        with urllib.request.urlopen(_url(host, "/api/tags"), timeout=timeout) as response:
            payload = json.loads(response.read())
    except Exception:
        return []
    models = payload.get("models") or []
    names = [str(m.get("name", "")) for m in models if m.get("name")]
    return sorted(names)


def is_running(host: str = DEFAULT_HOST, *, timeout: int = 2) -> bool:
    """Whether there is an Ollama to talk to. One cheap call, no exceptions out."""
    try:
        with urllib.request.urlopen(_url(host, "/api/tags"), timeout=timeout):
            return True
    except Exception:
        return False


class OllamaProvider:
    """A local model, behind the same interface as the cloud one."""

    name = "ollama"

    def __init__(self, host: str = DEFAULT_HOST, *, model: str | None = None) -> None:
        self.host = host or DEFAULT_HOST
        self.model = model or DEFAULT_MODEL

    def is_configured(self) -> bool:
        """Configured means reachable. There is no key to be missing - the only
        way this provider is unavailable is that Ollama is not running."""
        return is_running(self.host)

    # --- the request -------------------------------------------------------

    def _payload(self, request: ChatRequest) -> dict[str, Any]:
        messages: list[dict[str, Any]] = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        for message in request.messages:
            messages.extend(_encode(message))

        payload: dict[str, Any] = {
            "model": request.model or self.model,
            "messages": messages,
            "stream": True,
            "options": {"num_predict": request.max_tokens},
        }
        if request.tools:
            payload["tools"] = [_tool_spec(spec) for spec in request.tools]
        return payload

    def stream(self, request: ChatRequest) -> Iterator[ProviderEvent]:
        try:
            body = json.dumps(self._payload(request)).encode()
        except (TypeError, ValueError) as exc:  # pragma: no cover - defensive
            yield ErrorEvent(message=f"Could not build the request: {exc}")
            return

        http = urllib.request.Request(
            _url(self.host, "/api/chat"),
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        # The model actually asked for, which is not always this provider's
        # default - an error that names the wrong one sends you to pull the
        # wrong thing.
        wanted = request.model or self.model

        try:
            with urllib.request.urlopen(http, timeout=STREAM_TIMEOUT) as response:
                yield from self._consume(response, request)
        except urllib.error.HTTPError as exc:
            yield ErrorEvent(message=_describe_http(exc, wanted), retryable=exc.code >= 500)
        except urllib.error.URLError as exc:
            yield ErrorEvent(message=_describe_down(exc, self.host), retryable=True)
        except TimeoutError:
            yield ErrorEvent(
                message=(
                    "The local model did not answer in time. A large model on a "
                    "small machine can take minutes on the first request; try a "
                    "smaller one, or the cloud model."
                ),
                retryable=True,
            )

    def _consume(self, response: Any, request: ChatRequest) -> Iterator[ProviderEvent]:
        """Ollama streams newline-delimited JSON, one object per chunk."""
        text: list[str] = []
        tool_calls: list[ToolUseContent] = []
        model: str | None = None
        prompt_tokens: int | None = None
        eval_tokens: int | None = None
        stop_reason: str | None = None
        saw_done = False

        for raw in response:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except ValueError:
                # A truncated line is not worth failing the whole turn over.
                log.warning("skipping a malformed chunk from ollama")
                continue

            if chunk.get("error"):
                yield ErrorEvent(message=f"Ollama: {chunk['error']}")
                return

            model = chunk.get("model") or model
            message = chunk.get("message") or {}

            piece = message.get("content") or ""
            if piece:
                text.append(piece)
                yield TextEvent(text=piece)

            for call in message.get("tool_calls") or []:
                encoded = _decode_tool_call(call, len(tool_calls))
                if encoded is not None:
                    tool_calls.append(encoded)

            if chunk.get("done"):
                saw_done = True
                stop_reason = chunk.get("done_reason") or "stop"
                prompt_tokens = chunk.get("prompt_eval_count")
                eval_tokens = chunk.get("eval_count")

        if not saw_done and not text and not tool_calls:
            yield ErrorEvent(
                message=(
                    "The local model returned nothing. Check that "
                    f"{request.model or self.model!r} is pulled: `ollama pull "
                    f"{request.model or self.model}`."
                )
            )
            return

        yield CompletionEvent(
            text="".join(text),
            # A model that asked for tools has not finished; the chat loop keys
            # off this exactly as it does for the cloud provider.
            stop_reason="tool_use" if tool_calls else (stop_reason or "stop"),
            tool_calls=tool_calls,
            model=model or self.model,
            input_tokens=prompt_tokens,
            output_tokens=eval_tokens,
        )


# --- translation -------------------------------------------------------------


def _tool_spec(spec: Any) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.input_schema,
        },
    }


def _encode(message: ProviderMessage) -> list[dict[str, Any]]:
    """One neutral message becomes one or more Ollama messages.

    Anthropic carries tool results as blocks inside a user message; Ollama wants
    each one as its own `role: "tool"` message. A user turn that is nothing but
    tool results must therefore not also produce an empty user message, or the
    model sees a blank turn and often answers it.
    """
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []

    for block in message.content:
        if isinstance(block, TextContent):
            if block.text:
                texts.append(block.text)
        elif isinstance(block, ToolUseContent):
            calls.append({"function": {"name": block.name, "arguments": block.input}})
        elif isinstance(block, ToolResultContent):
            results.append(
                {
                    "role": "tool",
                    "content": block.content if not block.is_error else f"Error: {block.content}",
                }
            )

    out: list[dict[str, Any]] = []
    if texts or calls:
        entry: dict[str, Any] = {"role": message.role, "content": "\n".join(texts)}
        if calls:
            entry["tool_calls"] = calls
        out.append(entry)
    out.extend(results)
    return out


def _decode_tool_call(call: dict[str, Any], index: int) -> ToolUseContent | None:
    """Ollama's tool calls have no id; the rest of this codebase needs one."""
    function = call.get("function") or {}
    name = function.get("name")
    if not name:
        return None

    arguments = function.get("arguments")
    if isinstance(arguments, str):
        # Some models emit the arguments as a JSON string rather than an object.
        try:
            arguments = json.loads(arguments)
        except ValueError:
            arguments = {}
    if not isinstance(arguments, dict):
        arguments = {}

    return ToolUseContent(id=f"local_{index}", name=str(name), input=arguments)


# --- errors worth reading ----------------------------------------------------


def _describe_down(exc: urllib.error.URLError, host: str) -> str:
    return (
        f"Could not reach Ollama at {host}. Start it with `ollama serve`, or "
        "switch the provider back to the cloud model in Settings. "
        f"({exc.reason})"
    )


def _describe_http(exc: urllib.error.HTTPError, model: str) -> str:
    detail = ""
    try:
        payload = json.loads(exc.read())
        detail = str(payload.get("error", ""))
    except Exception:
        # A broken error body must not replace the error it describes.
        pass

    if exc.code == 404:
        return (
            f"Ollama does not have {model!r}. Pull it first: `ollama pull {model}`. "
            f"{detail}".strip()
        )
    return f"Ollama returned {exc.code}. {detail}".strip()


def available_hosts() -> Sequence[str]:  # pragma: no cover - convenience
    """Where Ollama usually is. Named so the settings page has something to
    suggest rather than an empty text box."""
    return (DEFAULT_HOST, "http://localhost:11434")

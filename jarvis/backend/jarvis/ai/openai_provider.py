"""OpenAI's Chat Completions API, behind the same interface as the others.

The third provider, and the one that made the seam worth having: the chat
service still imports none of them, and adding this changed nothing in the turn
loop.

Two shapes here are genuinely awkward, and both are handled in this file so
nothing else has to know.

**Tool calls arrive in fragments.** Anthropic hands over a whole tool call;
OpenAI streams it, and the arguments come as a string split at arbitrary points
across many chunks - sometimes mid-token, sometimes mid-escape-sequence. They
are keyed by `index`, the name usually arrives once at the start, and the id
once too. So `_ToolAccumulator` collects by index and only parses the JSON at
the end, when the string is whole. Parsing early gets you a syntax error on
valid arguments.

**The token-limit parameter has two names.** Older models take `max_tokens`;
the reasoning models and the gpt-5 family reject it and want
`max_completion_tokens`. Rather than keep a list of which is which - a list that
is wrong the moment a model ships - the request sends the modern name and falls
back once if the API objects, the same degradation idea the Anthropic provider
uses for its betas.

No SDK: one endpoint, server-sent events, and `urllib`. Nothing here is
imported unless this provider is selected.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
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

log = logging.getLogger("jarvis.ai.openai")

API_URL = "https://api.openai.com/v1/chat/completions"

# A current, plainly-named general model rather than a dated snapshot or a
# preview: the owner picks their own in Settings, and a default that quietly
# stops existing is worse than one that is merely not the newest.
DEFAULT_MODEL = "gpt-5.5"

TIMEOUT_SECONDS = 300


@dataclass
class _ToolAccumulator:
    """One tool call, assembled from the fragments it arrived in."""

    index: int
    id: str = ""
    name: str = ""
    arguments: str = ""

    def absorb(self, delta: dict[str, Any]) -> None:
        if delta.get("id"):
            self.id = str(delta["id"])
        function = delta.get("function") or {}
        if function.get("name"):
            # Usually once, at the start - but appended rather than replaced, in
            # case a name is ever split the way arguments are.
            self.name += str(function["name"])
        if function.get("arguments"):
            self.arguments += str(function["arguments"])

    def finish(self, ordinal: int) -> ToolUseContent | None:
        if not self.name:
            return None
        try:
            parsed = json.loads(self.arguments) if self.arguments.strip() else {}
        except ValueError:
            # A truncated stream can leave the argument string half-written. An
            # empty object lets the tool report what is missing, which is a far
            # better failure than the whole turn dying here.
            log.warning("tool %s had unparseable arguments; passing none", self.name)
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        return ToolUseContent(
            # The API's own id when there is one; the rest of the codebase needs
            # something to match a result to, so never empty.
            id=self.id or f"call_{ordinal}",
            name=self.name,
            input=parsed,
        )


class OpenAIProvider:
    """OpenAI, streaming, with tools."""

    name = "openai"

    def __init__(self, api_key: str | None, *, model: str | None = None) -> None:
        self.api_key = (api_key or "").strip()
        self.model = model or DEFAULT_MODEL

    def is_configured(self) -> bool:
        return bool(self.api_key)

    # --- the request -------------------------------------------------------

    def _payload(self, request: ChatRequest, *, modern_limit: bool) -> dict[str, Any]:
        messages: list[dict[str, Any]] = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        for message in request.messages:
            messages.extend(_encode(message))

        payload: dict[str, Any] = {
            "model": request.model or self.model,
            "messages": messages,
            "stream": True,
            # Without this the final chunk carries no usage and the interface
            # cannot show what a turn cost.
            "stream_options": {"include_usage": True},
        }
        key = "max_completion_tokens" if modern_limit else "max_tokens"
        payload[key] = request.max_tokens
        if request.tools:
            payload["tools"] = [_tool_spec(spec) for spec in request.tools]
        return payload

    def stream(self, request: ChatRequest) -> Iterator[ProviderEvent]:
        if not self.is_configured():
            yield ErrorEvent(
                message=(
                    "No OpenAI API key. Put JARVIS_OPENAI_API_KEY in .env, or pick a "
                    "different provider in Settings."
                )
            )
            return

        # Modern name first; one retry with the old one if the API objects.
        for modern_limit in (True, False):
            try:
                with urllib.request.urlopen(
                    self._request(request, modern_limit=modern_limit), timeout=TIMEOUT_SECONDS
                ) as response:
                    yield from self._consume(response, request)
                return
            except urllib.error.HTTPError as exc:
                detail = _detail(exc)
                if modern_limit and _is_limit_name_complaint(exc.code, detail):
                    log.info("retrying with max_tokens: %s", detail)
                    continue
                yield ErrorEvent(
                    message=_describe(exc.code, detail, request.model or self.model),
                    retryable=exc.code == 429 or exc.code >= 500,
                )
                return
            except urllib.error.URLError as exc:
                yield ErrorEvent(message=f"Could not reach OpenAI ({exc.reason}).", retryable=True)
                return
            except TimeoutError:
                yield ErrorEvent(message="OpenAI did not answer in time.", retryable=True)
                return

    def _request(self, request: ChatRequest, *, modern_limit: bool) -> urllib.request.Request:
        return urllib.request.Request(
            API_URL,
            data=json.dumps(self._payload(request, modern_limit=modern_limit)).encode(),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

    def _consume(self, response: Any, request: ChatRequest) -> Iterator[ProviderEvent]:
        """Server-sent events: `data: {...}` lines, then `data: [DONE]`."""
        text: list[str] = []
        tools: dict[int, _ToolAccumulator] = {}
        finish_reason: str | None = None
        model: str | None = None
        prompt_tokens: int | None = None
        completion_tokens: int | None = None

        for raw in response:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line or line.startswith(":"):
                continue
            if not line.startswith("data:"):
                continue
            body = line[5:].strip()
            if body == "[DONE]":
                break
            try:
                chunk = json.loads(body)
            except ValueError:
                log.warning("skipping a malformed chunk from openai")
                continue

            if chunk.get("error"):
                message = (chunk["error"] or {}).get("message", "unknown error")
                yield ErrorEvent(message=f"OpenAI: {message}")
                return

            model = chunk.get("model") or model
            usage = chunk.get("usage")
            if usage:
                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                completion_tokens = usage.get("completion_tokens", completion_tokens)

            for choice in chunk.get("choices") or []:
                finish_reason = choice.get("finish_reason") or finish_reason
                delta = choice.get("delta") or {}

                piece = delta.get("content")
                if piece:
                    text.append(piece)
                    yield TextEvent(text=piece)

                for fragment in delta.get("tool_calls") or []:
                    # `index` is how fragments of the same call find each other.
                    # Absent, everything belongs to the first call.
                    index = int(fragment.get("index", 0) or 0)
                    tools.setdefault(index, _ToolAccumulator(index=index)).absorb(fragment)

        calls: list[ToolUseContent] = []
        for ordinal, index in enumerate(sorted(tools)):
            call = tools[index].finish(ordinal)
            if call is not None:
                calls.append(call)

        if not text and not calls and finish_reason is None:
            yield ErrorEvent(
                message=(
                    f"OpenAI returned nothing for {request.model or self.model!r}. "
                    "Check the model name in Settings."
                )
            )
            return

        yield CompletionEvent(
            text="".join(text),
            # The chat loop keys off this to run tools, exactly as it does for
            # the other providers.
            stop_reason="tool_use" if calls else (finish_reason or "stop"),
            tool_calls=calls,
            model=model or request.model or self.model,
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
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
    """One neutral message becomes one or more OpenAI messages.

    Anthropic carries tool results as blocks inside a user message; OpenAI wants
    each as its own `role: "tool"` message carrying the id of the call it
    answers. A turn that is only tool results must therefore not also emit an
    empty user message, or the model sees a blank turn and often answers it.
    """
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []

    for block in message.content:
        if isinstance(block, TextContent):
            if block.text:
                texts.append(block.text)
        elif isinstance(block, ToolUseContent):
            calls.append(
                {
                    "id": block.id,
                    "type": "function",
                    "function": {
                        "name": block.name,
                        "arguments": json.dumps(block.input, ensure_ascii=False),
                    },
                }
            )
        elif isinstance(block, ToolResultContent):
            results.append(
                {
                    "role": "tool",
                    "tool_call_id": block.tool_use_id,
                    "content": block.content if not block.is_error else f"Error: {block.content}",
                }
            )

    out: list[dict[str, Any]] = []
    if texts or calls:
        entry: dict[str, Any] = {"role": message.role}
        # An assistant turn that only calls tools sends content null, which is
        # what the API expects rather than an empty string.
        entry["content"] = "\n".join(texts) if texts else (None if calls else "")
        if calls:
            entry["tool_calls"] = calls
        out.append(entry)
    out.extend(results)
    return out


# --- errors worth reading ----------------------------------------------------


def _detail(exc: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(exc.read())
    except Exception:
        # A broken error body must not replace the error it describes.
        return ""
    error = payload.get("error") or {}
    return str(error.get("message", "")) or str(error.get("code", ""))


def _is_limit_name_complaint(code: int, detail: str) -> bool:
    """Whether this 400 is the API asking for the other token-limit parameter."""
    lowered = detail.lower()
    return code == 400 and "max_completion_tokens" in lowered and "max_tokens" in lowered


def _describe(code: int, detail: str, model: str) -> str:
    if code == 401:
        return (
            "OpenAI rejected the API key. Check JARVIS_OPENAI_API_KEY in .env. " + detail
        ).strip()
    if code == 429 and "credit" in detail.lower():
        # Distinct from rate limiting, and the fix is completely different:
        # waiting will never help.
        return (
            "That OpenAI account has no credits left, so no request will succeed until "
            "billing is topped up. Switch provider in Settings to keep working. " + detail
        ).strip()
    if code == 429:
        return ("OpenAI is rate-limiting this key. Wait a moment. " + detail).strip()
    if code == 404:
        return f"OpenAI has no model called {model!r}. Check the name in Settings. {detail}".strip()
    if code == 400:
        return f"OpenAI refused the request: {detail or 'bad request'}"
    return f"OpenAI returned {code}. {detail}".strip()

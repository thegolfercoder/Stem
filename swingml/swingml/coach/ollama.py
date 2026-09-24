"""Talking to Ollama, the local model runner, over its HTTP interface.

Standard library only. Ollama is optional: everything here reports its absence as
a state the interface can explain ("install Ollama, then pull a model") rather than
raising, because a coach that is missing should never break the analysis around it.

Ollama is reached on 127.0.0.1:11434 unless OLLAMA_HOST says otherwise, the same
variable Ollama itself reads. An iPhone on the same network can use the desktop's
Ollama the same way, once Ollama is told to listen beyond this machine.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass, field

DEFAULT_HOST = "http://127.0.0.1:11434"

VISION_PREFERENCE = (
    "qwen2.5vl",
    "qwen3-vl",
    "gemma4",
    "gemma3",
    "llama3.2-vision",
    "minicpm-v",
    "llava",
)
"""Vision models in the order they are chosen when several are installed.

Qwen2.5-VL reads fine detail in pictures best among the small ones; Gemma 3 is the
one most likely to be installed already and works the moment it is pulled. Any
other model that reports the vision capability is used if none of these is there.
"""

SUGGESTED_PULL = "gemma3:4b"
"""What to suggest pulling when no vision model is installed: about 3.3 GB, runs on
a laptop without a graphics card, and reads pictures."""


def host() -> str:
    configured = os.environ.get("OLLAMA_HOST", "").strip()
    if not configured:
        return DEFAULT_HOST
    if "://" not in configured:
        configured = "http://" + configured
    return configured.rstrip("/")


class OllamaError(RuntimeError):
    """Ollama answered, but not with what was asked for."""


@dataclass(frozen=True)
class LocalModel:
    name: str
    size_bytes: int
    vision: bool
    family: str = ""

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "size_gb": round(self.size_bytes / 1e9, 1),
            "vision": self.vision,
            "family": self.family,
        }


@dataclass
class OllamaStatus:
    running: bool
    host: str
    version: str = ""
    models: list[LocalModel] = field(default_factory=list)
    problem: str = ""

    @property
    def vision_model(self) -> LocalModel | None:
        return choose_model(self.models, need_vision=True)

    @property
    def chat_model(self) -> LocalModel | None:
        return choose_model(self.models, need_vision=False)

    def as_dict(self) -> dict[str, object]:
        vision, chat = self.vision_model, self.chat_model
        return {
            "running": self.running,
            "host": self.host,
            "version": self.version,
            "models": [m.as_dict() for m in self.models],
            "vision_model": vision.name if vision else None,
            "chat_model": chat.name if chat else None,
            "problem": self.problem,
            "suggested_pull": SUGGESTED_PULL,
        }


def choose_model(models: list[LocalModel], need_vision: bool) -> LocalModel | None:
    """The installed model to use: a preferred vision model first, then any."""
    candidates = [m for m in models if m.vision] if need_vision else list(models)
    if not candidates:
        return None
    for preferred in VISION_PREFERENCE:
        for model in candidates:
            if model.name.split(":")[0] == preferred:
                return model
    return candidates[0]


class OllamaClient:
    def __init__(self, base_url: str | None = None, timeout_s: float = 3.0) -> None:
        self.base_url = (base_url or host()).rstrip("/")
        self.timeout_s = timeout_s

    # -- plumbing ------------------------------------------------------------

    def _request(
        self, path: str, payload: dict[str, object] | None = None
    ) -> urllib.request.Request:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(self.base_url + path, data=data)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        return request

    def _json(self, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
        with urllib.request.urlopen(self._request(path, payload), timeout=self.timeout_s) as reply:
            loaded = json.loads(reply.read().decode("utf-8"))
        if not isinstance(loaded, dict):
            raise OllamaError(f"{path} returned {type(loaded).__name__}, not an object")
        return loaded

    # -- what is there -------------------------------------------------------

    def status(self) -> OllamaStatus:
        """Whether Ollama is running here, and which models it has."""
        try:
            version = str(self._json("/api/version").get("version", ""))
        except (urllib.error.URLError, OSError, ValueError) as error:
            return OllamaStatus(running=False, host=self.base_url, problem=str(error))
        try:
            tags = self._json("/api/tags")
        except (urllib.error.URLError, OSError, ValueError, OllamaError) as error:
            return OllamaStatus(
                running=True, host=self.base_url, version=version, problem=str(error)
            )

        models: list[LocalModel] = []
        entries = tags.get("models", [])
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict) or "name" not in entry:
                continue
            name = str(entry["name"])
            details = entry.get("details") if isinstance(entry.get("details"), dict) else {}
            models.append(
                LocalModel(
                    name=name,
                    size_bytes=int(entry.get("size", 0) or 0),
                    vision=self._has_vision(name, details),
                    family=str(details.get("family", "")) if isinstance(details, dict) else "",
                )
            )
        return OllamaStatus(running=True, host=self.base_url, version=version, models=models)

    def _has_vision(self, name: str, details: object) -> bool:
        """Asked of Ollama itself: /api/show lists a model's capabilities."""
        try:
            shown = self._json("/api/show", {"model": name})
        except (urllib.error.URLError, OSError, ValueError, OllamaError):
            families = details.get("families") if isinstance(details, dict) else None
            return isinstance(families, list) and any("clip" in str(f) for f in families)
        capabilities = shown.get("capabilities")
        return isinstance(capabilities, list) and "vision" in capabilities

    # -- talking -------------------------------------------------------------

    def chat(
        self,
        model: str,
        messages: list[dict[str, object]],
        temperature: float = 0.4,
        num_ctx: int = 8192,
        timeout_s: float = 600.0,
    ) -> Iterator[str]:
        """Stream a reply, a piece at a time, as Ollama writes it.

        Messages are Ollama's own shape: role, content, and for a picture an
        `images` list of base64 strings on the message that shows it.
        """
        payload: dict[str, object] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature, "num_ctx": num_ctx},
        }
        try:
            reply = urllib.request.urlopen(self._request("/api/chat", payload), timeout=timeout_s)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            raise OllamaError(f"Ollama refused the request ({error.code}): {detail}") from error
        except (urllib.error.URLError, OSError) as error:
            raise OllamaError(f"could not reach Ollama at {self.base_url}: {error}") from error
        with reply:
            for raw in reply:
                line = raw.strip()
                if not line:
                    continue
                event = json.loads(line.decode("utf-8"))
                if "error" in event:
                    raise OllamaError(str(event["error"]))
                message = event.get("message") or {}
                piece = message.get("content") if isinstance(message, dict) else None
                if piece:
                    yield str(piece)
                if event.get("done"):
                    return

"""Typed views over the YAML.

The YAML is the database. These are read-only projections of it, so that code
answering a question does not have to remember which keys are optional, and so
that a missing key is a typed `None` rather than a `KeyError` at the worst
moment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass(frozen=True, slots=True)
class Source:
    """Where a claim came from, and when somebody looked."""

    id: str
    url: str
    kind: str
    retrieved: date
    title: str | None = None

    @property
    def is_official(self) -> bool:
        return self.kind == "official"

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Source:
        return cls(
            id=raw["id"],
            url=raw["url"],
            kind=raw["kind"],
            retrieved=date.fromisoformat(raw["retrieved"]),
            title=raw.get("title"),
        )


@dataclass(frozen=True, slots=True)
class Verification:
    """What was checked, how, and when.

    ``last_verified`` is the date a person checked the entry against its
    sources - not the date the file was last edited. The distinction is the
    whole point: a typo fix does not make a price current again.
    """

    last_verified: date
    method: str
    verified_fields: tuple[str, ...]
    note: str | None = None

    def age_days(self, today: date) -> int:
        return (today - self.last_verified).days

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Verification:
        return cls(
            last_verified=date.fromisoformat(raw["last_verified"]),
            method=raw["method"],
            verified_fields=tuple(raw["verified_fields"]),
            note=raw.get("note"),
        )


@dataclass(frozen=True, slots=True)
class CategoryPlacement:
    """One entry's position in one category."""

    id: str
    tier: str
    rationale: str
    evidence: tuple[str, ...] = ()

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> CategoryPlacement:
        return cls(
            id=raw["id"],
            tier=raw["tier"],
            rationale=raw["rationale"],
            evidence=tuple(raw.get("evidence") or ()),
        )


@dataclass(frozen=True, slots=True)
class ContextWindow:
    input_tokens: int | None = None
    output_tokens: int | None = None
    source: str | None = None
    note: str | None = None

    @classmethod
    def parse(cls, raw: dict[str, Any] | None) -> ContextWindow | None:
        if not raw:
            return None
        return cls(
            input_tokens=raw.get("input_tokens"),
            output_tokens=raw.get("output_tokens"),
            source=raw.get("source"),
            note=raw.get("note"),
        )


@dataclass(frozen=True, slots=True)
class Pricing:
    unit: str
    source: str
    input_usd: float | None = None
    output_usd: float | None = None
    amount_usd: float | None = None
    note: str | None = None

    @property
    def is_free_to_run(self) -> bool:
        return self.unit in {"free", "self_hosted"}

    def headline(self) -> str:
        """A short human-readable price, or a statement that there isn't one."""
        if self.unit == "per_million_tokens":
            # Either side can be absent on its own: an embedding model has an
            # input price and no output price, and formatting a None crashed
            # the docs build the first time one was added.
            if self.input_usd is None and self.output_usd is None:
                return "token pricing, amount not recorded"
            if self.output_usd is None:
                return f"${self.input_usd:g} per 1M input tokens"
            if self.input_usd is None:
                return f"${self.output_usd:g} per 1M output tokens"
            return f"${self.input_usd:g} in / ${self.output_usd:g} out per 1M tokens"
        if self.unit == "self_hosted":
            return "self-hosted (your hardware)"
        if self.unit == "free":
            return "free"
        if self.unit == "subscription":
            return (
                f"subscription, from ${self.amount_usd:g}/month"
                if self.amount_usd is not None
                else "subscription"
            )
        readable = self.unit.replace("per_", "per ").replace("_", " ")
        if self.amount_usd is None:
            return f"{readable}, amount not recorded"
        return f"${self.amount_usd:g} {readable}"

    @classmethod
    def parse(cls, raw: dict[str, Any] | None) -> Pricing | None:
        if not raw:
            return None
        return cls(
            unit=raw["unit"],
            source=raw["source"],
            input_usd=raw.get("input_usd"),
            output_usd=raw.get("output_usd"),
            amount_usd=raw.get("amount_usd"),
            note=raw.get("note"),
        )


@dataclass(frozen=True, slots=True)
class Openness:
    weights: str
    license: str | None = None
    weights_url: str | None = None
    parameters: str | None = None
    note: str | None = None

    @property
    def is_downloadable(self) -> bool:
        return self.weights in {"open-weights", "open-source"}

    @classmethod
    def parse(cls, raw: dict[str, Any] | None) -> Openness:
        raw = raw or {"weights": "closed"}
        return cls(
            weights=raw["weights"],
            license=raw.get("license"),
            weights_url=raw.get("weights_url"),
            parameters=raw.get("parameters"),
            note=raw.get("note"),
        )


@dataclass(frozen=True, slots=True)
class Api:
    available: bool
    docs_url: str | None = None
    note: str | None = None

    @classmethod
    def parse(cls, raw: dict[str, Any] | None) -> Api:
        raw = raw or {"available": False}
        return cls(
            available=bool(raw["available"]),
            docs_url=raw.get("docs_url"),
            note=raw.get("note"),
        )


@dataclass(frozen=True)
class Entry:
    """One model, tool or runtime."""

    slug: str
    name: str
    provider: str
    kind: str
    summary: str
    categories: tuple[CategoryPlacement, ...]
    sources: tuple[Source, ...]
    verification: Verification
    model_id: str | None = None
    released: str | None = None
    status: str = "available"
    use_cases: tuple[str, ...] = ()
    strengths: tuple[str, ...] = ()
    weaknesses: tuple[str, ...] = ()
    context_window: ContextWindow | None = None
    modalities: dict[str, tuple[str, ...]] = field(default_factory=dict)
    api: Api = field(default_factory=lambda: Api(available=False))
    openness: Openness = field(default_factory=lambda: Openness(weights="closed"))
    pricing: Pricing | None = None
    notes: str | None = None
    alternatives: tuple[str, ...] = ()
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    # ------------------------------------------------------------------ views

    @property
    def category_ids(self) -> set[str]:
        return {placement.id for placement in self.categories}

    def placement(self, category_id: str) -> CategoryPlacement | None:
        for placement in self.categories:
            if placement.id == category_id:
                return placement
        return None

    def source(self, source_id: str) -> Source | None:
        for source in self.sources:
            if source.id == source_id:
                return source
        return None

    @property
    def official_sources(self) -> tuple[Source, ...]:
        return tuple(source for source in self.sources if source.is_official)

    @property
    def primary_url(self) -> str:
        official = self.official_sources
        return official[0].url if official else self.sources[0].url

    def accepts(self, modality: str) -> bool:
        return modality in self.modalities.get("input", ())

    def produces(self, modality: str) -> bool:
        return modality in self.modalities.get("output", ())

    @property
    def input_price(self) -> float | None:
        """Price per million input tokens, when that is the unit."""
        if self.pricing and self.pricing.unit == "per_million_tokens":
            return self.pricing.input_usd
        return None

    def age_days(self, today: date) -> int:
        return self.verification.age_days(today)

    # ----------------------------------------------------------------- parsing

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Entry:
        modalities_raw = raw.get("modalities") or {}
        return cls(
            slug=raw["slug"],
            name=raw["name"],
            provider=raw["provider"],
            kind=raw["kind"],
            summary=raw["summary"],
            categories=tuple(CategoryPlacement.parse(c) for c in raw["categories"]),
            sources=tuple(Source.parse(s) for s in raw["sources"]),
            verification=Verification.parse(raw["verification"]),
            model_id=raw.get("model_id"),
            released=raw.get("released"),
            status=raw.get("status", "available"),
            use_cases=tuple(raw.get("use_cases") or ()),
            strengths=tuple(raw.get("strengths") or ()),
            weaknesses=tuple(raw.get("weaknesses") or ()),
            context_window=ContextWindow.parse(raw.get("context_window")),
            modalities={
                key: tuple(value) for key, value in modalities_raw.items() if value is not None
            },
            api=Api.parse(raw.get("api")),
            openness=Openness.parse(raw.get("openness")),
            pricing=Pricing.parse(raw.get("pricing")),
            notes=raw.get("notes"),
            alternatives=tuple(raw.get("alternatives") or ()),
            raw=raw,
        )


@dataclass(frozen=True, slots=True)
class Category:
    id: str
    label: str
    question: str
    definition: str


@dataclass(frozen=True, slots=True)
class Tier:
    id: str
    label: str
    definition: str


@dataclass(frozen=True)
class Taxonomy:
    """The controlled vocabulary, and the freshness policy."""

    categories: tuple[Category, ...]
    tiers: tuple[Tier, ...]
    kinds: tuple[str, ...]
    openness_values: tuple[str, ...]
    source_kinds: tuple[str, ...]
    max_age_days: int
    hard_max_age_days: int

    @property
    def category_ids(self) -> list[str]:
        return [category.id for category in self.categories]

    @property
    def tier_ids(self) -> list[str]:
        return [tier.id for tier in self.tiers]

    def category(self, category_id: str) -> Category | None:
        for category in self.categories:
            if category.id == category_id:
                return category
        return None

    def tier_order(self, tier_id: str) -> int:
        """Display order. Not a quality ranking - see docs/METHODOLOGY.md."""
        ids = self.tier_ids
        return ids.index(tier_id) if tier_id in ids else len(ids)

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Taxonomy:
        policy = raw.get("policy") or {}
        return cls(
            categories=tuple(
                Category(c["id"], c["label"], c["question"], c["definition"])
                for c in raw["categories"]
            ),
            tiers=tuple(Tier(t["id"], t["label"], t["definition"]) for t in raw["tiers"]),
            kinds=tuple(k["id"] for k in raw["kinds"]),
            openness_values=tuple(o["id"] for o in raw["openness"]),
            source_kinds=tuple(s["id"] for s in raw["source_kinds"]),
            max_age_days=int(policy.get("max_age_days", 90)),
            hard_max_age_days=int(policy.get("hard_max_age_days", 365)),
        )


__all__ = [
    "Api",
    "Category",
    "CategoryPlacement",
    "ContextWindow",
    "Entry",
    "Openness",
    "Pricing",
    "Source",
    "Taxonomy",
    "Tier",
    "Verification",
]

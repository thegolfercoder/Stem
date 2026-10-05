"""Reading numbers from requests at the API boundary (#68)."""

from __future__ import annotations


def whole_number(text: object) -> int | None:
    """`text` as a non-negative whole number when it is ASCII digits, else None.

    Not `str.isdigit()`: that is true of "²" and "①", which `int()` then refuses,
    and of other scripts' digits, which it reads (#68).
    """
    if isinstance(text, int) and not isinstance(text, bool):
        return text if text >= 0 else None
    if isinstance(text, str) and text.isascii() and text.isdigit():
        return int(text)
    return None

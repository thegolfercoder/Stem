"""Slowing down someone guessing the password.

On loopback this was unnecessary: the only thing that could reach the login form
was already sitting at the keyboard. Hosted, the form is reachable by anyone who
finds the address, and scrypt alone is the wrong defence to rely on - it makes
each guess expensive for the server as well as the attacker, which is a denial
of service waiting to happen if the attempts are unlimited.

So attempts are counted, and after a handful the account and the address are
both made to wait, with the wait doubling. It is a speed bump rather than a
wall: the real defence is still a password worth guessing at, and this exists so
that an online guessing attack takes centuries instead of an afternoon.

Deliberately in memory. A restart clears it, which is the right trade for a
single-process personal installation - the alternative is a table that has to be
pruned, and an attacker who can restart your server has already won. Both the
username and the caller's address are tracked, because tracking only the
username lets one attacker lock the owner out of their own assistant, and
tracking only the address lets a botnet spread its guesses across many.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

# How many failures before the waiting starts. Generous enough that a person
# mistyping their own password a few times never notices it exists.
FREE_ATTEMPTS = 5

# The wait after that, doubling each further failure, to a ceiling. Five minutes
# is long enough to make guessing hopeless and short enough that locking
# yourself out is an annoyance rather than a disaster.
BASE_DELAY_SECONDS = 2
MAX_DELAY_SECONDS = 300

# Failures older than this are forgotten, so yesterday's typo does not count
# against today.
WINDOW_SECONDS = 900


@dataclass
class _Record:
    failures: int = 0
    first_seen: float = field(default_factory=time.monotonic)
    blocked_until: float = 0.0


class Throttle:
    """Failure counts keyed by whatever you want to slow down."""

    def __init__(
        self,
        *,
        free_attempts: int = FREE_ATTEMPTS,
        base_delay: int = BASE_DELAY_SECONDS,
        max_delay: int = MAX_DELAY_SECONDS,
        window: int = WINDOW_SECONDS,
    ) -> None:
        self._records: dict[str, _Record] = {}
        self._lock = threading.Lock()
        self.free_attempts = free_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.window = window

    def retry_after(self, *keys: str) -> int:
        """Seconds the caller must wait, or 0 to let them try.

        Takes several keys and returns the longest wait among them, so a caller
        is held back if *either* the account or the address is in trouble.
        """
        now = time.monotonic()
        longest = 0
        with self._lock:
            for key in keys:
                record = self._records.get(key)
                if record is None:
                    continue
                if now - record.first_seen > self.window and now >= record.blocked_until:
                    # Stale and not currently blocked: forget it entirely.
                    del self._records[key]
                    continue
                remaining = int(record.blocked_until - now)
                longest = max(longest, remaining)
        return max(0, longest)

    def record_failure(self, *keys: str) -> int:
        """Count a failed attempt. Returns the wait now in force."""
        now = time.monotonic()
        longest = 0
        with self._lock:
            for key in keys:
                record = self._records.get(key)
                if record is None or (
                    now - record.first_seen > self.window and now >= record.blocked_until
                ):
                    record = _Record()
                    self._records[key] = record
                record.failures += 1

                over = record.failures - self.free_attempts
                if over > 0:
                    # Doubling, capped. `over - 1` so the first penalty is the
                    # base delay rather than twice it.
                    delay = min(self.base_delay * (2 ** (over - 1)), self.max_delay)
                    record.blocked_until = now + delay
                    longest = max(longest, delay)
        return longest

    def record_success(self, *keys: str) -> None:
        """A correct password forgives everything counted against these keys."""
        with self._lock:
            for key in keys:
                self._records.pop(key, None)

    def reset(self) -> None:
        """Used by tests, and by anyone who has locked themselves out and has
        access to the process."""
        with self._lock:
            self._records.clear()


# One per process. The login route is the only caller; anything else that needs
# slowing down should make its own rather than share this one's counts.
login_throttle = Throttle()

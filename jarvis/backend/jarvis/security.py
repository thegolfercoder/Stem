"""Passwords and session tokens.

scrypt from the standard library rather than bcrypt or argon2 from PyPI: this is
a single-user application that should install with `pip install -e .` and no
compiler, and scrypt at these parameters is a sound choice for the one password
it protects.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

# ~64 MB and roughly 0.1s per hash on a normal machine. The cost is paid once per
# login, which is the right place to be slow.
_SCRYPT_N = 2**16
_SCRYPT_R = 8
_SCRYPT_P = 1
_KEY_LEN = 32
_PREFIX = "scrypt"


def _maxmem(n: int, r: int, p: int) -> int:
    """OpenSSL refuses scrypt above a 32 MB working set unless asked otherwise,
    and these parameters need 64 MB. The limit has to be computed from the stored
    parameters rather than fixed, so raising the cost later keeps verifying old
    hashes."""
    return 128 * n * r * p + 1024 * 1024


def hash_password(password: str) -> str:
    """`scrypt$n$r$p$salt_hex$key_hex`. Self-describing so the parameters can be
    raised later without invalidating existing hashes."""
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_KEY_LEN,
        maxmem=_maxmem(_SCRYPT_N, _SCRYPT_R, _SCRYPT_P),
    )
    return f"{_PREFIX}${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check. Returns False rather than raising on a malformed
    hash, so a corrupted row cannot turn into a 500 on the login page."""
    try:
        prefix, n_s, r_s, p_s, salt_hex, key_hex = stored.split("$")
        if prefix != _PREFIX:
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(key_hex)
        n, r, p = int(n_s), int(r_s), int(p_s)
        candidate = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
            maxmem=_maxmem(n, r, p),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, expected)


def new_session_token() -> str:
    """A session token. 32 bytes of urandom; guessing is not a threat model that
    needs discussing at that width."""
    return secrets.token_urlsafe(32)


def token_fingerprint(token: str) -> str:
    """What gets stored for a session token. A plain SHA-256 is right here and a
    slow hash would be wrong: the token is already high-entropy, so there is no
    dictionary to attack, and this runs on every single request."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

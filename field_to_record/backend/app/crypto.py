"""Optional authenticated payload encryption; keys remain outside the database."""

import base64, json, os
from functools import lru_cache


class StorageLocked(Exception):
    pass


@lru_cache(maxsize=4)
def cipher(key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        decoded = base64.b64decode(key, validate=True)
        if len(decoded) != 32:
            raise ValueError("Expected 32 bytes")
        return AESGCM(decoded)
    except ValueError as exc:
        raise StorageLocked(
            "Configure a valid 32-byte base64 RECORD_ENCRYPTION_KEY."
        ) from exc


def pack(payload):
    text = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    key = os.getenv("RECORD_ENCRYPTION_KEY", "")
    if not key:
        return text
    nonce = os.urandom(12)
    encrypted = cipher(key).encrypt(nonce, text.encode(), b"field-to-record:v1")
    return "aesgcm:v1:" + base64.b64encode(nonce + encrypted).decode()


def unpack(text):
    if not text.startswith("aesgcm:v1:"):
        return json.loads(text)
    key = os.getenv("RECORD_ENCRYPTION_KEY", "")
    if not key:
        raise StorageLocked(
            "Encrypted storage is locked. Restore RECORD_ENCRYPTION_KEY."
        )
    try:
        data = base64.b64decode(text.removeprefix("aesgcm:v1:"), validate=True)
        return json.loads(
            cipher(key).decrypt(data[:12], data[12:], b"field-to-record:v1")
        )
    except Exception as exc:
        raise StorageLocked("Cannot unlock encrypted storage with this key.") from exc

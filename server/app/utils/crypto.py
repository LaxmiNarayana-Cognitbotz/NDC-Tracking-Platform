"""Database credentials encryption utility using AES-256 and PBKDF2 salting."""

import base64
import logging
import os
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from dotenv import load_dotenv

load_dotenv(verbose=True)
logger = logging.getLogger(__name__)

# Keys in system_configurations encrypted at rest
ENCRYPTED_CONFIG_KEYS = {
    "ORACLE_EMAIL",
    "ORACLE_PASSWORD",
    "SMTP_PASSWORD",
}


def _get_fernet() -> Fernet:
    """Derive Fernet cipher key from .env ENCRYPTION_KEY and ENCRYPTION_SALT."""
    try:
        key_str = os.getenv("ENCRYPTION_KEY", "").strip()
        salt_str = os.getenv("ENCRYPTION_SALT", "").strip()

        if not key_str:
            raise ValueError("ENCRYPTION_KEY is required in .env file.")
        if not salt_str:
            raise ValueError("ENCRYPTION_SALT is required in .env file.")

        try:
            salt_bytes = bytes.fromhex(salt_str)
        except ValueError:
            salt_bytes = salt_str.encode("utf-8")

        # PBKDF2 key derivation with 100k rounds
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt_bytes,
            iterations=100_000,
        )
        fernet_key = base64.urlsafe_b64encode(kdf.derive(key_str.encode("utf-8")))
        return Fernet(fernet_key)
    except Exception as e:
        logger.error(f"Failed to initialize encryption cipher: {e}")
        raise


def is_encrypted(value: Optional[str]) -> bool:
    """Check if value is a valid Fernet token."""
    try:
        if not value or not isinstance(value, str):
            return False
        clean = value.strip()
        return clean.startswith("gAAAAA") and len(clean) >= 60
    except Exception:
        return False


def encrypt_value(plain_text: Optional[str]) -> Optional[str]:
    """Encrypt plaintext string using salted AES-256."""
    try:
        if plain_text is None:
            return None
        s = str(plain_text).strip()
        if not s or is_encrypted(s):
            return s
        cipher = _get_fernet()
        return cipher.encrypt(s.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        return plain_text


def decrypt_value(cipher_text: Optional[str]) -> Optional[str]:
    """Decrypt AES-256 ciphertext back to plaintext."""
    try:
        if cipher_text is None:
            return None
        s = str(cipher_text).strip()
        if not s or not is_encrypted(s):
            return s
        cipher = _get_fernet()
        return cipher.decrypt(s.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("Invalid encryption token for current secret key.")
        return cipher_text
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        return cipher_text

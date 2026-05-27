from __future__ import annotations

from apps.api.app.core.settings import env_str
from apps.api.app.core.observability import REQUEST_ID_CTX

import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any


@dataclass
class VonageInboundMessage:
    provider: str
    from_number: str
    to_number: str
    text: str
    message_id: str | None
    received_at: str
    raw: dict[str, Any]

    def to_json(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "from_number": self.from_number,
            "to_number": self.to_number,
            "text": self.text,
            "message_id": self.message_id,
            "received_at": self.received_at,
            "raw": self.raw,
        }


class VonageInboxService:
    def __init__(self) -> None:
        root = Path(__file__).resolve().parents[4]
        runtime_cache_root = env_str("UIQ_RUNTIME_CACHE_ROOT", "").strip()
        runtime_cache_base = (
            Path(runtime_cache_root) if runtime_cache_root else (root / ".runtime-cache")
        )
        runtime_root = env_str("UNIVERSAL_AUTOMATION_RUNTIME_DIR", "").strip()
        base_dir = Path(runtime_root) if runtime_root else (runtime_cache_base / "automation")
        vonage_dir = base_dir / "vonage"
        self._inbox_path = vonage_dir / "inbox.jsonl"
        self._audit_path = vonage_dir / "callback-audit.jsonl"
        self._dedupe_path = vonage_dir / "seen-message-ids.json"
        self._audit_max_bytes = self._read_positive_int_env(
            "VONAGE_AUDIT_MAX_BYTES", default=2 * 1024 * 1024, minimum=1024
        )
        self._audit_backup_count = self._read_positive_int_env(
            "VONAGE_AUDIT_BACKUP_COUNT", default=4, minimum=1
        )
        self._audit_retention_days = self._read_positive_int_env(
            "VONAGE_AUDIT_RETENTION_DAYS", default=7, minimum=1
        )
        self._write_failures: dict[str, int] = {"inbox": 0, "audit": 0, "dedupe": 0}
        self._lock = Lock()
        self._redis_client = None
        self._redis_url_cache = ""
        self._last_dedupe_mode = "file"

    @staticmethod
    def _read_positive_int_env(key: str, *, default: int, minimum: int = 1) -> int:
        raw = env_str(key, "").strip()
        try:
            parsed = int(raw) if raw else default
        except ValueError:
            parsed = default
        return max(minimum, parsed)

    def _report_write_failure(self, stream: str, exc: OSError) -> None:
        self._write_failures[stream] = self._write_failures.get(stream, 0) + 1
        print(
            f"[vonage-{stream}] write failed (count={self._write_failures[stream]}): {exc}",
            file=sys.stderr,
        )

    def _rotate_jsonl_if_needed(
        self, path: Path, *, incoming_bytes: int, max_bytes: int, backup_count: int
    ) -> None:
        current_size = path.stat().st_size if path.exists() else 0
        if current_size + max(0, incoming_bytes) <= max_bytes:
            return
        oldest = path.with_name(f"{path.name}.{backup_count}")
        if oldest.exists():
            oldest.unlink()
        for idx in range(backup_count - 1, 0, -1):
            source = path.with_name(f"{path.name}.{idx}")
            target = path.with_name(f"{path.name}.{idx + 1}")
            if source.exists():
                source.replace(target)
        if path.exists():
            path.replace(path.with_name(f"{path.name}.1"))

    def _prune_jsonl_history(self, path: Path, *, backup_count: int, retention_days: int) -> None:
        cutoff = datetime.now(UTC).timestamp() - (retention_days * 24 * 60 * 60)
        candidates = [path]
        for idx in range(1, backup_count + 1):
            candidates.append(path.with_name(f"{path.name}.{idx}"))
        for candidate in candidates:
            if not candidate.exists():
                continue
            if candidate.stat().st_mtime < cutoff:
                candidate.unlink()

    def append_message(self, message: VonageInboundMessage) -> None:
        with self._lock:
            try:
                self._inbox_path.parent.mkdir(parents=True, exist_ok=True)
                with self._inbox_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(message.to_json(), ensure_ascii=False) + "\n")
            except OSError as exc:
                self._report_write_failure("inbox", exc)
                raise

    def append_audit(self, *, status: str, reason: str, payload: dict[str, Any]) -> None:
        request_id = REQUEST_ID_CTX.get()
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": "info" if status == "ok" else "warning",
            "kind": "audit",
            "service": "api",
            "component": "vonage-inbox",
            "channel": "automation.vonage.audit",
            "run_id": None,
            "trace_id": None if request_id in {"", "-"} else request_id,
            "request_id": None if request_id in {"", "-"} else request_id,
            "test_id": None,
            "event_code": self._sanitize_audit_code(reason),
            "message": reason,
            "attrs": {
                "status": status,
                "reason": reason,
                "message_id": payload.get("messageId")
                or payload.get("message-id")
                or payload.get("message_uuid"),
                "from_number": payload.get("msisdn") or payload.get("from"),
                "to_number": payload.get("to") or payload.get("to_number"),
            },
            "redaction_state": "redacted",
            "source_kind": "app",
        }
        with self._lock:
            try:
                self._audit_path.parent.mkdir(parents=True, exist_ok=True)
                line = json.dumps(record, ensure_ascii=False) + "\n"
                self._rotate_jsonl_if_needed(
                    self._audit_path,
                    incoming_bytes=len(line.encode("utf-8")),
                    max_bytes=self._audit_max_bytes,
                    backup_count=self._audit_backup_count,
                )
                with self._audit_path.open("a", encoding="utf-8") as f:
                    f.write(line)
                self._prune_jsonl_history(
                    self._audit_path,
                    backup_count=self._audit_backup_count,
                    retention_days=self._audit_retention_days,
                )
            except OSError as exc:
                self._report_write_failure("audit", exc)

    def _sanitize_audit_code(self, raw_value: str) -> str:
        normalized = "".join(
            character.lower() if character.isalnum() else "."
            for character in str(raw_value).strip()
        )
        normalized = ".".join(segment for segment in normalized.split(".") if segment)
        return normalized or "automation.vonage.audit"

    def register_message_id(self, message_id: str, ttl_seconds: int) -> bool:
        """
        Returns True for new message id, False for duplicate.
        """
        ttl_seconds = max(1, int(ttl_seconds))
        redis_url = env_str("REDIS_URL", "").strip()
        if redis_url:
            try:
                if self._redis_client is None or self._redis_url_cache != redis_url:
                    self._redis_client = self._create_redis_client(redis_url)
                    self._redis_url_cache = redis_url
                key_prefix = (
                    env_str("OTP_DEDUPE_REDIS_PREFIX", "otp:vonage:dedupe").strip()
                    or "otp:vonage:dedupe"
                )
                key = f"{key_prefix}:{message_id}"
                inserted = self._redis_client.set(
                    key, str(int(time.time())), nx=True, ex=ttl_seconds
                )
                self._last_dedupe_mode = "redis"
                return bool(inserted)
            except Exception as exc:
                self._last_dedupe_mode = "degraded"
                if env_str("OTP_DEDUPE_STRICT", "").strip().lower() in {"1", "true", "yes"}:
                    raise RuntimeError("redis unavailable for OTP dedupe in strict mode") from exc
                return self._register_message_id_via_file(message_id, ttl_seconds)
        self._last_dedupe_mode = "file"
        return self._register_message_id_via_file(message_id, ttl_seconds)

    @property
    def last_dedupe_mode(self) -> str:
        return self._last_dedupe_mode

    @staticmethod
    def _create_redis_client(redis_url: str):
        import redis

        return redis.Redis.from_url(redis_url, decode_responses=True)

    def _register_message_id_via_file(self, message_id: str, ttl_seconds: int) -> bool:
        now = int(time.time())
        cutoff = now - max(1, ttl_seconds)
        with self._lock:
            self._dedupe_path.parent.mkdir(parents=True, exist_ok=True)
            seen: dict[str, int] = {}
            if self._dedupe_path.exists():
                try:
                    raw = json.loads(self._dedupe_path.read_text(encoding="utf-8"))
                    if isinstance(raw, dict):
                        for key, value in raw.items():
                            if isinstance(key, str) and isinstance(value, int) and value >= cutoff:
                                seen[key] = value
                except json.JSONDecodeError:
                    seen = {}
            if message_id in seen:
                return False
            seen[message_id] = now
            try:
                self._dedupe_path.write_text(json.dumps(seen, ensure_ascii=False), encoding="utf-8")
            except OSError as exc:
                self._report_write_failure("dedupe", exc)
                raise
            return True

    def latest_otp(
        self,
        *,
        regex: str,
        to_number: str | int | None = None,
        sender_filter: str | None = None,
    ) -> str | None:
        if not self._inbox_path.exists():
            return None
        try:
            matcher = re.compile(regex)
        except re.error:
            return None
        with self._lock:
            lines = self._inbox_path.read_text(encoding="utf-8").splitlines()
        for raw in reversed(lines[-200:]):
            if not raw.strip():
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                continue
            from_number = str(item.get("from_number") or "")
            target = str(item.get("to_number") or "")
            text = str(item.get("text") or "")
            if to_number:
                if not self._same_phone_number(target, to_number):
                    continue
            if sender_filter and sender_filter not in from_number:
                continue
            matched = matcher.search(text)
            if matched:
                return matched.group(1) if matched.groups() else matched.group(0)
        return None

    @staticmethod
    def _normalize_phone_number(value: str | int | None) -> str:
        digits = re.sub(r"\D+", "", str(value or ""))
        if not digits:
            return ""
        # Treat North America country-code prefix as equivalent (+1XXXXXXXXXX == 1XXXXXXXXXX == XXXXXXXXXX).
        if len(digits) == 11 and digits.startswith("1"):
            return digits[1:]
        return digits

    @classmethod
    def _same_phone_number(cls, left: str | int | None, right: str | int | None) -> bool:
        left_normalized = cls._normalize_phone_number(left)
        right_normalized = cls._normalize_phone_number(right)
        return bool(left_normalized) and left_normalized == right_normalized

    @staticmethod
    def from_payload(payload: dict[str, Any]) -> VonageInboundMessage:
        from_number = str(payload.get("msisdn") or payload.get("from") or "").strip()
        to_number = str(payload.get("to") or payload.get("to_number") or "").strip()
        text = str(payload.get("text") or payload.get("message") or "").strip()
        message_id = (
            str(
                payload.get("messageId")
                or payload.get("message-id")
                or payload.get("message_uuid")
                or ""
            ).strip()
            or None
        )
        return VonageInboundMessage(
            provider="vonage",
            from_number=from_number,
            to_number=to_number,
            text=text,
            message_id=message_id,
            received_at=datetime.now(UTC).isoformat(),
            raw=payload,
        )


vonage_inbox_service = VonageInboxService()

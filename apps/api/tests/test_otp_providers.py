from __future__ import annotations

import os
from email.message import EmailMessage

import pytest

import apps.api.app.services.otp_providers as otp_providers
from apps.api.app.services.otp_providers import OtpFetchRequest, _extract_body_text, resolve_otp_code
from apps.api.app.services.vonage_inbox import VonageInboundMessage, vonage_inbox_service


def test_resolve_otp_code_manual() -> None:
    code = resolve_otp_code(
        OtpFetchRequest(provider="manual", regex=r"\b(\d{6})\b", manual_code="654321"),
    )
    assert code == "654321"


def test_resolve_otp_code_unknown_provider() -> None:
    code = resolve_otp_code(OtpFetchRequest(provider="unknown", regex=r"\b(\d{6})\b"))
    assert code is None


def test_extract_body_text_plain() -> None:
    msg = EmailMessage()
    msg.set_content("your otp is 112233")
    body = _extract_body_text(msg)
    assert "112233" in body


def test_resolve_otp_code_vonage(monkeypatch) -> None:
    inbox_path = vonage_inbox_service._inbox_path
    if inbox_path.exists():
        inbox_path.unlink()
    monkeypatch.setenv("VONAGE_OTP_TO_NUMBER", "15550001111")
    vonage_inbox_service.append_message(
        VonageInboundMessage(
            provider="vonage",
            from_number="15556667777",
            to_number="15550001111",
            text="Your code is 778899",
            message_id="m-1",
            received_at="2026-02-19T00:00:00+00:00",
            raw={"text": "Your code is 778899"},
        )
    )
    code = resolve_otp_code(OtpFetchRequest(provider="vonage", regex=r"\b(\d{6})\b"))
    assert code == "778899"
    if inbox_path.exists():
        inbox_path.unlink()
    os.environ.pop("VONAGE_OTP_TO_NUMBER", None)


def test_resolve_otp_code_vonage_requires_to_number(monkeypatch) -> None:
    monkeypatch.delenv("VONAGE_OTP_TO_NUMBER", raising=False)
    code = resolve_otp_code(OtpFetchRequest(provider="vonage", regex=r"\b(\d{6})\b"))
    assert code is None


def test_vonage_latest_otp_strict_to_number_filter(monkeypatch) -> None:
    inbox_path = vonage_inbox_service._inbox_path
    if inbox_path.exists():
        inbox_path.unlink()
    monkeypatch.setenv("VONAGE_OTP_TO_NUMBER", "+1 (555) 000-1111")
    vonage_inbox_service.append_message(
        VonageInboundMessage(
            provider="vonage",
            from_number="15556667777",
            to_number="15559998888",
            text="Your code is 112233",
            message_id="m-2",
            received_at="2026-02-19T00:00:00+00:00",
            raw={"text": "Your code is 112233"},
        )
    )
    vonage_inbox_service.append_message(
        VonageInboundMessage(
            provider="vonage",
            from_number="15556667777",
            to_number="+1-555-000-1111",
            text="Your code is 445566",
            message_id="m-3",
            received_at="2026-02-19T00:00:01+00:00",
            raw={"text": "Your code is 445566"},
        )
    )
    code = resolve_otp_code(OtpFetchRequest(provider="vonage", regex=r"\b(\d{6})\b"))
    assert code == "445566"
    if inbox_path.exists():
        inbox_path.unlink()


def test_fetch_from_imap_preserves_login_error_when_logout_also_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class BrokenMail:
        def login(self, username: str, password: str) -> None:
            raise RuntimeError("login failed")

        def close(self) -> None:
            raise RuntimeError("close failed")

        def logout(self) -> None:
            raise RuntimeError("logout failed")

    monkeypatch.setattr(otp_providers.imaplib, "IMAP4_SSL", lambda _host: BrokenMail())

    with pytest.raises(RuntimeError, match="login failed"):
        otp_providers._fetch_from_imap(
            host="imap.example.com",
            username="user@example.com",
            password="pw",
            req=OtpFetchRequest(provider="imap", regex=r"\b(\d{6})\b"),
        )

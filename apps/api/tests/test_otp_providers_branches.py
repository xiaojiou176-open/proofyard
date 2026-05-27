from __future__ import annotations

from email.message import EmailMessage

import apps.api.app.services.otp_providers as otp_providers
from apps.api.app.services.otp_providers import OtpFetchRequest


class FakeMail:
    def __init__(
        self, *, search_ok: bool = True, fetch_rows: list[tuple[str, list]] | None = None
    ) -> None:
        self.search_ok = search_ok
        self.fetch_rows = fetch_rows or []

    def login(self, _user: str, _pw: str) -> None:
        return None

    def select(self, _mailbox: str) -> None:
        return None

    def search(self, *_args):
        if not self.search_ok:
            return ("NO", [b""])
        return ("OK", [b"1 2"])

    def fetch(self, message_id, _spec):
        for expected_id, payload in self.fetch_rows:
            if expected_id.encode() == message_id:
                return ("OK", payload)
        return ("NO", [])

    def close(self) -> None:
        return None

    def logout(self) -> None:
        return None


def _email_bytes(sender: str, subject: str, body: str) -> bytes:
    msg = EmailMessage()
    msg["From"] = sender
    msg["Subject"] = subject
    msg.set_content(body)
    return msg.as_bytes()


def test_resolve_otp_code_gmail_and_imap_missing_credentials(monkeypatch) -> None:
    monkeypatch.setattr(otp_providers, "env_str", lambda *_args, **_kwargs: "")
    req = OtpFetchRequest(provider="gmail", regex=r"\b(\d{6})\b")
    assert otp_providers.resolve_otp_code(req) is None

    req2 = OtpFetchRequest(provider="imap", regex=r"\b(\d{6})\b")
    assert otp_providers.resolve_otp_code(req2) is None


def test_resolve_otp_code_uses_fetch_from_imap(monkeypatch) -> None:
    calls = {}

    def fake_fetch(host: str, username: str, password: str, req: OtpFetchRequest):
        calls["host"] = host
        calls["username"] = username
        calls["password"] = password
        calls["provider"] = req.provider
        return "112233"

    monkeypatch.setattr(otp_providers, "_fetch_from_imap", fake_fetch)
    monkeypatch.setattr(
        otp_providers,
        "env_str",
        lambda key, default="": {
            "GMAIL_IMAP_USER": "u",
            "GMAIL_IMAP_PASSWORD": "p",
            "IMAP_HOST": "imap.example.com",
            "IMAP_USER": "iu",
            "IMAP_PASSWORD": "ip",
        }.get(key, default),
    )

    code = otp_providers.resolve_otp_code(OtpFetchRequest(provider="gmail", regex=r"\b(\d{6})\b"))
    assert code == "112233"
    assert calls["host"] == "imap.gmail.com"

    code2 = otp_providers.resolve_otp_code(OtpFetchRequest(provider="imap", regex=r"\b(\d{6})\b"))
    assert code2 == "112233"
    assert calls["host"] == "imap.example.com"


def test_fetch_from_imap_handles_search_failure(monkeypatch) -> None:
    monkeypatch.setattr(otp_providers.imaplib, "IMAP4_SSL", lambda _host: FakeMail(search_ok=False))
    code = otp_providers._fetch_from_imap(
        "imap.example.com", "u", "p", OtpFetchRequest(provider="imap", regex=r"\b(\d{6})\b")
    )
    assert code is None


def test_fetch_from_imap_filters_sender_subject_and_extracts_group(monkeypatch) -> None:
    rows = [
        ("2", [(None, _email_bytes("other@example.com", "Other", "Code 000000"))]),
        ("1", [(None, _email_bytes("auth@example.com", "Login OTP", "Code 445566"))]),
    ]
    monkeypatch.setattr(otp_providers.imaplib, "IMAP4_SSL", lambda _host: FakeMail(fetch_rows=rows))
    req = OtpFetchRequest(
        provider="imap",
        regex=r"Code\s+(\d{6})",
        sender_filter="auth@example.com",
        subject_filter="Login OTP",
    )
    code = otp_providers._fetch_from_imap("imap.example.com", "u", "p", req)
    assert code == "445566"


def test_extract_body_text_for_multipart_message() -> None:
    msg = EmailMessage()
    msg.set_content("plain part 123456")
    msg.add_alternative("<html><body>html part</body></html>", subtype="html")
    body = otp_providers._extract_body_text(msg)
    assert "plain part" in body


def test_fetch_from_imap_invalid_regex_returns_none_without_crash(monkeypatch) -> None:
    monkeypatch.setattr(otp_providers.imaplib, "IMAP4_SSL", lambda _host: FakeMail(fetch_rows=[]))
    req = OtpFetchRequest(provider="imap", regex="(")
    assert otp_providers._fetch_from_imap("imap.example.com", "u", "p", req) is None


def test_fetch_from_imap_oversized_regex_returns_none_without_crash(monkeypatch) -> None:
    monkeypatch.setattr(otp_providers.imaplib, "IMAP4_SSL", lambda _host: FakeMail(fetch_rows=[]))
    req = OtpFetchRequest(provider="imap", regex="x" * 300)
    assert otp_providers._fetch_from_imap("imap.example.com", "u", "p", req) is None


def test_fetch_from_imap_skips_invalid_payload_and_returns_full_match(monkeypatch) -> None:
    rows = [
        ("2", [("ignored", "not-bytes")]),
        ("1", [(None, _email_bytes("alerts@example.com", "OTP", "token 123456"))]),
    ]
    monkeypatch.setattr(otp_providers.imaplib, "IMAP4_SSL", lambda _host: FakeMail(fetch_rows=rows))
    req = OtpFetchRequest(
        provider="imap",
        regex=r"\d{6}",
        sender_filter="alerts@example.com",
        subject_filter="OTP",
    )
    code = otp_providers._fetch_from_imap("imap.example.com", "u", "p", req)
    assert code == "123456"


def test_extract_body_text_non_bytes_payload_falls_back_to_string() -> None:
    class PlainPayloadMessage:
        def is_multipart(self) -> bool:
            return False

        def get_payload(self, decode: bool = False):
            assert decode is True
            return "manual fallback"

    assert otp_providers._extract_body_text(PlainPayloadMessage()) == "manual fallback"

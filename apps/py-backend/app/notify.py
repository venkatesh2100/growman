"""Side effects that must not slow the response down.

Order mail and Discord alerts run on a daemon thread. If SMTP is down the
payment has already succeeded; the log line is the record. OTP endpoints
are different: they check SMTP *before* answering, because the code is
the whole point of the request.
"""

from __future__ import annotations

import logging
import smtplib
import threading
from email.message import EmailMessage

import httpx

log = logging.getLogger("growman.notify")


def smtp_ready(settings) -> bool:
    return bool(settings.smtp_email and settings.smtp_password)


def send_email(settings, to: str, subject: str, body: str, attachment: tuple[str, bytes] | None = None) -> None:
    if not to or not smtp_ready(settings):
        log.info("email skipped (%s): %s", subject, to or "no recipient")
        return

    def _send() -> None:
        try:
            _deliver(settings, to, subject, body, attachment)
        except Exception as exc:  # noqa: BLE001
            log.warning("email %s to %s failed: %s", subject, to, exc)

    threading.Thread(target=_send, daemon=True).start()


def send_email_now(settings, to: str, subject: str, body: str, attachment: tuple[str, bytes] | None = None) -> None:
    """Send before the handler returns. Used when the email is the feature, not a side effect."""
    if not to or not smtp_ready(settings):
        raise RuntimeError("smtp is not configured")
    _deliver(settings, to, subject, body, attachment)


def _deliver(settings, to: str, subject: str, body: str, attachment: tuple[str, bytes] | None) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_email
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if attachment:
        filename, payload = attachment
        msg.add_attachment(payload, maintype="application", subtype="pdf", filename=filename)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_email, settings.smtp_password)
        smtp.send_message(msg)


def alert_ops(settings, text: str) -> None:
    """Discord when configured, otherwise the merchant inbox. Never both."""
    if settings.discord_webhook_url:
        url = settings.discord_webhook_url

        def _post() -> None:
            try:
                httpx.post(url, json={"content": text[:1800]}, timeout=8)
            except Exception as exc:  # noqa: BLE001
                log.warning("discord alert failed: %s", exc)

        threading.Thread(target=_post, daemon=True).start()
        return
    if settings.merchant_notify_email:
        send_email(settings, settings.merchant_notify_email, "Growman", text)

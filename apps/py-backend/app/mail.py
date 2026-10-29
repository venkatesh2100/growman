"""Email and Discord. A failed message never changes an order."""

import logging
import smtplib
from email.message import EmailMessage

import httpx

log = logging.getLogger("growman")


def send(settings, to: str, subject: str, body: str) -> bool:
    if not to or not settings.smtp_email or not settings.smtp_password:
        if not settings.prod:
            log.info("email to %s | %s | %s", to, subject, body)
        return False
    msg = EmailMessage()
    msg["From"] = settings.smtp_email
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_email, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception:
        log.exception("email failed")
        return False


def discord(url: str, text: str) -> None:
    if not url:
        return
    try:
        httpx.post(url, json={"content": text[:1800]}, timeout=5)
    except Exception:
        log.warning("discord notify failed")

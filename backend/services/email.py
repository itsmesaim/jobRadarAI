"""Optional SMTP helpers for transactional email."""

import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from config import settings


def smtp_configured() -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_from_email
        and (settings.smtp_user or settings.smtp_password)
    )


def smtp_missing_reason() -> str | None:
    """Human-readable reason SMTP is not ready (None if configured)."""
    if not settings.smtp_host:
        return "SMTP_HOST is empty"
    if not settings.smtp_from_email:
        return "SMTP_FROM_EMAIL is empty"
    if not (settings.smtp_user or settings.smtp_password):
        return "SMTP_USER and SMTP_PASSWORD are empty"
    return None


def _apply_mail_headers(msg: EmailMessage, *, to_email: str) -> None:
    """Set From (with display name), To, and optional Reply-To."""
    from_addr = (settings.smtp_from_email or "").strip()
    from_name = (settings.smtp_from_name or "JobRadar").strip()
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_email
    reply_to = (settings.smtp_reply_to or "").strip()
    if reply_to:
        msg["Reply-To"] = reply_to


def gmail_from_mismatch() -> str | None:
    """Warn when Gmail SMTP is used with a From address Gmail will rewrite."""
    host = (settings.smtp_host or "").lower()
    user = (settings.smtp_user or "").strip().lower()
    from_addr = (settings.smtp_from_email or "").strip().lower()
    if "gmail" not in host or not user or not from_addr:
        return None
    if user != from_addr:
        return (
            f"SMTP_USER ({settings.smtp_user}) ≠ SMTP_FROM_EMAIL "
            f"({settings.smtp_from_email}). Gmail will usually show the Gmail "
            "address unless you add the custom address under Gmail → Settings → "
            "Accounts → Send mail as (with domain DNS verification)."
        )
    return None


def send_password_reset_email(*, to_email: str, reset_url: str) -> None:
    if not smtp_configured():
        raise RuntimeError("SMTP is not configured")

    msg = EmailMessage()
    msg["Subject"] = "Reset your JobRadar password"
    _apply_mail_headers(msg, to_email=to_email)
    msg.set_content(
        f"""Hi,

You requested a password reset for JobRadar.

Open this link to choose a new password (valid for {settings.password_reset_expire_minutes} minutes):
{reset_url}

If you did not request this, you can ignore this email.

— JobRadar
"""
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def send_apply_reminder_email(
    *,
    to_email: str,
    user_name: str,
    jobs: list[dict],
    total_count: int,
    min_score: int,
    dashboard_url: str,
    settings_url: str,
) -> None:
    """Email a short list of high-scoring jobs the user has not applied to yet."""
    if not smtp_configured():
        raise RuntimeError("SMTP is not configured")

    lines = [
        f"Hi {user_name},",
        "",
        f"You have {total_count} job{'s' if total_count != 1 else ''} scoring "
        f"{min_score}+/10 that you haven't applied to yet.",
        "",
        "Top matches:",
        "",
    ]

    for i, job in enumerate(jobs, start=1):
        company = job.get("company") or "Company not listed"
        location = job.get("location") or ""
        score = job.get("score")
        title = job.get("title") or "Untitled role"
        url = job.get("url") or ""
        loc_part = f" · {location}" if location else ""
        lines.append(f"{i}. [{score}/10] {title} — {company}{loc_part}")
        if url:
            lines.append(f"   {url}")
        verdict = (job.get("verdict") or "").strip()
        if verdict:
            lines.append(f"   {verdict[:200]}")
        lines.append("")

    lines.extend(
        [
            f"Open your dashboard: {dashboard_url}",
            "",
            "Turn off these reminders anytime in Settings:",
            settings_url,
            "",
            "— JobRadar",
        ]
    )

    msg = EmailMessage()
    subject_count = total_count if total_count <= 3 else f"{len(jobs)}+"
    msg["Subject"] = (
        f"Apply soon: {subject_count} high-scoring job"
        f"{'s' if total_count != 1 else ''} waiting"
    )
    _apply_mail_headers(msg, to_email=to_email)
    msg.set_content("\n".join(lines))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)

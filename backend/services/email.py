"""Optional SMTP helpers for transactional email."""

from __future__ import annotations

import html
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


def _escape(text: str) -> str:
    return html.escape((text or "").strip())


def _score_color(score: int | float | None) -> str:
    if score is None:
        return "#64748b"
    if score >= 8:
        return "#15803d"
    if score >= 6:
        return "#2563eb"
    return "#a16207"


def _apply_mail_headers(msg: EmailMessage, *, to_email: str) -> None:
    from_addr = (settings.smtp_from_email or "").strip()
    from_name = (settings.smtp_from_name or "JobRadar").strip()
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_email
    reply_to = (settings.smtp_reply_to or "").strip()
    if reply_to:
        msg["Reply-To"] = reply_to


def gmail_from_mismatch() -> str | None:
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


def _email_shell(*, preheader: str, body_html: str) -> str:
    brand = _escape(settings.smtp_from_name or "JobRadar")
    year = "2026"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{brand}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;line-height:1.5;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{_escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d2dae6;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:22px 24px 8px;border-bottom:1px solid #e8ecf3;">
              <div style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#18181b;">{brand}</div>
              <div style="font-size:12px;color:#71717a;margin-top:2px;">AI job matching &amp; apply packs</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">{body_html}</td>
          </tr>
          <tr>
            <td style="padding:16px 24px 22px;border-top:1px solid #e8ecf3;font-size:12px;color:#71717a;">
              © {year} {brand}. You're receiving this because you have a JobRadar account.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _button(href: str, label: str, *, secondary: bool = False) -> str:
    if secondary:
        bg, border, color = "#f3f5f9", "#d2dae6", "#3f3f46"
    else:
        bg, border, color = "#2563eb", "#2563eb", "#ffffff"
    return (
        f'<a href="{_escape(href)}" style="display:inline-block;padding:12px 20px;'
        f"background:{bg};border:1px solid {border};border-radius:10px;"
        f'color:{color};font-size:14px;font-weight:600;text-decoration:none;">'
        f"{_escape(label)}</a>"
    )


def _send_email(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def send_password_reset_email(*, to_email: str, reset_url: str) -> None:
    if not smtp_configured():
        raise RuntimeError("SMTP is not configured")

    minutes = settings.password_reset_expire_minutes
    text = f"""Hi,

You requested a password reset for JobRadar.

Open this link to choose a new password (valid for {minutes} minutes):
{reset_url}

If you did not request this, you can ignore this email.

— JobRadar
"""
    body = f"""
<p style="margin:0 0 12px;font-size:15px;">Hi,</p>
<p style="margin:0 0 18px;font-size:15px;color:#3f3f46;">
  You requested a password reset. Tap the button below to choose a new password.
  This link expires in <strong>{minutes} minutes</strong>.
</p>
<p style="margin:0 0 22px;">{_button(reset_url, "Reset password")}</p>
<p style="margin:0;font-size:13px;color:#71717a;">
  If the button doesn't work, copy this link:<br />
  <a href="{_escape(reset_url)}" style="color:#2563eb;word-break:break-all;">{_escape(reset_url)}</a>
</p>
<p style="margin:18px 0 0;font-size:13px;color:#71717a;">
  If you didn't request this, ignore this email — your password won't change.
</p>
"""
    html_doc = _email_shell(
        preheader=f"Reset your JobRadar password — link expires in {minutes} minutes",
        body_html=body,
    )

    msg = EmailMessage()
    msg["Subject"] = "Reset your JobRadar password"
    _apply_mail_headers(msg, to_email=to_email)
    msg.set_content(text)
    msg.add_alternative(html_doc, subtype="html")
    _send_email(msg)


def _job_card_html(job: dict, index: int) -> str:
    title = _escape(job.get("title") or "Untitled role")
    company = _escape(job.get("company") or "Company not listed")
    location = _escape(job.get("location") or "")
    score = job.get("score")
    url = (job.get("url") or "").strip()
    verdict = _escape((job.get("verdict") or "")[:180])
    strength = _escape((job.get("top_strength") or "")[:120])
    score_label = f"{score}/10" if score is not None else "—"
    score_bg = _score_color(score)
    loc_line = (
        f'<div style="font-size:13px;color:#71717a;margin-top:4px;">📍 {location}</div>'
        if location
        else ""
    )

    link_block = ""
    if url:
        link_block = (
            f'<p style="margin:12px 0 0;">'
            f'<a href="{_escape(url)}" style="font-size:13px;font-weight:600;color:#2563eb;text-decoration:none;">'
            f"View listing →</a></p>"
        )

    extra = ""
    if strength:
        extra = f'<p style="margin:10px 0 0;font-size:13px;color:#3f3f46;"><strong>Why it fits:</strong> {strength}</p>'
    elif verdict:
        extra = f'<p style="margin:10px 0 0;font-size:13px;color:#52525b;font-style:italic;">{verdict}</p>'

    return f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;border:1px solid #e4e4e7;border-radius:12px;background:#fafafa;">
  <tr>
    <td style="padding:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">#{index}</div>
            <div style="font-size:16px;font-weight:700;color:#18181b;margin-top:4px;">{title}</div>
            <div style="font-size:14px;color:#3f3f46;margin-top:2px;">{company}</div>
            {loc_line}
          </td>
          <td style="vertical-align:top;text-align:right;width:72px;">
            <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:{score_bg};color:#fff;font-size:13px;font-weight:700;">{score_label}</span>
          </td>
        </tr>
      </table>
      {extra}
      {link_block}
    </td>
  </tr>
</table>"""


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

    shown = len(jobs)
    more = max(0, total_count - shown)
    job_word = "job" if total_count != 1 else "job"
    top_title = jobs[0].get("title") if jobs else "roles"

    lines = [
        f"Hi {user_name},",
        "",
        f"You have {total_count} {job_word} scoring {min_score}+/10 that you haven't applied to yet.",
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
        strength = (job.get("top_strength") or "").strip()
        if strength:
            lines.append(f"   Fit: {strength[:160]}")
        elif (job.get("verdict") or "").strip():
            lines.append(f"   {job['verdict'][:200]}")
        if url:
            lines.append(f"   {url}")
        lines.append("")

    if more:
        lines.append(
            f"+ {more} more high-scoring role{'s' if more != 1 else ''} on your dashboard."
        )
        lines.append("")

    lines.extend(
        [
            f"Open your dashboard: {dashboard_url}",
            "",
            "Turn off these reminders in Settings:",
            settings_url,
            "",
            "— JobRadar",
        ]
    )

    cards_html = "".join(_job_card_html(job, i) for i, job in enumerate(jobs, start=1))
    more_html = ""
    if more:
        more_html = (
            f'<p style="margin:0 0 18px;font-size:14px;color:#52525b;">'
            f"+ <strong>{more}</strong> more high-scoring role{'s' if more != 1 else ''} waiting on your dashboard.</p>"
        )

    body = f"""
<p style="margin:0 0 12px;font-size:16px;font-weight:600;">Hi {_escape(user_name)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3f3f46;">
  <strong>{total_count}</strong> role{'s' if total_count != 1 else ''} in your pipeline score
  <strong>{min_score}+/10</strong> and are still marked <em>New</em>. Here are your best matches:
</p>
{cards_html}
{more_html}
<p style="margin:0 0 10px;">{_button(dashboard_url, "Open dashboard")}</p>
<p style="margin:0;font-size:12px;color:#71717a;">
  <a href="{_escape(settings_url)}" style="color:#71717a;">Turn off email reminders</a>
</p>
"""
    preheader = f"{total_count} roles scoring {min_score}+/10 — {top_title}"
    if shown < total_count:
        subject = (
            f"Apply soon: {shown} top matches (+{more} more) scoring {min_score}+/10"
        )
    else:
        subject = (
            f"Apply soon: {total_count} high-scoring job"
            f"{'s' if total_count != 1 else ''} waiting"
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    _apply_mail_headers(msg, to_email=to_email)
    msg.set_content("\n".join(lines))
    msg.add_alternative(
        _email_shell(preheader=preheader, body_html=body),
        subtype="html",
    )
    _send_email(msg)

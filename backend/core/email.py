"""Async email service built on aiosmtplib.

Usage
-----
    await send_invite_email(
        to_address="user@example.com",
        invite_url="https://app.example.com/register?token=...",
        expires_in_hours=48,
        settings=get_settings(),
    )

Migration to ACS
----------------
Azure Communication Services exposes a standard SMTP relay endpoint.
No code changes are needed — just update environment variables:

    SMTP_HOST=smtp.azurecomm.net
    SMTP_PORT=587
    SMTP_USE_TLS=true
    SMTP_USER=<ACS SMTP username from connection string>
    SMTP_PASSWORD=<ACS SMTP password from connection string>
    EMAIL_FROM_ADDRESS=<verified sender address in ACS>
"""
from __future__ import annotations

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
import structlog

from core.config import AppSettings

logger = structlog.get_logger(__name__)


def _build_invite_message(
    *,
    to_address: str,
    invite_url: str,
    expires_in_hours: int,
    settings: AppSettings,
) -> MIMEMultipart:
    """Build a MIMEMultipart email message for an invite."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "You're invited to MLOps Platform"
    msg["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
    msg["To"] = to_address

    plain = (
        f"You have been invited to join MLOps Platform.\n\n"
        f"Click the link below to create your account (expires in {expires_in_hours} hours):\n\n"
        f"{invite_url}\n\n"
        f"This link can only be used once. If you did not expect this invitation, "
        f"you can safely ignore this email.\n"
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden">
        <!-- Header -->
        <tr>
          <td style="padding:28px 32px 24px;border-bottom:1px solid #334155">
            <h1 style="margin:0;font-size:18px;font-weight:700;color:#f1f5f9">MLOps Platform</h1>
            <p style="margin:4px 0 0;font-size:12px;color:#64748b">Automation Dashboard</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px">
            <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#f1f5f9">
              You're invited!
            </h2>
            <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6">
              An admin has invited you to join <strong style="color:#e2e8f0">MLOps Platform</strong>.
              Click the button below to create your account.
              This invitation expires in <strong style="color:#e2e8f0">{expires_in_hours} hours</strong>
              and can only be used once.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#6366f1">
                  <a href="{invite_url}"
                     style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                            color:#ffffff;text-decoration:none;border-radius:8px">
                    Accept invitation
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;color:#64748b;word-break:break-all">
              Or copy this link: <a href="{invite_url}" style="color:#818cf8">{invite_url}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #334155">
            <p style="margin:0;font-size:11px;color:#475569">
              If you did not expect this invitation, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


async def send_invite_email(
    *,
    to_address: str,
    invite_url: str,
    expires_in_hours: int,
    settings: AppSettings,
) -> None:
    """Send an invite email asynchronously via SMTP.

    Logs a warning and returns without raising if SMTP is disabled or sending fails,
    so the HTTP response is never blocked by email errors.
    """
    if not settings.smtp_enabled:
        logger.info("email.skipped", reason="smtp_enabled=false", to=to_address)
        return

    msg = _build_invite_message(
        to_address=to_address,
        invite_url=invite_url,
        expires_in_hours=expires_in_hours,
        settings=settings,
    )

    smtp_kwargs: dict = {
        "hostname": settings.smtp_host,
        "port": settings.smtp_port,
        "start_tls": settings.smtp_use_tls,
    }
    if settings.smtp_user and settings.smtp_password:
        smtp_kwargs["username"] = settings.smtp_user
        smtp_kwargs["password"] = settings.smtp_password

    try:
        await aiosmtplib.send(msg, **smtp_kwargs)
        logger.info("email.invite_sent", to=to_address)
    except Exception as exc:
        logger.warning("email.send_failed", to=to_address, error=str(exc))
        raise


# ---------------------------------------------------------------------------
# Credential change confirmation
# ---------------------------------------------------------------------------

def _build_change_message(
    *,
    to_address: str,
    confirm_url: str,
    change_type: str,  # "password" | "username"
    new_username: str | None,
    settings: AppSettings,
) -> MIMEMultipart:
    label = "password" if change_type == "password" else "username"
    detail = (
        "your password will be updated"
        if change_type == "password"
        else f"your username will be changed to <strong style='color:#e2e8f0'>{new_username}</strong>"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Confirm your {label} change — MLOps Platform"
    msg["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
    msg["To"] = to_address

    plain = (
        f"You requested to change your {label} on MLOps Platform.\n\n"
        f"Click the link below to confirm the change (expires in 1 hour):\n\n"
        f"{confirm_url}\n\n"
        f"If you did not request this, you can safely ignore this email. "
        f"Your credentials will not change.\n"
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden">
        <tr>
          <td style="padding:28px 32px 24px;border-bottom:1px solid #334155">
            <h1 style="margin:0;font-size:18px;font-weight:700;color:#f1f5f9">MLOps Platform</h1>
            <p style="margin:4px 0 0;font-size:12px;color:#64748b">Security notification</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px">
            <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#f1f5f9">
              Confirm {label} change
            </h2>
            <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6">
              You requested to change your {label}. If you confirm, {detail}.
              This link expires in <strong style="color:#e2e8f0">1 hour</strong>.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#6366f1">
                  <a href="{confirm_url}"
                     style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                            color:#ffffff;text-decoration:none;border-radius:8px">
                    Confirm change
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;color:#64748b;word-break:break-all">
              Or copy: <a href="{confirm_url}" style="color:#818cf8">{confirm_url}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #334155">
            <p style="margin:0;font-size:11px;color:#475569">
              If you did not request this change, ignore this email — nothing will happen.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


async def send_change_confirmation_email(
    *,
    to_address: str,
    confirm_url: str,
    change_type: str,
    new_username: str | None = None,
    settings: AppSettings,
) -> None:
    if not settings.smtp_enabled:
        logger.info("email.skipped", reason="smtp_enabled=false", to=to_address)
        return

    msg = _build_change_message(
        to_address=to_address,
        confirm_url=confirm_url,
        change_type=change_type,
        new_username=new_username,
        settings=settings,
    )

    smtp_kwargs: dict = {
        "hostname": settings.smtp_host,
        "port": settings.smtp_port,
        "start_tls": settings.smtp_use_tls,
    }
    if settings.smtp_user and settings.smtp_password:
        smtp_kwargs["username"] = settings.smtp_user
        smtp_kwargs["password"] = settings.smtp_password

    try:
        await aiosmtplib.send(msg, **smtp_kwargs)
        logger.info("email.change_confirmation_sent", to=to_address, change_type=change_type)
    except Exception as exc:
        logger.warning("email.send_failed", to=to_address, error=str(exc))
        raise

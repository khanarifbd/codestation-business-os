from __future__ import annotations

import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


class AccountEmailDeliveryError(RuntimeError):
    pass


def account_email_delivery_available() -> bool:
    return settings.smtp_configured or not settings.require_account_email_delivery


def _email_shell(content: str) -> str:
    brand_mark_url = html.escape(
        f"{settings.public_app_url.rstrip('/')}/brand/codestationai-mark.svg",
        quote=True,
    )
    return (
        '<div style="margin:0;padding:32px 16px;background:#f5f5f3;font-family:Arial,sans-serif;color:#171717">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:18px;overflow:hidden">'
        '<div style="padding:24px 28px;border-bottom:1px solid #eeeeee">'
        '<div style="display:flex;align-items:center;gap:12px">'
        f'<img src="{brand_mark_url}" alt="CodeStation AI" width="40" style="display:block;width:40px;height:auto">'
        '<div><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#737373">CodeStation AI</div>'
        '<div style="margin-top:3px;font-size:18px;font-weight:700;color:#171717">Business OS</div></div>'
        '</div></div>'
        f'<div style="padding:28px;font-size:15px;line-height:1.7;color:#404040">{content}</div>'
        '<div style="padding:18px 28px;border-top:1px solid #eeeeee;font-size:12px;color:#a3a3a3">'
        'CodeStation AI Business OS · Secure business operations in one workspace'
        '</div></div></div>'
    )


def _send_message(*, to_email: str, subject: str, text_body: str, html_body: str) -> bool:
    if not settings.smtp_configured:
        if settings.require_account_email_delivery:
            raise AccountEmailDeliveryError("Account email delivery is not configured")
        # Development/CI can exercise the auth flow without an SMTP dependency.
        # Tokens are deliberately never printed or returned to avoid normalizing
        # insecure recovery behavior.
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    message["To"] = to_email
    message.set_content(text_body)
    message.add_alternative(_email_shell(html_body), subtype="html")

    try:
        if settings.smtp_use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
                context=context,
            ) as smtp:
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
            ) as smtp:
                if settings.smtp_use_starttls:
                    smtp.starttls(context=ssl.create_default_context())
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise AccountEmailDeliveryError("Unable to deliver account email") from exc
    return True


def send_email_verification(*, email: str, full_name: str, token: str) -> bool:
    verification_url = f"{settings.public_app_url.rstrip('/')}/verify-email?token={token}"
    safe_name = html.escape(full_name)
    safe_url = html.escape(verification_url, quote=True)
    return _send_message(
        to_email=email,
        subject="Verify your CodeStation AI Business OS email",
        text_body=(
            f"Hello {full_name},\n\n"
            "Verify your email address to activate your CodeStation AI Business OS account:\n"
            f"{verification_url}\n\n"
            f"This link expires in {settings.email_verification_token_expire_hours} hours. "
            "If you did not create this account, you can ignore this email."
        ),
        html_body=(
            f"<p>Hello {safe_name},</p>"
            "<p>Verify your email address to activate your CodeStation AI Business OS account.</p>"
            f'<p><a href="{safe_url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#171717;color:#ffffff;text-decoration:none;font-weight:700">Verify email address</a></p>'
            f"<p>This link expires in {settings.email_verification_token_expire_hours} hours.</p>"
            "<p>If you did not create this account, you can ignore this email.</p>"
        ),
    )


def send_password_reset(*, email: str, full_name: str, token: str) -> bool:
    reset_url = f"{settings.public_app_url.rstrip('/')}/reset-password?token={token}"
    safe_name = html.escape(full_name)
    safe_url = html.escape(reset_url, quote=True)
    return _send_message(
        to_email=email,
        subject="Reset your CodeStation AI Business OS password",
        text_body=(
            f"Hello {full_name},\n\n"
            "Use the link below to reset your CodeStation AI Business OS password:\n"
            f"{reset_url}\n\n"
            f"This link expires in {settings.password_reset_token_expire_minutes} minutes. "
            "If you did not request a password reset, you can ignore this email."
        ),
        html_body=(
            f"<p>Hello {safe_name},</p>"
            "<p>Use the link below to reset your CodeStation AI Business OS password.</p>"
            f'<p><a href="{safe_url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#171717;color:#ffffff;text-decoration:none;font-weight:700">Reset password</a></p>'
            f"<p>This link expires in {settings.password_reset_token_expire_minutes} minutes.</p>"
            "<p>If you did not request a password reset, you can ignore this email.</p>"
        ),
    )

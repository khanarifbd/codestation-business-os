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
    message.add_alternative(html_body, subtype="html")

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
        subject="Verify your CodeStation Business OS email",
        text_body=(
            f"Hello {full_name},\n\n"
            "Verify your email address to activate your CodeStation Business OS account:\n"
            f"{verification_url}\n\n"
            f"This link expires in {settings.email_verification_token_expire_hours} hours. "
            "If you did not create this account, you can ignore this email."
        ),
        html_body=(
            f"<p>Hello {safe_name},</p>"
            "<p>Verify your email address to activate your CodeStation Business OS account.</p>"
            f'<p><a href="{safe_url}">Verify email address</a></p>'
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
        subject="Reset your CodeStation Business OS password",
        text_body=(
            f"Hello {full_name},\n\n"
            "Use the link below to reset your CodeStation Business OS password:\n"
            f"{reset_url}\n\n"
            f"This link expires in {settings.password_reset_token_expire_minutes} minutes. "
            "If you did not request a password reset, you can ignore this email."
        ),
        html_body=(
            f"<p>Hello {safe_name},</p>"
            "<p>Use the link below to reset your CodeStation Business OS password.</p>"
            f'<p><a href="{safe_url}">Reset password</a></p>'
            f"<p>This link expires in {settings.password_reset_token_expire_minutes} minutes.</p>"
            "<p>If you did not request a password reset, you can ignore this email.</p>"
        ),
    )

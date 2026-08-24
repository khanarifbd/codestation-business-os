from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

PaymentMethod = Literal["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "other"]


def normalize_payment_url(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Payment URL must be a valid http or https URL")
    return cleaned


class PaymentDestinationRead(BaseModel):
    id: str
    name: str
    account_type: str
    provider_name: str | None
    account_holder_name: str | None
    account_reference: str | None
    currency: str
    payment_url: str | None
    payment_instructions: str | None


class PaymentDestinationSettingsUpdate(BaseModel):
    payment_url: str | None = Field(default=None, max_length=1000)
    payment_instructions: str | None = Field(default=None, max_length=5000)

    @field_validator("payment_url")
    @classmethod
    def validate_payment_url(cls, value: str | None) -> str | None:
        return normalize_payment_url(value)


class InvoicePaymentInstructionsRead(BaseModel):
    invoice_id: str
    invoice_number: str
    invoice_status: str
    invoice_currency: str
    payment_method: str | None
    payment_account_id: str | None
    payment_account_name: str | None
    payment_provider: str | None
    payment_account_holder: str | None
    payment_account_reference: str | None
    payment_currency: str | None
    payment_url: str | None
    payment_instructions: str | None
    locked: bool


class InvoicePaymentInstructionsUpdate(BaseModel):
    payment_method: PaymentMethod | None = None
    payment_account_id: str | None = None
    payment_url: str | None = Field(default=None, max_length=1000)
    payment_instructions: str | None = Field(default=None, max_length=5000)

    @field_validator("payment_url")
    @classmethod
    def validate_payment_url(cls, value: str | None) -> str | None:
        return normalize_payment_url(value)

    @model_validator(mode="after")
    def validate_configuration(self):
        self.payment_account_id = self.payment_account_id.strip() if self.payment_account_id else None
        if self.payment_instructions is not None:
            self.payment_instructions = self.payment_instructions.strip() or None
        configured = bool(self.payment_method or self.payment_account_id or self.payment_url or self.payment_instructions)
        if configured and not self.payment_method:
            raise ValueError("Choose a payment method when payment instructions are enabled")
        return self

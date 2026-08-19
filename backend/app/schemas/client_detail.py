from datetime import datetime

from pydantic import BaseModel


class ClientDetailRead(BaseModel):
    id: str
    client_code: str
    client_type: str
    display_name: str
    legal_name: str | None
    contact_name: str | None
    email: str | None
    billing_email: str | None
    phone: str | None
    whatsapp: str | None
    website: str | None
    country_code: str | None
    state_region: str | None
    city: str | None
    postal_code: str | None
    address_line1: str | None
    address_line2: str | None
    tax_identifier: str | None
    currency: str | None
    acquisition_source_id: str | None
    acquisition_source_name: str | None
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    status: str
    notes: str | None
    source_lead_id: str | None
    source_lead_code: str | None
    source_lead_status: str | None
    created_at: datetime
    updated_at: datetime

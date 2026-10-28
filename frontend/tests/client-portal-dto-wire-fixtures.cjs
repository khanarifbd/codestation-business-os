/* Generated from 17 real frozen Portal Pydantic DTOs with the offline AST-only serializer.
 * Synthetic values only; no application imports, requests, DB, credentials or payment execution.
 * Regenerate using evidence/client-portal-model/dto-serialize.py; evidence includes exact source hashes.
 */
module.exports = {
  "provenance": {
    "method": "Real Pydantic AST-only extraction; schema-derived typed Python samples; no application imports or services",
    "python": "3.13.5",
    "pydantic": "2.13.4",
    "class_count": 17,
    "sources": [
      {
        "path": "evidence/contracts/backend/app/api/v1/client_portal.py",
        "sha256": "0ce556e97336e50da6d90e7bef6a36194e988649132f399ae99f5ff3de3deb6c"
      },
      {
        "path": "evidence/contracts/backend/app/api/v1/phase4_read_fast_extra.py",
        "sha256": "404326c8ac7fc0c7c73fb39e3ce362880c939e2be36ce081c6481d01604ee934"
      }
    ],
    "no_network_guard": true,
    "fast_orders_check": "AST projection fields only; no SQL or handler invocation"
  },
  "schema": {
    "ClientPortalClient": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_code": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "display_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_type": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "phone": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "is_primary_contact": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalFinancial": {
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "invoice_count": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "invoiced_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "balance_due": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalContext": {
      "organization_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "organization_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "membership_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "clients": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "project_count": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "order_count": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quotation_count": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "financials": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalMilestone": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "title": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "description": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "progress_percent": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "due_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "completed_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      }
    },
    "ClientPortalProject": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "project_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "progress_percent": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "planned_start_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "due_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "contract_value": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "description": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "actual_started_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "completed_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      }
    },
    "ClientPortalProjectDetail": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "project_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "progress_percent": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "planned_start_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "due_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "contract_value": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "description": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "actual_started_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "completed_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "milestones": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalOrder": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "order_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quotation_id": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "subject": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "order_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "approved_change_value": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "revised_contract_value": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "confirmed_at": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "started_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "completed_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "cancelled_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      }
    },
    "ClientPortalOrderItem": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "item_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "description": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quantity": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "unit": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "unit_price": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "discount_percent": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "tax_rate": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "line_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "service_duration_months": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "service_start_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "service_end_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      }
    },
    "ClientPortalOrderDetail": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "order_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quotation_id": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "subject": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "order_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "approved_change_value": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "revised_contract_value": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "confirmed_at": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "started_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "completed_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "cancelled_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "seller_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "seller_email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "seller_address": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_contact": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_address": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "subtotal": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "discount_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "tax_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "notes": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "terms_conditions": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "items": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalInvoice": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "invoice_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "project_id": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "quotation_id": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "subject": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "issue_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "due_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "amount_paid": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "balance_due": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalInvoiceItem": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "item_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "description": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quantity": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "unit": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "unit_price": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "discount_percent": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "tax_rate": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "line_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalInvoicePayment": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "payment_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "invoice_currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "invoice_amount": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "method": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "reference": {
        "required": true,
        "nullable": true,
        "default": "required"
      }
    },
    "ClientPortalInvoiceDetail": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "invoice_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "project_id": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "quotation_id": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "subject": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "issue_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "due_date": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "amount_paid": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "balance_due": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "seller_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "seller_email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "seller_address": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_contact": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_address": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_method": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_account_name": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_provider": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_account_holder": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_account_reference": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_currency": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_url": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "payment_instructions": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "subtotal": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "discount_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "tax_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "notes": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "terms_conditions": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "items": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "payments": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalQuotation": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quotation_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "subject": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "issue_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "valid_until": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "total": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalQuotationItem": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "item_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "description": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quantity": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "unit": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "unit_price": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "discount_percent": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "tax_rate": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "line_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalQuotationDetail": {
      "id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "quotation_number": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_id": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "subject": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "issue_date": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "valid_until": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "currency": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "seller_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "seller_email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "seller_address": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_name": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "client_contact": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_email": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "client_address": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "subtotal": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "discount_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "tax_total": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "notes": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "terms_conditions": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "accepted_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "rejected_at": {
        "required": true,
        "nullable": true,
        "default": "required"
      },
      "items": {
        "required": true,
        "nullable": false,
        "default": "required"
      }
    },
    "ClientPortalQuotationDecision": {
      "status": {
        "required": true,
        "nullable": false,
        "default": "required"
      },
      "reason": {
        "required": false,
        "nullable": true,
        "default": null
      }
    }
  },
  "fast_order_projection_fields": [
    "id",
    "order_number",
    "client_id",
    "quotation_id",
    "status",
    "subject",
    "order_date",
    "currency",
    "total",
    "approved_change_value",
    "revised_contract_value",
    "confirmed_at",
    "started_at",
    "completed_at",
    "cancelled_at"
  ],
  "cases": [
    {
      "name": "ClientPortalContext-all-nullable-null",
      "model": "ClientPortalContext",
      "expected": true,
      "body": {
        "organization_id": "synthetic-organization",
        "organization_name": "",
        "membership_id": "synthetic-membership",
        "clients": [
          {
            "id": "synthetic-clientportalclient",
            "client_code": "",
            "display_name": "",
            "client_type": "",
            "email": null,
            "phone": null,
            "currency": null,
            "is_primary_contact": false
          }
        ],
        "project_count": 0,
        "order_count": 0,
        "quotation_count": 0,
        "financials": [
          {
            "currency": "USD",
            "invoice_count": 0,
            "invoiced_total": "0.00",
            "balance_due": "0.00"
          }
        ]
      }
    },
    {
      "name": "ClientPortalContext-populated",
      "model": "ClientPortalContext",
      "expected": true,
      "body": {
        "organization_id": "synthetic-organization",
        "organization_name": "Synthetic organization_name",
        "membership_id": "synthetic-membership",
        "clients": [
          {
            "id": "synthetic-clientportalclient",
            "client_code": "Synthetic client_code",
            "display_name": "Synthetic display_name",
            "client_type": "Synthetic client_type",
            "email": "Synthetic email",
            "phone": "Synthetic phone",
            "currency": "USD",
            "is_primary_contact": true
          }
        ],
        "project_count": 0,
        "order_count": 0,
        "quotation_count": 0,
        "financials": [
          {
            "currency": "USD",
            "invoice_count": 0,
            "invoiced_total": "1234567890123456.78",
            "balance_due": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalProject-all-nullable-null",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "",
        "client_id": "synthetic-client",
        "name": "",
        "status": "active",
        "progress_percent": 0,
        "planned_start_date": null,
        "due_date": null,
        "currency": "USD",
        "contract_value": "0.00",
        "description": null,
        "actual_started_at": null,
        "completed_at": null
      }
    },
    {
      "name": "ClientPortalProject-populated",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalProjectDetail-all-nullable-null",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "",
        "client_id": "synthetic-client",
        "name": "",
        "status": "active",
        "progress_percent": 0,
        "planned_start_date": null,
        "due_date": null,
        "currency": "USD",
        "contract_value": "0.00",
        "description": null,
        "actual_started_at": null,
        "completed_at": null,
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "",
            "description": null,
            "status": "active",
            "progress_percent": 0,
            "due_date": null,
            "completed_at": null
          }
        ]
      }
    },
    {
      "name": "ClientPortalProjectDetail-populated",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrder-all-nullable-null",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "",
        "client_id": "synthetic-client",
        "quotation_id": null,
        "status": "confirmed",
        "subject": null,
        "order_date": "2026-10-27",
        "currency": "USD",
        "total": "0.00",
        "approved_change_value": "0.00",
        "revised_contract_value": "0.00",
        "confirmed_at": "2026-10-27T00:00:00",
        "started_at": null,
        "completed_at": null,
        "cancelled_at": null
      }
    },
    {
      "name": "ClientPortalOrder-populated",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalOrderDetail-all-nullable-null",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "",
        "client_id": "synthetic-client",
        "quotation_id": null,
        "status": "confirmed",
        "subject": null,
        "order_date": "2026-10-27",
        "currency": "USD",
        "total": "0.00",
        "approved_change_value": "0.00",
        "revised_contract_value": "0.00",
        "confirmed_at": "2026-10-27T00:00:00",
        "started_at": null,
        "completed_at": null,
        "cancelled_at": null,
        "seller_name": "",
        "seller_email": null,
        "seller_address": null,
        "client_name": "",
        "client_contact": null,
        "client_email": null,
        "client_address": null,
        "subtotal": "0.00",
        "discount_total": "0.00",
        "tax_total": "0.00",
        "notes": null,
        "terms_conditions": null,
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "",
            "description": "",
            "quantity": "0.00",
            "unit": "",
            "unit_price": "0.00",
            "discount_percent": "0.00",
            "tax_rate": "0.00",
            "line_total": "0.00",
            "service_duration_months": null,
            "service_start_date": null,
            "service_end_date": null
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-populated",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotation-all-nullable-null",
      "model": "ClientPortalQuotation",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotation",
        "quotation_number": "",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": null,
        "issue_date": "2026-10-27",
        "valid_until": null,
        "currency": "USD",
        "total": "0.00"
      }
    },
    {
      "name": "ClientPortalQuotation-populated",
      "model": "ClientPortalQuotation",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotation",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalQuotationDetail-all-nullable-null",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": null,
        "issue_date": "2026-10-27",
        "valid_until": null,
        "currency": "USD",
        "total": "0.00",
        "seller_name": "",
        "seller_email": null,
        "seller_address": null,
        "client_name": "",
        "client_contact": null,
        "client_email": null,
        "client_address": null,
        "subtotal": "0.00",
        "discount_total": "0.00",
        "tax_total": "0.00",
        "notes": null,
        "terms_conditions": null,
        "accepted_at": null,
        "rejected_at": null,
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "",
            "description": "",
            "quantity": "0.00",
            "unit": "",
            "unit_price": "0.00",
            "discount_percent": "0.00",
            "tax_rate": "0.00",
            "line_total": "0.00"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-populated",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoice-all-nullable-null",
      "model": "ClientPortalInvoice",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoice",
        "invoice_number": "",
        "client_id": "synthetic-client",
        "project_id": null,
        "quotation_id": null,
        "status": "sent",
        "subject": null,
        "issue_date": "2026-10-27",
        "due_date": null,
        "currency": "USD",
        "total": "0.00",
        "amount_paid": "0.00",
        "balance_due": "0.00"
      }
    },
    {
      "name": "ClientPortalInvoice-populated",
      "model": "ClientPortalInvoice",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoice",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-all-nullable-null",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "",
        "client_id": "synthetic-client",
        "project_id": null,
        "quotation_id": null,
        "status": "sent",
        "subject": null,
        "issue_date": "2026-10-27",
        "due_date": null,
        "currency": "USD",
        "total": "0.00",
        "amount_paid": "0.00",
        "balance_due": "0.00",
        "seller_name": "",
        "seller_email": null,
        "seller_address": null,
        "client_name": "",
        "client_contact": null,
        "client_email": null,
        "client_address": null,
        "payment_method": null,
        "payment_account_name": null,
        "payment_provider": null,
        "payment_account_holder": null,
        "payment_account_reference": null,
        "payment_currency": null,
        "payment_url": null,
        "payment_instructions": null,
        "subtotal": "0.00",
        "discount_total": "0.00",
        "tax_total": "0.00",
        "notes": null,
        "terms_conditions": null,
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "",
            "description": "",
            "quantity": "0.00",
            "unit": "",
            "unit_price": "0.00",
            "discount_percent": "0.00",
            "tax_rate": "0.00",
            "line_total": "0.00"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2026-10-27",
            "invoice_currency": "USD",
            "invoice_amount": "0.00",
            "method": "",
            "reference": null
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-populated",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalProject-null-planned_start_date",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": null,
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalProject-null-due_date",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": null,
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalProject-null-description",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": null,
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalProject-null-actual_started_at",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": null,
        "completed_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalProject-null-completed_at",
      "model": "ClientPortalProject",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalproject",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": null
      }
    },
    {
      "name": "ClientPortalProjectDetail-null-planned_start_date",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": null,
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "ClientPortalProjectDetail-null-due_date",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": null,
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "ClientPortalProjectDetail-null-description",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": null,
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "ClientPortalProjectDetail-null-actual_started_at",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": null,
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "ClientPortalProjectDetail-null-completed_at",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": null,
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrder-null-quotation_id",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": null,
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalOrder-null-subject",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": null,
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalOrder-null-started_at",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": null,
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalOrder-null-completed_at",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": null,
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "ClientPortalOrder-null-cancelled_at",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": null
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-quotation_id",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": null,
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-subject",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": null,
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-started_at",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": null,
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-completed_at",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": null,
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-cancelled_at",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": null,
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-seller_email",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": null,
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-seller_address",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": null,
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-client_contact",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": null,
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-client_email",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": null,
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-client_address",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": null,
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-notes",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": null,
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalOrderDetail-null-terms_conditions",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": null,
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotation-null-subject",
      "model": "ClientPortalQuotation",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotation",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": null,
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalQuotation-null-valid_until",
      "model": "ClientPortalQuotation",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotation",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": null,
        "currency": "USD",
        "total": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-subject",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": null,
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-valid_until",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": null,
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-seller_email",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": null,
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-seller_address",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": null,
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-client_contact",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": null,
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-client_email",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": null,
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-client_address",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": null,
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-notes",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": null,
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-terms_conditions",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": null,
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-accepted_at",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": null,
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalQuotationDetail-null-rejected_at",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": null,
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoice-null-project_id",
      "model": "ClientPortalInvoice",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoice",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": null,
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalInvoice-null-quotation_id",
      "model": "ClientPortalInvoice",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoice",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": null,
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalInvoice-null-subject",
      "model": "ClientPortalInvoice",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoice",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": null,
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalInvoice-null-due_date",
      "model": "ClientPortalInvoice",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoice",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": null,
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78"
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-project_id",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": null,
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-quotation_id",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": null,
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-subject",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": null,
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-due_date",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": null,
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-seller_email",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": null,
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-seller_address",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": null,
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-client_contact",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": null,
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-client_email",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": null,
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-client_address",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": null,
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_method",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": null,
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_account_name",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": null,
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_provider",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": null,
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_account_holder",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": null,
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_account_reference",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": null,
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_currency",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": null,
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_url",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": null,
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-payment_instructions",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": null,
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-notes",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": null,
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "ClientPortalInvoiceDetail-null-terms_conditions",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": null,
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "Project-status-planned",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "planned",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "Project-status-active",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "active",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "Project-status-on_hold",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "on_hold",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "Project-status-completed",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "completed",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "Project-status-cancelled",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "cancelled",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "Project-status-future_read_only_status",
      "model": "ClientPortalProjectDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalprojectdetail",
        "project_number": "Synthetic project_number",
        "client_id": "synthetic-client",
        "name": "Synthetic name",
        "status": "future_read_only_status",
        "progress_percent": 100,
        "planned_start_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "contract_value": "1234567890123456.78",
        "description": "Synthetic description",
        "actual_started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "milestones": [
          {
            "id": "synthetic-clientportalmilestone",
            "title": "Synthetic title",
            "description": "Synthetic description",
            "status": "active",
            "progress_percent": 100,
            "due_date": "2028-02-29",
            "completed_at": "2026-10-27T00:42:01.123456+05:30"
          }
        ]
      }
    },
    {
      "name": "Order-status-draft",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "draft",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "Order-status-confirmed",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "Order-status-in_progress",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "in_progress",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "Order-status-completed",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "completed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "Order-status-cancelled",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "cancelled",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "Order-status-future_read_only_status",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "future_read_only_status",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "Quotation-status-sent",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "Quotation-status-accepted",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "accepted",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "Quotation-status-rejected",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "rejected",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "Quotation-status-future_read_only_status",
      "model": "ClientPortalQuotationDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "future_read_only_status",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      }
    },
    {
      "name": "Invoice-status-sent",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "Invoice-status-partially_paid",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "partially_paid",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "Invoice-status-paid",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "paid",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "Invoice-status-overdue",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "overdue",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "Invoice-status-future_read_only_status",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "future_read_only_status",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "exact-decimal-0E-8",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "0E-8",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "0E-8",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "exact-decimal--0.01",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "-0.01",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "-0.01",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "exact-decimal-1E+18",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1E+18",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1E+18",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "exact-decimal-0.12345678",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "0.12345678",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "0.12345678",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "exact-decimal-9999999999999999.99",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "9999999999999999.99",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "9999999999999999.99",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "calendar-0001-01-01",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "0001-01-01",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "calendar-9999-12-31",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "9999-12-31",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "calendar-2000-02-29",
      "model": "ClientPortalInvoiceDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "sent",
        "subject": "Synthetic subject",
        "issue_date": "2000-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      }
    },
    {
      "name": "timestamp-0001-01-01 00:00:00",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "0001-01-01T00:00:00",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "timestamp-9999-12-31 23:59:59.999999",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "9999-12-31T23:59:59.999999",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "timestamp-2026-10-27 00:00:00+00:00",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:00:00Z",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "timestamp-2026-10-27 00:00:00-04:00",
      "model": "ClientPortalOrderDetail",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorderdetail",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "approved_change_value": "1234567890123456.78",
        "revised_contract_value": "1234567890123456.78",
        "confirmed_at": "2026-10-27T00:00:00-04:00",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalorderitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78",
            "service_duration_months": 0,
            "service_start_date": "2028-02-29",
            "service_end_date": "2028-02-29"
          }
        ]
      }
    },
    {
      "name": "fast-order-shaped-signed-approved-reduction",
      "model": "ClientPortalOrder",
      "expected": true,
      "body": {
        "id": "synthetic-clientportalorder",
        "order_number": "Synthetic order_number",
        "client_id": "synthetic-client",
        "quotation_id": "synthetic-quotation",
        "status": "confirmed",
        "subject": "Synthetic subject",
        "order_date": "2028-02-29",
        "currency": "USD",
        "total": "1000.00",
        "approved_change_value": "-250.00",
        "revised_contract_value": "750.00",
        "confirmed_at": "2026-10-27T00:42:01.123456+05:30",
        "started_at": "2026-10-27T00:42:01.123456+05:30",
        "completed_at": "2026-10-27T00:42:01.123456+05:30",
        "cancelled_at": "2026-10-27T00:42:01.123456+05:30"
      }
    },
    {
      "name": "Quotation-endpoint-excludes-draft",
      "model": "ClientPortalQuotationDetail",
      "expected": false,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "draft",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      },
      "explanation": "Pydantic status is plain str, but both portal list and detail SQL exclude draft/cancelled."
    },
    {
      "name": "Quotation-endpoint-excludes-cancelled",
      "model": "ClientPortalQuotationDetail",
      "expected": false,
      "body": {
        "id": "synthetic-clientportalquotationdetail",
        "quotation_number": "Synthetic quotation_number",
        "client_id": "synthetic-client",
        "status": "cancelled",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "valid_until": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "accepted_at": "2026-10-27T00:42:01.123456+05:30",
        "rejected_at": "2026-10-27T00:42:01.123456+05:30",
        "items": [
          {
            "id": "synthetic-clientportalquotationitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ]
      },
      "explanation": "Pydantic status is plain str, but both portal list and detail SQL exclude draft/cancelled."
    },
    {
      "name": "Invoice-endpoint-excludes-draft",
      "model": "ClientPortalInvoiceDetail",
      "expected": false,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "draft",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      },
      "explanation": "Pydantic status is plain str, but both portal list and detail SQL exclude draft/cancelled."
    },
    {
      "name": "Invoice-endpoint-excludes-cancelled",
      "model": "ClientPortalInvoiceDetail",
      "expected": false,
      "body": {
        "id": "synthetic-clientportalinvoicedetail",
        "invoice_number": "Synthetic invoice_number",
        "client_id": "synthetic-client",
        "project_id": "synthetic-project",
        "quotation_id": "synthetic-quotation",
        "status": "cancelled",
        "subject": "Synthetic subject",
        "issue_date": "2028-02-29",
        "due_date": "2028-02-29",
        "currency": "USD",
        "total": "1234567890123456.78",
        "amount_paid": "1234567890123456.78",
        "balance_due": "1234567890123456.78",
        "seller_name": "Synthetic seller_name",
        "seller_email": "Synthetic seller_email",
        "seller_address": "Synthetic seller_address",
        "client_name": "Synthetic client_name",
        "client_contact": "Synthetic client_contact",
        "client_email": "Synthetic client_email",
        "client_address": "Synthetic client_address",
        "payment_method": "Synthetic payment_method",
        "payment_account_name": "Synthetic payment_account_name",
        "payment_provider": "Synthetic payment_provider",
        "payment_account_holder": "Synthetic payment_account_holder",
        "payment_account_reference": "Synthetic payment_account_reference",
        "payment_currency": "USD",
        "payment_url": "https://payments.example.invalid/inert?signature=synthetic%2Fnot-a-capability",
        "payment_instructions": "Synthetic payment_instructions",
        "subtotal": "1234567890123456.78",
        "discount_total": "1234567890123456.78",
        "tax_total": "1234567890123456.78",
        "notes": "Synthetic notes",
        "terms_conditions": "Synthetic terms_conditions",
        "items": [
          {
            "id": "synthetic-clientportalinvoiceitem",
            "item_name": "Synthetic item_name",
            "description": "Synthetic description",
            "quantity": "1234567890123456.78",
            "unit": "Synthetic unit",
            "unit_price": "1234567890123456.78",
            "discount_percent": "1234567890123456.78",
            "tax_rate": "1234567890123456.78",
            "line_total": "1234567890123456.78"
          }
        ],
        "payments": [
          {
            "id": "synthetic-clientportalinvoicepayment",
            "payment_date": "2028-02-29",
            "invoice_currency": "USD",
            "invoice_amount": "1234567890123456.78",
            "method": "Synthetic method",
            "reference": "Synthetic reference"
          }
        ]
      },
      "explanation": "Pydantic status is plain str, but both portal list and detail SQL exclude draft/cancelled."
    }
  ],
  "pydantic_rejections": [
    {
      "name": "confirmed_at-null-is-not-supported",
      "model": "ClientPortalOrder",
      "errors": [
        {
          "loc": [
            "confirmed_at"
          ],
          "type": "datetime_type"
        }
      ]
    },
    {
      "name": "required-decimal-null-is-not-supported",
      "model": "ClientPortalInvoice",
      "errors": [
        {
          "loc": [
            "total"
          ],
          "type": "decimal_type"
        }
      ]
    },
    {
      "name": "date-rollover-is-invalid",
      "model": "ClientPortalInvoice",
      "errors": [
        {
          "loc": [
            "issue_date"
          ],
          "type": "date_from_datetime_parsing"
        }
      ]
    },
    {
      "name": "decision-status-literal-is-not-readonly-status",
      "model": "ClientPortalQuotationDecision",
      "errors": [
        {
          "loc": [
            "status"
          ],
          "type": "literal_error"
        }
      ]
    },
    {
      "name": "nullable-payment-url-is-required-not-defaulted",
      "model": "ClientPortalInvoiceDetail",
      "errors": [
        {
          "loc": [
            "payment_url"
          ],
          "type": "missing"
        }
      ]
    },
    {
      "name": "non-finite-decimal-is-invalid",
      "model": "ClientPortalInvoice",
      "errors": [
        {
          "loc": [
            "total"
          ],
          "type": "finite_number"
        }
      ]
    }
  ],
  "decision_defaults": {
    "status": "accepted",
    "reason": null
  }
};

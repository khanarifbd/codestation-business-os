"""Additive exact decimal companions at the Capital HTTP serialization boundary.

Handlers retain native Decimal results for in-process accounting callers. Legacy
JSON values are unchanged; new clients should prefer the sibling `<name>_exact`.
"""
from decimal import Decimal
from typing import Any

from fastapi.encoders import jsonable_encoder
from pydantic import ConfigDict, RootModel, model_serializer

CAPITAL_DECIMAL_FIELDS = frozenset({
    "amount", "annual_interest_rate", "balance", "carrying_value", "cash_amount",
    "committed_amount", "company_committed", "company_funded", "contract_value",
    "funded_amount", "income_amount", "interest_amount", "invested_amount",
    "investment_income", "investor_profit_paid", "our_investments",
    "outstanding_capital", "outstanding_commitment", "outstanding_principal",
    "ownership_percent", "principal_amount", "principal_return_amount",
    "principal_returned", "profit_paid", "profit_share_amount", "project_committed",
    "project_funded", "share_value", "valuation_amount", "company_retained_profit",
    "direct_cost", "investor_profit_share", "loan_interest", "net_capital_pnl_impact",
    "principal_remaining", "profit_entitlement", "profit_remaining", "project_profit",
    "revenue", "total_investor_profit_entitlement", "total_investor_profit_paid",
})


def capital_exact_companions(value: Any) -> Any:
    if isinstance(value, dict):
        result = {key: capital_exact_companions(item) for key, item in value.items()}
        for key, item in value.items():
            if key in CAPITAL_DECIMAL_FIELDS and (isinstance(item, Decimal) or item is None):
                companion = f"{key}_exact"
                if companion in value:
                    raise ValueError("Reserved Capital exact companion field collision")
                if isinstance(item, Decimal) and not item.is_finite():
                    raise ValueError("Capital monetary responses must be finite")
                result[companion] = None if item is None else format(item, "f")
        return result
    if isinstance(value, (list, tuple)):
        return [capital_exact_companions(item) for item in value]
    return value


class CapitalExactResponse(RootModel[Any]):
    model_config = ConfigDict(json_schema_extra={
        "description": "Original Capital response shape and numeric fields are retained. "
        "Every listed financial Decimal field has a sibling <field>_exact containing "
        "its exact fixed-point decimal string, or null for a null optional value. "
        "Prefer exact companions for monetary calculations and display. Integer counts, "
        "identifiers, dates and status fields are unchanged.",
        "x-capital-exact-decimal-fields": sorted(CAPITAL_DECIMAL_FIELDS),
        "x-capital-exact-companions": {
            f"{field}_exact": {"type": ["string", "null"], "pattern": r"^-?\d+(?:\.\d+)?$"}
            for field in sorted(CAPITAL_DECIMAL_FIELDS)
        },
    })

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema: Any, handler: Any) -> dict[str, Any]:
        schema = handler(core_schema)
        schema.update(cls.model_config["json_schema_extra"])
        return schema

    @model_serializer(mode="plain")
    def serialize_capital(self) -> Any:
        # Explicit legacy encoding is intentional: never replace existing JSON
        # numbers with strings or change direct handler monetary return values.
        return jsonable_encoder(capital_exact_companions(self.root))

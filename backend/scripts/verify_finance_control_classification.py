from app.api.v1.accounting_reports import _cash_flow_bucket


def main() -> None:
    expected = {
        "invoice_payment": "operating",
        "expense_post": "operating",
        "account_transfer": "operating",
        "loan_disbursement": "financing",
        "company_investor_funding": "financing",
        "company_investor_payout": "financing",
        "project_investor_funding": "financing",
        "investor_payout": "financing",
        "company_investment_funding": "investing",
        "investment_return": "investing",
        "fixed_asset_acquisition": "investing",
    }
    for source, bucket in expected.items():
        actual = _cash_flow_bucket(source)
        if actual != bucket:
            raise AssertionError(f"{source} classified as {actual}, expected {bucket}")
    print("cash flow classification verification passed")


if __name__ == "__main__":
    main()

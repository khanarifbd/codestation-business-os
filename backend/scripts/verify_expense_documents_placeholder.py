from app.api.v1.finance_expenses import preview_expense_document, upload_expense_document

assert callable(preview_expense_document)
assert callable(upload_expense_document)
print("expense document routes import verification passed")

type InvoiceBalance = { status: string; balance_due: string | number };

export function matchesInvoiceBalance(invoice: InvoiceBalance, filter: "outstanding" | "paid") {
  const due = Number(invoice.balance_due || 0);
  return filter === "paid"
    ? invoice.status === "paid" && due <= 0
    : !["draft", "cancelled", "paid"].includes(invoice.status) && due > 0;
}

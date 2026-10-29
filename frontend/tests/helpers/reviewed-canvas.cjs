// Only these reviewed full-page canvas strings may differ from immutable baseline fixtures.
// Exact replacement counts prevent this allowance from masking unrelated presentation or logic changes.
const assert = require('node:assert/strict');
const changes = {
  "src/components/auth/auth-frame.tsx": [
    [
      "    <main className=\"relative min-h-screen overflow-hidden bg-[#f5f5f3] px-4 py-4 text-neutral-950 sm:px-6 sm:py-6 lg:px-8 lg:py-8\">",
      "    <main className=\"relative min-h-screen overflow-hidden bg-[var(--app-canvas)] px-4 py-4 text-neutral-950 sm:px-6 sm:py-6 lg:px-8 lg:py-8\">"
    ],
    [
      "      <div className=\"pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,255,255,0.95),transparent_28%),radial-gradient(circle_at_88%_90%,rgba(228,228,226,0.9),transparent_30%)]\" />\n",
      ""
    ]
  ],
  "src/components/tenant-area-guard.tsx": [
    [
      "    <main className=\"flex min-h-screen items-center justify-center bg-neutral-100 px-5 text-neutral-950\">",
      "    <main className=\"flex min-h-screen items-center justify-center bg-[var(--app-canvas)] px-5 text-neutral-950\">"
    ]
  ],
  "src/app/payments/stripe/return/page.tsx": [
    [
      "  return <main className=\"flex min-h-screen items-center justify-center bg-neutral-100 p-4\">",
      "  return <main className=\"flex min-h-screen items-center justify-center bg-[var(--app-canvas)] p-4\">"
    ]
  ],
  "src/app/print/invoices/[invoiceId]/page.tsx": [
    [
      "      <main className=\"flex min-h-screen items-center justify-center bg-neutral-100\">",
      "      <main className=\"flex min-h-screen items-center justify-center bg-[var(--app-canvas)]\">"
    ],
    [
      "      <main className=\"flex min-h-screen items-center justify-center bg-neutral-100 p-6\">",
      "      <main className=\"flex min-h-screen items-center justify-center bg-[var(--app-canvas)] p-6\">"
    ],
    [
      "    <main className=\"min-h-screen overflow-x-auto bg-neutral-100 px-4 py-8 text-neutral-950 print:overflow-visible print:bg-white print:p-0\">",
      "    <main className=\"min-h-screen overflow-x-auto bg-[var(--app-canvas)] px-4 py-8 text-neutral-950 print:overflow-visible print:bg-white print:p-0\">"
    ]
  ],
  "src/app/print/quotations/[quotationId]/page.tsx": [
    [
      "      <main className=\"flex min-h-screen items-center justify-center bg-neutral-100\">",
      "      <main className=\"flex min-h-screen items-center justify-center bg-[var(--app-canvas)]\">"
    ],
    [
      "      <main className=\"flex min-h-screen items-center justify-center bg-neutral-100 p-6\">",
      "      <main className=\"flex min-h-screen items-center justify-center bg-[var(--app-canvas)] p-6\">"
    ],
    [
      "    <main className=\"min-h-screen bg-neutral-100 px-4 py-8 text-neutral-950 print:bg-white print:p-0\">",
      "    <main className=\"min-h-screen bg-[var(--app-canvas)] px-4 py-8 text-neutral-950 print:bg-white print:p-0\">"
    ]
  ]
};
exports.withReviewedCanvas = (file, original) => {
  let expected = original;
  for (const [before, after] of changes[file] ?? []) {
    assert.equal(expected.split(before).length - 1, 1, `Expected one reviewed canvas string in ${file}`);
    expected = expected.replace(before, after);
  }
  return expected;
};

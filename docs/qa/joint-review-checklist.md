# Business OS — যৌথ লোকাল রিভিউ চেকলিস্ট

এই চেকলিস্টটি আমাদের পরবর্তী যৌথ পরীক্ষার জন্য। Automated PASS আর ব্যবহারকারী নিজে দেখে PASS এক জিনিস নয়। নিচের মানব-পর্যবেক্ষণ ঘরগুলো ইচ্ছাকৃতভাবে ফাঁকা রাখা হয়েছে। কোনো branch-এ push, merge, deployment বা live database ব্যবহার করা হয়নি।

## শুরু করার আগে

- লোকাল কোম্পানি: **Local QA Review 2026**; currency **USD**, timezone **UTC**।
- রিপোর্টের একই সময়সীমা ব্যবহার করুন: **20 October 2026**। Payroll-এর অক্টোবরের draft-কে approved accrual ভেবে যোগ করবেন না।
- Owner, Casey Review (employee), Jordan Review (HR manager) প্রস্তুত। Credentials এই নথিতে নেই; বিদ্যমান owner credentials অপরিবর্তিত।
- সব client/vendor/employee fixture কাল্পনিক। Cash/payment মানে শুধু লোকাল ledger entry। SMTP ও live payment collection বন্ধ থাকবে।
- প্রত্যেক পরিবর্তনের আগে/পরে সংশ্লিষ্ট UI, API readback এবং ledger মিলিয়ে দেখব। Seed পুনরায় চালালে manual edits মুছবে না। নতুন পরিষ্কার database ছাড়া reset নয়।
- বর্তমান combined runner PostgreSQL/API/frontend/Chromium একই isolated local execution-এ চালায়। Interactive desktop browser-এর সঙ্গে এই localhost সংযোগ প্রতিষ্ঠিত হয়নি; public tunnel/deployment করা হবে না। Screenshot ও repeatable local checks প্রস্তুত আছে।

## অপরিবর্তিত শুরু-অবস্থা — PostgreSQL থেকে সরাসরি যাচাইকৃত

| বিষয় | প্রত্যাশিত মান |
|---|---:|
| INV-00001 — Paid order-linked service | USD 1,200; paid 1,200; due 0 |
| INV-00002 — Draft | USD 47.25; recognized revenue/AR-এ নয় |
| INV-00003 — Cancelled | USD 24.68 historical total; collectable due display 0 |
| Recognized revenue / collected / AR | 1,200 / 1,200 / 0 |
| QA Synthetic Cash | 5,890 |
| Stock QA-STOCK-001 | 10 units × 6 = 60 |
| Fictional Stock Supplier payable | 60 open |
| Total assets / AP / opening equity | 5,950 / 60 / 5,000 |
| Expenses / accrual profit | 310 / 890 |
| QA-PROJECT-001 revenue / direct cost / margin | 1,200 / 250 / 950 |
| Fictional Cost-only Studio | USD cost 60, profit −60; client preference GBP |
| PAY-00001 | Draft; employee salary USD 2,000; no approved payroll journal |
| QA Annual Leave | Allowance 20; approved 21 Oct 1 day; pending 24 Oct 1 day; remaining 18 |

Cancelled invoice-এর underlying historical balance এখনও 24.68 থাকতে পারে; API/UI collectable due 0 এবং GL AR 0 হওয়াই উদ্দেশ্য। ইতিহাস মুছে শূন্য করা হয়নি।

## ধাপে ধাপে পরীক্ষা

| QA | আমরা কী করব | PASS হলে কী দেখব | মানুষের পর্যবেক্ষণ |
|---|---|---|---|
| 001 | Login password field ও reveal control keyboard/screen-reader label দেখে নেব। | Field “Password”; আলাদা “Show password”/“Hide password” button। | ☐ PASS ☐ FAIL |
| 002 | Purchases-এর received 60 obligation → Payables; প্রথমে 20, পরে 40 internal settlement; তারপর correction/re-payment আলাদাভাবে দেখব। | Due 60→40→0; cash 5,890→5,870→5,830; inventory 60 অপরিবর্তিত; নতুন expense/AP duplication নয়। Reversal সঠিক due/cash ফিরিয়ে দেবে। | ☐ PASS ☐ FAIL |
| 003 | Dashboard, Reports, Expenses profitability ও accrual P&L একই সময়সীমায় তুলব। | Operational margin-এর basis/exclusions স্পষ্ট। এই initial fixture-এ net 890; journal-only activity যোগ হলে পার্থক্য ব্যাখ্যাত। Capital investment policy বদলানো নয়। | ☐ PASS ☐ FAIL |
| 004 | QA-PROJECT-001-এর order-linked paid invoice attribution সব report surface-এ দেখব। | Revenue 1,200, cost 250, margin 950; explicit অন্য project attribution থাকলে একবারই গণনা। | ☐ PASS ☐ FAIL |
| 005 | CRM-এ অসম্ভব query লিখব, দ্রুত query বদলাব, Enter ছাড়াই অপেক্ষা করব, clear করব। | No leads; পুরোনো delayed response ফিরে আসবে না; clear-এ তিনটি synthetic lead। | ☐ PASS ☐ FAIL |
| 006 | Clients-এ একই query, Active/Inactive/All এবং Reset পরীক্ষা করব। | Search ও status একসঙ্গে কার্যকর; clear/reset-এ সঠিক rows। | ☐ PASS ☐ FAIL |
| 007 | Cost-only client filter এবং unfiltered detail দেখব। | USD revenue 0, cost 60, profit −60; GBP preference-এর কারণে row হারাবে না। | ☐ PASS ☐ FAIL |
| 008 | পৃথক traceable adjustment +1 at6, তারপর −1; available-এর বেশি negative quantity চেষ্টা করব। | 10→11→10; value60→66→60; history/journals সঠিক; অতিরিক্ত negative rejected। | ☐ PASS ☐ FAIL |
| 009 | Casey-এর 21 Oct approved day আবার request; 24 Oct pending day overlap; adjacent day control। | Overlap rejected, balance18 অপরিবর্তিত; adjacent valid request হলে যথাযথ reservation, cancel-এ restore। | ☐ PASS ☐ FAIL |
| 010 | PAY-00001 draft payslip খুলব; approved-state wording আলাদা fixture-এ তুলব। | Draft footer approved payroll দাবি করে না। | ☐ PASS ☐ FAIL |
| 011 | Reverse payroll dates, negative allowance/withholding, numbering0, salvage>cost। | Readable field/message; “[object Object]” নয়; আগের saved data অপরিবর্তিত। | ☐ PASS ☐ FAIL |
| 012 | আলাদা QA invoice12.34 edit24.68, issue; অন্য200 invoice-এ receipts80+120,120 reversal। | Header/history/preview reload ছাড়া একমত; final paid80/due120, cash80/AR120/revenue200। | ☐ PASS ☐ FAIL |
| 013 | Existing draft47.25 রেখে financial cards, collections, receivables, P&L দেখব। | Draft recognized invoiced/receivable-এ নয়; Expenses/Capital insight-এও draft নয়। | ☐ PASS ☐ FAIL |
| 014 | Synthetic Other identifier দিয়ে নতুন invoice; পরে genuine tax-type synthetic identifier দিয়ে নতুন invoice। | Other “Tax ID” হয় না; valid tax type সঠিক; historical snapshots silently rewritten নয়। | ☐ PASS ☐ FAIL |
| 015 | Outstanding filter; cancelled INV-00003 detail; Clear। | Cancelled/draft collection list-এ নয়; due0; cancelled copy audit retention বোঝায়, sent দাবি নয়। | ☐ PASS ☐ FAIL |

Financial mutation rows ক্রমানুসারে চালালে initial totals বদলাবে। প্রতিটি step-এর delta লিখে রাখব; অন্ধভাবে initial values-এর সঙ্গে পরবর্তী state তুলব না। Opening balance, GL totals ও draft pipeline আলাদা রাখব।

## আগে blocked/partial ছিল

- ☐ HR10: Employee PDF upload → manager download → নিজের employee download; অন্য employee denied। Exact file bytes মিলবে।
- ☐ PRJ15: Project PDF upload/download; অন্য tenant এবং permission ছাড়া denied।
- ☐ SET06: Company PDF upload/download; owner/admin permission এবং tenant isolation।
- ☐ HR29: Remote/correction request-এ self-approval denied; অন্য authorized manager approve; correction 480 মিনিট persisted।
- ☐ CLI07: Search + inactive filter একসঙ্গে।
- ☐ HR22: **Policy decision pending**, test failure নয়। Half-month monthly payroll amount/proration rule ব্যবহারকারীর সিদ্ধান্ত ছাড়া বদলানো হয়নি।

## অতিরিক্ত আর্থিক নিরাপত্তা

- Dated FX: EUR60 receipt at historical1.2 must post USD72, not current1.6-এর96। Payment EUR20 at1.4 clears AP24 and records FX loss4; EUR40 at1.1 clears AP48 and records FX gain4। Reversal/re-payment একই accounting integrity রাখবে।
- Migration: open/partial/paid receipt balances অক্ষত; cancelled receipt omitted; কোনো নতুন recognition journal নয়; used subledger downgrade প্রত্যাখ্যাত।
- Foreign tenant IDs এবং read-only actor দিয়ে invoice/payment/reversal চেষ্টা করলে denied; data/audit rows অপরিবর্তিত।
- কোনো real email, real payout, tax remittance বা provider charge নয়।

## প্রমাণ কী বোঝায়

- Actual PostgreSQL + authenticated application HTTP tests: finance states, authorization, tenant isolation, accounting readback এবং real file endpoints।
- Browser tests with mocked business responses: UI refresh, search races, labels, filters। এগুলো একা আর্থিক posting প্রমাণ করে না।
- Direct PostgreSQL service tests: FX, migration, reporting, leave concurrency।
- Original 160-case report পুনরায় পুরো browser-এ চালানো হয়েছে এমন দাবি নেই। বিস্তারিত mapping: `qa-v2-coverage-traceability.md`।

Live release-এর আগে এই joint review, বাকি policy সিদ্ধান্ত এবং আলাদা deployment approval প্রয়োজন। বর্তমান নির্দেশ অনুযায়ী কোনো branch-এ push নয়।

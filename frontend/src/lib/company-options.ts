import type { SearchOption } from "@/components/searchable-select";

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" ");

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export const COUNTRY_OPTIONS: SearchOption[] = COUNTRY_CODES.map((code) => ({
  value: code,
  label: regionNames?.of(code) ? `${regionNames.of(code)} (${code})` : code,
  keywords: code,
}));

const fallbackCurrencies = [
  "AED", "AUD", "BDT", "BRL", "CAD", "CHF", "CNY", "DKK", "EUR", "GBP", "HKD", "IDR",
  "INR", "JPY", "KRW", "LKR", "MYR", "NOK", "NZD", "PHP", "PKR", "PLN", "QAR", "SAR",
  "SEK", "SGD", "THB", "TRY", "USD", "VND", "ZAR",
];

const runtimeCurrencies =
  typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : fallbackCurrencies;

const currencyNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "currency" })
    : null;

export const CURRENCY_OPTIONS: SearchOption[] = runtimeCurrencies.map((code) => ({
  value: code,
  label: currencyNames?.of(code) ? `${currencyNames.of(code)} (${code})` : code,
  keywords: code,
}));

const runtimeTimezones =
  typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["Asia/Dhaka", "Asia/Kolkata", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];

export const TIMEZONE_OPTIONS: SearchOption[] = runtimeTimezones.map((zone) => ({
  value: zone,
  label: zone.replaceAll("_", " "),
}));

const languagePairs = [
  ["en", "English"], ["bn", "Bangla"], ["ar", "Arabic"], ["zh", "Chinese"], ["cs", "Czech"],
  ["da", "Danish"], ["nl", "Dutch"], ["fi", "Finnish"], ["fr", "French"], ["de", "German"],
  ["el", "Greek"], ["he", "Hebrew"], ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Indonesian"],
  ["it", "Italian"], ["ja", "Japanese"], ["ko", "Korean"], ["ms", "Malay"], ["no", "Norwegian"],
  ["fa", "Persian"], ["pl", "Polish"], ["pt", "Portuguese"], ["ro", "Romanian"], ["ru", "Russian"],
  ["es", "Spanish"], ["sv", "Swedish"], ["ta", "Tamil"], ["th", "Thai"], ["tr", "Turkish"],
  ["uk", "Ukrainian"], ["ur", "Urdu"], ["vi", "Vietnamese"],
] as const;

export const LANGUAGE_OPTIONS: SearchOption[] = languagePairs.map(([value, label]) => ({ value, label: `${label} (${value})` }));

export const BUSINESS_TYPE_OPTIONS: SearchOption[] = [
  "Sole Proprietorship",
  "Partnership",
  "Private Limited Company",
  "Public Limited Company",
  "Limited Liability Company (LLC)",
  "Corporation",
  "Nonprofit / NGO",
  "Government / Public Sector",
  "Educational Institution",
  "Freelancer / Independent Contractor",
  "Startup",
  "Agency / Professional Services",
].map((value) => ({ value, label: value }));

export const INDUSTRY_OPTIONS: SearchOption[] = [
  "Software & IT Services", "Artificial Intelligence", "Cybersecurity", "Cloud & Infrastructure",
  "Telecommunications", "E-commerce & Retail", "Financial Services & FinTech", "Banking", "Insurance",
  "Education & EdTech", "Healthcare & HealthTech", "Transportation & Logistics", "Automotive & Mobility",
  "GPS / VTS / Fleet Management", "Manufacturing", "Construction & Real Estate", "Professional Services",
  "Marketing & Advertising", "Media & Entertainment", "Travel & Hospitality", "Food & Agriculture",
  "Energy & Utilities", "Government", "Nonprofit", "Legal Services", "Accounting & Tax", "Human Resources",
].map((value) => ({ value, label: value }));

export const COMPANY_SIZE_OPTIONS: SearchOption[] = [
  "1", "2-5", "6-10", "11-25", "26-50", "51-100", "101-250", "251-500", "501-1000", "1000+",
].map((value) => ({ value, label: `${value} employees` }));

export const IDENTIFIER_TYPE_OPTIONS: SearchOption[] = [
  { value: "company_registration", label: "Company Registration Number", keywords: "company no registration" },
  { value: "tin", label: "TIN — Tax Identification Number" },
  { value: "bin", label: "BIN — Business Identification Number" },
  { value: "vat", label: "VAT Number" },
  { value: "gst", label: "GST Number" },
  { value: "ein", label: "EIN — Employer Identification Number" },
  { value: "abn", label: "ABN — Australian Business Number" },
  { value: "acn", label: "ACN — Australian Company Number" },
  { value: "duns", label: "D‑U‑N‑S Number" },
  { value: "tax", label: "Tax Registration Number" },
  { value: "other", label: "Other / Custom" },
];
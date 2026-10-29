export type PayrollComponent = { name: string; amount: string; source_profile_id?: string; source_component_index?: number };
export type PayrollProfile = { id: string; employee_id: string; employee_code: string; employee_name: string; currency: string; pay_frequency: string; base_salary: string; effective_from: string; effective_to: string | null; is_active: boolean; default_allowances: PayrollComponent[]; default_deductions: PayrollComponent[]; notes: string | null; created_at: string };
export type PayrollPeriod = { id: string; name: string; period_start: string; period_end: string; pay_date: string; status: string; notes: string | null; created_at: string };
export type PayrollEntry = { id: string; employee_id: string; employee_code: string; employee_name: string; currency: string; base_salary: string; allowances: PayrollComponent[]; deductions: PayrollComponent[]; allowance_total: string; deduction_total: string; tax_amount: string; gross_pay: string; net_pay: string; notes: string | null; calculation_snapshot?: Record<string, unknown> | null; adjustments?: PayrollAdjustment[] };
export type PayrollAdjustment = { id?: string; reason: string; created_by_user_id?: string; created_at: string; before: Record<string, unknown>; after: Record<string, unknown> };
export type PayrollRun = { id: string; run_number: string; period_id: string; period_name: string; currency: string; status: string; employee_count: number; gross_total: string; allowance_total: string; deduction_total: string; tax_total: string; net_total: string; paid_account_id: string | null; approved_at: string | null; paid_at: string | null; created_at: string; entries: PayrollEntry[]; policy_version_id?: string | null; calculation_engine_version?: string | null; calculation_hash?: string | null; calculation_context?: Record<string, unknown> | null };
export type PayrollMeta = { employees: { id: string; employee_code: string; full_name: string }[]; accounts: { id: string; name: string; currency: string; is_active: boolean; account_type?: string }[]; currencies: string[] };
export type WithholdingMeta = { currency: string; liability_balance: string | number; accounts: { id: string; name: string; balance: string | number }[] };
export type WithholdingPayment = { id: string; account_id: string; account_name: string; payment_date: string; currency: string; amount: string; reference: string | null; notes: string | null; created_at: string };
export type PolicyMode = "manual" | "calendar_day" | "working_day";
export type ComponentTreatment = "fixed_latest" | "prorate_profile_segments";
export type PolicyConfiguration = { mode: PolicyMode; allowance_treatment: ComponentTreatment; deduction_treatment: ComponentTreatment; working_weekdays?: number[] | null; holiday_treatment?: "count_scheduled" | "exclude" | null; weekly_anchor?: string | null; biweekly_anchor?: string | null };
export type PayrollPolicyVersion = { id: string; version: number; effective_from: string; configuration: PolicyConfiguration; activation_reason: string; created_by_user_id: string; created_at: string };
export type PayrollPolicy = { as_of: string; legacy_manual: boolean; effective_policy: PayrollPolicyVersion | null; latest_version: number; scheduled_versions: PayrollPolicyVersion[] };
export type PayrollSetupIssue = { code: string; message: string; employee_id: string | null; profile_ids: string[] };
export type CalculatedEntry = Omit<PayrollEntry, "id" | "employee_code" | "employee_name" | "notes" | "adjustments"> & { salary_profile_id: string; profile_ids: string[]; calculation_snapshot: Record<string, unknown> };
export type PayrollCalculation = Pick<PayrollRun, "currency" | "employee_count" | "gross_total" | "allowance_total" | "deduction_total" | "tax_total" | "net_total"> & { engine_version: string; policy_id: string | null; policy_version: number; mode: PolicyMode; calculation_hash: string; entries: CalculatedEntry[] };
export type PayrollPreview = { ready: boolean; policy_version: number; mode: string; calculation_hash: string | null; calculation: PayrollCalculation | null; setup_issues: PayrollSetupIssue[] };
export type PayrollResources = { meta: PayrollMeta; profiles: PayrollProfile[]; periods: PayrollPeriod[]; runs: PayrollRun[]; run: PayrollRun; payments: WithholdingPayment[]; withholding: WithholdingMeta; policy: PayrollPolicy };
export type PayrollResource = keyof PayrollResources;
export const payrollRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (v: unknown): v is string => typeof v === "string";
const nullable = (v: unknown) => v === null || text(v);
export const payrollDecimal = (v: unknown): v is string => text(v) && /^-?\d+(?:\.\d+)?$/.test(v);
const legacyDecimal = (v: unknown) => payrollDecimal(v) || typeof v === "number" && Number.isFinite(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(key => text(v[key]));
const moneyFields = (v: Record<string, unknown>, keys: string[]) => keys.every(key => payrollDecimal(v[key]));
const array = (v: unknown, check: (value: unknown) => boolean) => Array.isArray(v) && v.every(check);
export const isPayrollComponent = (v: unknown): v is PayrollComponent => payrollRecord(v) && text(v.name) && payrollDecimal(v.amount);
export const isPayrollProfile = (v: unknown): v is PayrollProfile => payrollRecord(v) && strings(v,["id","employee_id","employee_code","employee_name","currency","pay_frequency","effective_from","created_at"]) && payrollDecimal(v.base_salary) && typeof v.is_active === "boolean" && nullable(v.effective_to) && nullable(v.notes) && array(v.default_allowances,isPayrollComponent) && array(v.default_deductions,isPayrollComponent);
export const isPayrollPeriod = (v: unknown): v is PayrollPeriod => payrollRecord(v) && strings(v,["id","name","period_start","period_end","pay_date","status","created_at"]) && nullable(v.notes);
const isAdjustment = (v: unknown) => payrollRecord(v) && strings(v,["reason","created_at"]) && payrollRecord(v.before) && payrollRecord(v.after);
export const isPayrollEntryFields = (v: unknown): v is Omit<PayrollEntry,"employee_id"> => payrollRecord(v) && strings(v,["id","employee_code","employee_name","currency"]) && moneyFields(v,["base_salary","allowance_total","deduction_total","tax_amount","gross_pay","net_pay"]) && array(v.allowances,isPayrollComponent) && array(v.deductions,isPayrollComponent) && nullable(v.notes) && (v.calculation_snapshot == null || payrollRecord(v.calculation_snapshot)) && (v.adjustments === undefined || array(v.adjustments,isAdjustment));
export const isPayrollEntry = (v:unknown):v is PayrollEntry => payrollRecord(v) && text(v.employee_id) && isPayrollEntryFields(v);
export const isPayrollRun = (v: unknown): v is PayrollRun => payrollRecord(v) && strings(v,["id","run_number","period_id","period_name","currency","status","created_at"]) && Number.isSafeInteger(v.employee_count) && Number(v.employee_count)>=0 && moneyFields(v,["gross_total","allowance_total","deduction_total","tax_total","net_total"]) && nullable(v.paid_account_id) && nullable(v.approved_at) && nullable(v.paid_at) && array(v.entries,isPayrollEntry) && (v.policy_version_id == null || text(v.policy_version_id)) && (v.calculation_context == null || payrollRecord(v.calculation_context));
const isPolicyConfiguration = (v: unknown) => payrollRecord(v) && ["manual","calendar_day","working_day"].includes(String(v.mode)) && ["fixed_latest","prorate_profile_segments"].includes(String(v.allowance_treatment)) && ["fixed_latest","prorate_profile_segments"].includes(String(v.deduction_treatment)) && (v.working_weekdays == null || array(v.working_weekdays,x=>Number.isInteger(x)&&Number(x)>=0&&Number(x)<=6)) && (v.holiday_treatment == null || ["count_scheduled","exclude"].includes(String(v.holiday_treatment))) && (v.weekly_anchor == null || text(v.weekly_anchor)) && (v.biweekly_anchor == null || text(v.biweekly_anchor));
export const isPayrollPolicyVersion = (v: unknown): v is PayrollPolicyVersion => payrollRecord(v) && strings(v,["id","effective_from","activation_reason","created_by_user_id","created_at"]) && Number.isSafeInteger(v.version) && Number(v.version)>0 && isPolicyConfiguration(v.configuration);
export const isPayrollPolicy = (v: unknown): v is PayrollPolicy => payrollRecord(v) && text(v.as_of) && typeof v.legacy_manual === "boolean" && v.legacy_manual===(v.effective_policy===null) && Number.isSafeInteger(v.latest_version) && Number(v.latest_version)>=0 && (v.effective_policy===null || isPayrollPolicyVersion(v.effective_policy)) && array(v.scheduled_versions,isPayrollPolicyVersion);
export const isPayrollIssue = (v: unknown): v is PayrollSetupIssue => payrollRecord(v) && strings(v,["code","message"]) && nullable(v.employee_id) && array(v.profile_ids,text);
export function isPayrollPreview(v: unknown): v is PayrollPreview {
    if (!payrollRecord(v) || typeof v.ready!=="boolean" || !Number.isSafeInteger(v.policy_version) || Number(v.policy_version)<0 || !["manual","calendar_day","working_day"].includes(String(v.mode)) || !array(v.setup_issues,isPayrollIssue)) return false;
    if (!v.ready) return v.calculation===null && v.calculation_hash===null;
    const c=v.calculation;
    return text(v.calculation_hash) && /^[a-f0-9]{64}$/.test(v.calculation_hash) && payrollRecord(c) && c.calculation_hash===v.calculation_hash && c.policy_version===v.policy_version && c.mode===v.mode && strings(c,["engine_version","currency"]) && Number.isSafeInteger(c.employee_count) && Number(c.employee_count)>=0 && moneyFields(c,["gross_total","allowance_total","deduction_total","tax_total","net_total"]) && array(c.entries,e=>payrollRecord(e) && strings(e,["employee_id","salary_profile_id","currency"]) && array(e.profile_ids,text) && moneyFields(e,["base_salary","allowance_total","deduction_total","tax_amount","gross_pay","net_pay"]) && array(e.allowances,isPayrollComponent) && array(e.deductions,isPayrollComponent) && payrollRecord(e.calculation_snapshot)) && Array.isArray(c.entries) && c.employee_count===c.entries.length;
}
export function isPayrollResource<K extends PayrollResource>(key: K,v: unknown): v is PayrollResources[K] {
    switch(key) {
        case "profiles": return array(v,isPayrollProfile);
        case "periods": return array(v,isPayrollPeriod);
        case "runs": return array(v,isPayrollRun);
        case "run": return isPayrollRun(v);
        case "policy": return isPayrollPolicy(v);
        case "meta": return payrollRecord(v) && array(v.employees,e=>payrollRecord(e)&&strings(e,["id","employee_code","full_name"])) && array(v.accounts,a=>payrollRecord(a)&&strings(a,["id","name","currency"])&&typeof a.is_active==="boolean") && array(v.currencies,text);
        case "withholding": return payrollRecord(v) && text(v.currency) && legacyDecimal(v.liability_balance) && array(v.accounts,a=>payrollRecord(a)&&strings(a,["id","name"])&&legacyDecimal(a.balance));
        case "payments": return array(v,p=>payrollRecord(p)&&strings(p,["id","account_id","account_name","payment_date","currency","created_at"])&&payrollDecimal(p.amount)&&nullable(p.reference)&&nullable(p.notes));
    }
    return false;
}
/** Format server decimals without binary floating-point conversion or recalculation. */
export function payrollMoney(value: string | number, currency: string) {
    const raw=String(value);
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return `${currency} —`;
    const [integer,fraction=""]=raw.split(".");
    const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,",");
    return `${currency} ${grouped}.${fraction.padEnd(2,"0")}`;
}
export function payrollLabel(value: string) { return value.replaceAll("_"," ").replace(/^./,s=>s.toUpperCase()); }
export const POLICY_MODE_LABELS: Record<PolicyMode,string> = { manual:"Manual · full profile",calendar_day:"Calendar-day proration",working_day:"Working-day proration" };
export const PAYROLL_TABS = ["runs","profiles","periods","withholdings"] as const;
export type PayrollTab = typeof PAYROLL_TABS[number];
export function companyPayrollToday(timezone: string) {
    try { const parts=new Intl.DateTimeFormat("en",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); return ["year","month","day"].map(key=>parts.find(p=>p.type===key)?.value??"").join("-"); } catch { return ""; }
}
/** Same existing payslip deductions + tax display, without binary floating-point loss. */
export function payrollDisplaySum(left:string,right:string):string|null {
    if(!payrollDecimal(left)||!payrollDecimal(right))return null;
    const parse=(value:string)=>{const [whole,fraction=""]=value.replace(/^-/ ,"").split(".");return {negative:value.startsWith("-"),whole,fraction};};
    const a=parse(left),b=parse(right),scale=Math.max(2,a.fraction.length,b.fraction.length);
    const units=(value:ReturnType<typeof parse>)=>BigInt(value.whole+value.fraction.padEnd(scale,"0"))*(value.negative?-BigInt(1):BigInt(1));
    const sum=units(a)+units(b),digits=(sum<BigInt(0)?-sum:sum).toString().padStart(scale+1,"0");
    return `${sum<BigInt(0)?"-":""}${digits.slice(0,-scale)}.${digits.slice(-scale)}`;
}
export const payrollPositive=(value:string)=>payrollDecimal(value)&&!value.startsWith("-")&&/[1-9]/.test(value);

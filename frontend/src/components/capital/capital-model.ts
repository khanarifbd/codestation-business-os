export type Account = { id:string; name:string; currency:string; account_type:string; balance:string };
export type Project = { id:string; project_number:string; name:string; currency:string; contract_value:string; status:string };
export type Meta = { accounts:Account[]; projects:Project[] };
export type Dashboard = { rows:{currency:string;company_committed:string;company_funded:string;project_committed:string;project_funded:string;our_investments:string;investment_income:string;investor_profit_paid:string}[];active_company_investors:number;active_project_investors:number;active_investments:number };
export type CompanyInvestor = { id:string;investor_name:string;investor_email?:string;investor_type:string;instrument:string;currency:string;committed_amount:string;funded_amount:string;outstanding_commitment:string;ownership_percent?:string;valuation_amount?:string;agreement_date:string;status:string;agreement_reference?:string;notes?:string };
export type ProjectInvestor = { id:string;project_id:string;project_name?:string;investor_name:string;investor_email?:string;currency:string;committed_amount:string;funded_amount:string;outstanding_commitment:string;investment_date:string;share_type:string;share_value:string;status:string;agreement_reference?:string;notes?:string };
export type Investment = { id:string;investee_name:string;investment_type:string;currency:string;invested_amount:string;carrying_value:string;ownership_percent?:string;investment_date:string;expected_exit_date?:string;status:string;reference?:string;notes?:string };
export type OwnerEquity = { id:string;transaction_type:"contribution"|"drawing";account_id:string;account_name:string;transaction_date:string;currency:string;amount:string;reference?:string|null;notes?:string|null;created_at:string };
export type Tab = "overview"|"owner"|"company"|"project"|"ours";

export type Pnl={currency:string;investment_income:string;loan_interest:string;investor_profit_share:string;net_capital_pnl_impact:string};
export type Investor={investor_id:string;investor_name:string;share_type:string;share_value:string;invested_amount:string;principal_returned:string;principal_remaining:string;profit_entitlement:string;profit_paid:string;profit_remaining:string;status:string};
export type Settlement={project_id:string;project_number:string;project_name:string;currency:string;status:string;revenue:string;direct_cost:string;project_profit:string;total_investor_profit_entitlement:string;total_investor_profit_paid:string;company_retained_profit:string;investors:Investor[]};
export type Insights={date_from:string;date_to:string;overdue_loans:number;capital_pnl:Pnl[];project_settlements:Settlement[]};

import { accountFormat, accountOpening, accountSum } from "@/components/accounting-accounts/account-money";
export const capitalMoney = (value: string | number, currency = "") => accountFormat(value, currency).trim();
export const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const text = (x: unknown): x is string => typeof x === "string" && Boolean(x.trim());
const code = (x: unknown) => typeof x === "string" && /^[A-Z]{3}$/.test(x);
// A numeric response above this conservative bound cannot reliably retain every cent.
// Exact Decimal strings remain supported across the full existing 18,2 range.
const decimal = (x: unknown) => (typeof x === "string" || typeof x === "number" && Number.isFinite(x) && Math.abs(x)<2**45) && /^[+-]?\d+(?:\.\d+)?$/.test(String(x));
const has = (x: unknown, strings: string[], amounts: string[]) => record(x) && strings.every(k => text(x[k])) && (!strings.includes("currency")||code(x.currency)) && amounts.every(k => decimal(x[k]));
const list = (x: unknown, check: (row: unknown) => boolean) => Array.isArray(x) && x.every(check);
export function isCapitalMeta(x: unknown): x is Meta { return record(x) && list(x.accounts, r => has(r,["id","name","currency","account_type"],["balance"])) && list(x.projects,r=>has(r,["id","project_number","name","currency","status"],["contract_value"])); }
export function isCapitalDashboard(x: unknown): x is Dashboard { return record(x) && list(x.rows,r=>has(r,["currency"],["company_committed","company_funded","project_committed","project_funded","our_investments","investment_income","investor_profit_paid"])) && ["active_company_investors","active_project_investors","active_investments"].every(k=>Number.isSafeInteger(x[k]) && Number(x[k])>=0); }
export function isCapitalRows(x: unknown, tab: Tab): boolean {
 const fields = tab === "owner" ? [["id","transaction_type","account_id","account_name","transaction_date","currency"],["amount"]] : tab === "company" ? [["id","investor_name","investor_type","instrument","currency","agreement_date","status"],["committed_amount","funded_amount","outstanding_commitment"]] : tab === "project" ? [["id","project_id","investor_name","currency","investment_date","share_type","status"],["committed_amount","funded_amount","outstanding_commitment","share_value"]] : [["id","investee_name","investment_type","currency","investment_date","status"],["invested_amount","carrying_value"]];
 return list(x,r=>has(r,fields[0],fields[1]));
}
export function isCapitalInsights(x: unknown): x is Insights { return record(x) && text(x.date_from) && text(x.date_to) && Number.isSafeInteger(x.overdue_loans) && list(x.capital_pnl,r=>has(r,["currency"],["investment_income","loan_interest","investor_profit_share","net_capital_pnl_impact"])) && list(x.project_settlements,r=>has(r,["project_id","project_number","project_name","currency","status"],["revenue","direct_cost","project_profit","total_investor_profit_entitlement","total_investor_profit_paid","company_retained_profit"]) && record(r) && list(r.investors,i=>has(i,["investor_id","investor_name","share_type","status"],["share_value","invested_amount","principal_returned","principal_remaining","profit_entitlement","profit_paid","profit_remaining"]))); }
/** Validate exact input scale before calling the shared formatter/18,2 limit helper; no new rounding policy. */
export function capitalDecimal(value: unknown, places = 2, whole = 16): string {
 if(typeof value !== "string" || value.length>120) throw new Error("Enter an exact decimal amount.");
 const raw=value.trim().replace(/^([+-]?)\./, "$10."), match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
 if(!match)throw new Error("Enter a non-negative decimal amount.");
 const exponent=Number(match[4]||0)-(match[3]?.length||0)+places;
 if(!Number.isInteger(exponent)||Math.abs(exponent)>120)throw new Error("Decimal exponent is outside the supported range.");
 const coefficient=BigInt(match[2]+(match[3]||"")),factor=BigInt(10)**BigInt(Math.abs(exponent));
 if(match[1]==="-"&&coefficient!==BigInt(0)||exponent<0&&coefficient%factor!==BigInt(0))throw new Error(`Use a non-negative amount with at most ${places} decimal places.`);
 const units=exponent>=0?coefficient*factor:coefficient/factor,scale=BigInt(10)**BigInt(places);
 if(units>=BigInt(10)**BigInt(whole+places))throw new Error(`Use at most ${whole} whole digits and ${places} decimal places.`);
 const exact=`${units/scale}.${String(units%scale).padStart(places,"0")}`;
 return places===2 ? accountOpening(exact,false) : exact;
}

export function capitalSum(left: unknown,right: unknown): string { return capitalDecimal(accountSum([capitalDecimal(left),capitalDecimal(right)])); }
const moneyKeys=["amount","committed_amount","invested_amount","valuation_amount","cash_amount","principal_return_amount","profit_share_amount","income_amount"];
export function capitalPayload(payload: Record<string,unknown>): Record<string,unknown> {
 const next={...payload};
 if(next.return_type!==undefined)next.cash_amount=capitalSum(next.principal_return_amount,next.income_amount);
 for(const key of moneyKeys) if(next[key]!==undefined && next[key]!==null) next[key]=capitalDecimal(next[key]);
 if(next.ownership_percent!==undefined && next.ownership_percent!==null){const exact=capitalDecimal(next.ownership_percent,4,5);if(Number(exact)>100)throw new Error("Ownership must not exceed 100%.");next.ownership_percent=exact;}
 if(next.share_value!==undefined)next.share_value=capitalDecimal(next.share_value,4,8);
 if(next.currency!==undefined){const currency=String(next.currency).trim().toUpperCase();if(!code(currency))throw new Error("Enter a three-letter currency code.");next.currency=currency;}
 for(const [key,value]of Object.entries(next)) if((key.endsWith("_date") || key==="expected_exit_date") && value!==null && value!==undefined){if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || !Number.isFinite(Date.parse(value+"T00:00:00Z")) || new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)throw new Error("Enter a valid calendar date.");}
 if(next.profit_share_amount!==undefined)capitalSum(next.principal_return_amount,next.profit_share_amount);
 return next;
}

/** Validate only the response contract actually returned by each existing action. */
export function isCapitalReceipt(value:unknown,path:string,payload:Record<string,unknown>):value is Record<string,unknown>&{id:string}{
 if(!record(value)||!text(value.id))return false;
 const [kind,id,action]=path.split("/");
 if(kind==="owner-equity")return isCapitalRows([value],"owner")&&value.account_id===payload.account_id&&value.transaction_type===payload.transaction_type&&value.transaction_date===payload.transaction_date&&capitalMoney(String(value.amount))===capitalMoney(String(payload.amount));
 if(action==="payouts")return text(value.status)&&(kind!=="project-investors"||value.investor_id===id&&decimal(value.principal_return_amount)&&decimal(value.profit_share_amount));
 if(action==="returns")return text(value.status)&&["cash_amount","income_amount","carrying_value"].every(k=>decimal(value[k]))&&capitalMoney(String(value.cash_amount))===capitalMoney(String(payload.cash_amount));
 const tab=kind==="company-investors"?"company":kind==="project-investors"?"project":"ours";
 return isCapitalRows([value],tab)&&(!id||value.id===id)&&(!payload.currency||value.currency===payload.currency)&&(!payload.project_id||value.project_id===payload.project_id);
}

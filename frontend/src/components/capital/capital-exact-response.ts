/** Additive HTTP companions: retain legacy compatibility, never invent missing precision. */
export const CAPITAL_DECIMAL_FIELDS = [
  "amount",
  "annual_interest_rate",
  "balance",
  "carrying_value",
  "cash_amount",
  "committed_amount",
  "company_committed",
  "company_funded",
  "company_retained_profit",
  "contract_value",
  "direct_cost",
  "funded_amount",
  "income_amount",
  "interest_amount",
  "invested_amount",
  "investment_income",
  "investor_profit_paid",
  "investor_profit_share",
  "loan_interest",
  "net_capital_pnl_impact",
  "our_investments",
  "outstanding_capital",
  "outstanding_commitment",
  "outstanding_principal",
  "ownership_percent",
  "principal_amount",
  "principal_remaining",
  "principal_return_amount",
  "principal_returned",
  "profit_entitlement",
  "profit_paid",
  "profit_remaining",
  "profit_share_amount",
  "project_committed",
  "project_funded",
  "project_profit",
  "revenue",
  "share_value",
  "total_investor_profit_entitlement",
  "total_investor_profit_paid",
  "valuation_amount",
] as const;
const fields=new Set<string>(CAPITAL_DECIMAL_FIELDS);
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
function exact(value:unknown):value is string{return typeof value==="string"&&value.length<=120&&/^-?\d+(?:\.\d+)?$/.test(value);}
function equivalent(left:string,right:string):boolean{
 const ratio=(value:string)=>{const [integer,fraction=""]=value.split(".");return [BigInt(integer+fraction),BigInt(10)**BigInt(fraction.length)] as const;};
 const [a,b]=ratio(left),[c,d]=ratio(right);return a*d===c*b;
}
/** Decoder copies the response; companions stay visible for diagnostics/contracts. */
export function decodeCapitalResponse(value:unknown):unknown{
 if(Array.isArray(value))return value.map(decodeCapitalResponse);
 if(!object(value))return value;
 const next:Record<string,unknown>=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decodeCapitalResponse(item)]));
 for(const companion of Object.keys(value)){
  if(!companion.endsWith("_exact"))continue;
  const field=companion.slice(0,-6);if(!fields.has(field))continue;
  if(!Object.hasOwn(value,field))throw new Error("Capital exact response is missing its matching original field.");
  const original=value[field],precise=value[companion];
  if(original===null&&precise===null){next[field]=null;continue;}
  if(!exact(precise))throw new Error("Capital exact amount could not be verified. Do not use an approximate fallback.");
  const matches=typeof original==="number"&&Number.isFinite(original)&&Number.isFinite(Number(precise))&&Number(precise)===original||exact(original)&&equivalent(original,precise);
  if(!matches)throw new Error("Capital exact and original amounts do not match. The response is unverified.");
  next[field]=precise;
 }
 return next;
}

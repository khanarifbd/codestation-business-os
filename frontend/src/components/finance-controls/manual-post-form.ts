import type { RecurringPostPayload,RecurringPostTarget } from "./recurring-post-operation";
import { controlDate } from "./control-model";
/** Validate the existing six UI fields without changing their strings/nulls or adding API fields. */
export function manualPostFormError(value:RecurringPostPayload,target:RecurringPostTarget,profitabilityCurrency:string|null):string|null{
 if(value.expense_date!==null&&!controlDate(value.expense_date))return "Enter a valid expense date or leave it blank to use the saved due date.";
 for(const key of ["expense_amount","account_amount","profitability_amount"] as const){const amount=value[key];if(amount!==null&&(typeof amount!=="string"||!/^\d+(?:\.\d+)?$/.test(amount)||!/[1-9]/.test(amount)))return "Enter positive decimal amounts, without separators or exponent notation.";}
 if(target.account_currency!==target.expense_currency&&value.account_amount===null)return "Enter the actual deduction in the payment account currency.";
 if(profitabilityCurrency&&profitabilityCurrency!==target.expense_currency&&value.profitability_amount===null)return "Enter the profitability amount in the verified client or project currency.";
 if(value.reference!==null&&(typeof value.reference!=="string"||value.reference.length>180))return "Keep the reference within 180 characters.";
 if(value.notes!==null&&typeof value.notes!=="string")return "Enter text notes or leave them blank.";
 return null;
}

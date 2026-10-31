/** Personal details/photo only. Sensitive sign-in operations keep their separate
 * existing auth/step-up protocol; this does not change their classification. */
const text=(value:unknown):value is string=>typeof value==="string"&&Boolean(value.trim())&&!["null","undefined","[object object]","unexpected upstream response"].includes(value.trim().toLowerCase());
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
export function verifiedProfileInputRejection(body:unknown):boolean {
 if(!record(body))return false;if(text(body.detail))return true;
 return Array.isArray(body.detail)&&body.detail.length>0&&body.detail.every(row=>record(row)&&text(row.msg)&&text(row.type)&&Array.isArray(row.loc)&&row.loc.length>0&&row.loc.every(part=>text(part)||typeof part==="number"&&Number.isSafeInteger(part)&&part>=0));
}

const assert=require('node:assert/strict');
const changes=require('./reviewed-quotation-decimals.json');
const accessChanges=require('./reviewed-quotation-access.json');
const responseChanges=require('./reviewed-quotation-status-response.json');
function beforeResponse(path,source){for(const change of responseChanges[path]||[]){assert.equal(source.split(change.after).length-1,1,`Exact reviewed response hunk missing/duplicated: ${path}`);source=source.replace(change.after,change.before);}return source;}
function beforeAccess(path,source){for(const change of accessChanges[path]||[]){assert.equal(source.split(change.after).length-1,1,`Exact reviewed access hunk missing/duplicated: ${path}`);source=source.replace(change.after,change.before);}return source;}
function beforeDecimals(path,source){
 for(const change of changes[path]||[]){
   assert.equal(source.split(change.after).length-1,1,`Exact reviewed decimal hunk missing/duplicated: ${path}`);
   source=source.replace(change.after,change.before);
 }
 return source;
}
function beforeReviewedQuotationDecimals(path,source){return beforeDecimals(path,beforeAccess(path,beforeResponse(path,source)));}
module.exports={beforeReviewedQuotationDecimals,changes,accessChanges,beforeAccess,beforeDecimals,responseChanges,beforeResponse};

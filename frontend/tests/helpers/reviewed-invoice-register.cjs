const assert=require('node:assert/strict');
const edits=require('./reviewed-invoice-register.json');
function beforeReviewedInvoiceRegister(file,source){for(const hunk of edits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed invoice register seam');source=source.replace(hunk.after,hunk.before);}return source;}
module.exports={beforeReviewedInvoiceRegister};

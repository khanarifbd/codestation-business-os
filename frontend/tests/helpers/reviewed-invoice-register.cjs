const assert=require('node:assert/strict');
const shellEdits=require('./reviewed-finance-shell-register.json');
const navigationEdits=require('./reviewed-invoice-navigation-register.json');
const edits=require('./reviewed-invoice-register.json');
const pagingEdits=require('./reviewed-invoice-register-paging.json');
const clientIntentEdits=require('./reviewed-invoice-client-intent.json');
function beforeReviewedInvoiceRegister(file,source){for(const hunk of shellEdits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed Finance shell seam');source=source.replace(hunk.after,hunk.before);}for(const hunk of navigationEdits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed Finance navigation seam');source=source.replace(hunk.after,hunk.before);}for(const hunk of pagingEdits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed invoice paging seam');source=source.replace(hunk.after,hunk.before);}for(const hunk of clientIntentEdits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed client intent seam');source=source.replace(hunk.after,hunk.before);}for(const hunk of edits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed invoice register seam');source=source.replace(hunk.after,hunk.before);}return source;}
module.exports={beforeReviewedInvoiceRegister};

const assert=require('node:assert/strict');
const navigationEdits=require('./reviewed-invoice-navigation-boundaries.json');
const edits=require('./reviewed-invoice-boundaries.json');
const proxyEdits=require('./reviewed-invoice-proxy.json');
function beforeReviewedInvoiceBoundaries(file,source){for(const hunk of navigationEdits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed Finance navigation seam');source=source.replace(hunk.after,hunk.before);}for(const hunk of proxyEdits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed invoice proxy seam');source=source.replace(hunk.after,hunk.before);}for(const hunk of edits[file]??[]){assert.equal(source.split(hunk.after).length,2,'Exact reviewed invoice boundary seam');source=source.replace(hunk.after,hunk.before);}return source;}
module.exports={beforeReviewedInvoiceBoundaries};

const assert=require('node:assert/strict');
const changes=require('./reviewed-orders-final.json');
const safety=require('./reviewed-orders-commercial-safety.json');
const restore=(hunks,file,source,label)=>{
 for(const [before,after] of hunks[file]??[]){assert.ok(after.length);assert.equal(source.split(after).length-1,1,`${label}: ${file}`);source=source.replace(after,before);}
 return source;
};
exports.restoreOrdersCommercialSafety=(file,source)=>restore(safety,file,source,'exact reviewed commercial safety hunk');
exports.restoreOrdersBeforeSafety=(file,source)=>restore(changes,file,source,'exact reviewed Orders hunk');
exports.restoreOrdersFinal=(file,source)=>exports.restoreOrdersBeforeSafety(file,exports.restoreOrdersCommercialSafety(file,source));

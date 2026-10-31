const assert=require('node:assert/strict');
exports.restore=(file,source)=>{for(const {before,after}of require('./reviewed-provider-child-lifecycle.json')[file]){assert.equal(source.split(after).length,2,'exact reviewed provider child lifecycle seam');source=source.replace(after,before);}return source;};

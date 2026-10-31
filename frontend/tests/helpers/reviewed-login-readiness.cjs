const assert = require('node:assert/strict');
const hunks = require('../fixtures/login-readiness-reviewed-hunks.json');
function restoreLoginReadiness(source) {
 for(const {before,after} of hunks){assert.equal(source.split(after).length-1,1,'one exact reviewed login readiness hunk');source=source.replace(after,before);}
 return source;
}
module.exports={restoreLoginReadiness};

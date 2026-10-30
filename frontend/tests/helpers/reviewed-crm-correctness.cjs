/** Exact scoped candidate contracts; behavior regressions are independently executed in crm-correctness.test.cjs. */
const crypto=require('node:crypto');
const hashes=require('./reviewed-crm-correctness.json');
function checkCrmContract(name,source){if(crypto.createHash('sha256').update(source).digest('hex')!==hashes[name])throw Error(`Unreviewed CRM contract: ${name}`);return true;}
module.exports={checkCrmContract};

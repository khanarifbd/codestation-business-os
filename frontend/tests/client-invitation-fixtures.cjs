/* Clearly synthetic public invitation inputs only; never real tokens, identities or passwords. */
const tokenA='synthetic-invitation-token-alpha-only',tokenB='synthetic-invitation-token-beta-only';
const password='Synthetic-test-password-not-real';
const preview={company_name:'Synthetic Northstar',client_name:'Synthetic Client Alpha',email:'invite-test@example.invalid',full_name:'Synthetic Reviewer',expires_at:'2099-10-27T12:00:00Z',existing_user:false,requires_password:false};
const result={ok:true,company_name:preview.company_name,client_name:preview.client_name};
const clone=v=>JSON.parse(JSON.stringify(v));
const ok=(body,status=200)=>({ok:true,status,json:async()=>clone(body)});
const failure=(status,detail='Synthetic invitation rejection')=>({ok:false,status,json:async()=>({detail})});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
module.exports={tokenA,tokenB,password,preview,result,clone,ok,failure,deferred};

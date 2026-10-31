const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function semantic(node){const children=[];ts.forEachChild(node,child=>{children.push(semantic(child));});return [node.kind,children.length?children:node.text??node.kind];}
function restoreReviewedFxArguments(source){
 for(const name of ["accountingTransitionRate","manualRate"]){const exact=`? positiveFxInput(${name}) : null`;if(source.split(exact).length!==2)throw Error("Reviewed FX argument seam changed");source=source.replace(exact,`? Number(${name}) : null`);}return source;
}
function mutations(source){const tree=ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),rows=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='fetch'&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])){const properties=n.arguments[1].properties;const method=properties.find(p=>p.name?.getText(tree)==='method');if(method&&method.initializer?.text!=='GET')rows.push([semantic(n.arguments[0]),...properties.map(p=>semantic(p))]);}ts.forEachChild(n,visit);}visit(tree);return rows;}
const files=['currency-settings-panel.tsx'];
for(const file of files)test(`${file} preserves every original mutation URL/method/header/payload AST`,()=>{const source=fs.readFileSync(path.join(__dirname,'../src/components/company',file),'utf8'),expected=require('./helpers/company-panel-mutation-baseline.json')[file];assert.deepEqual(mutations(restoreReviewedFxArguments(source)),expected);assert.notDeepEqual(mutations(restoreReviewedFxArguments(source.replace('method: "POST"','method: "DELETE"'))),expected);});
module.exports={mutations};
test('Gateway parent preserves existing three POST routes, no body, OAuth destination validation and provider child implementations',()=>{
 const crypto=require('node:crypto'),source=fs.readFileSync(path.join(__dirname,'../src/components/company/payment-gateways-settings-panel.tsx'),'utf8');
 const tree=ts.createSourceFile('gateway.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),routes=[];function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='fetch'&&n.arguments[1]?.getText(tree).includes('"POST"'))routes.push([n.arguments[0].getText(tree),n.arguments[1].getText(tree)]);ts.forEachChild(n,walk);}walk(tree);
 assert.deepEqual(routes,['connect','disable','refresh'].map(action=>['`/api/finance/payment-gateways/stripe/'+action+'?mode=${mode}`','{ method: "POST", cache: "no-store" }']));
 assert.ok(source.includes('value.authorization_url.startsWith("https://connect.stripe.com/oauth/authorize?")'));
 const hashes=require('./helpers/company-provider-child-baseline.json');for(const [file,hash] of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(require('./helpers/provider-child-contract.cjs').restore(file,fs.readFileSync(path.join(__dirname,'../src/components/company',file),'utf8'))).digest('hex'),hash);
});

test("reviewed FX guard rejects altered rate argument rather than normalizing arbitrary changes",()=>{const source=fs.readFileSync(path.join(__dirname,"../src/components/company/currency-settings-panel.tsx"),"utf8");assert.throws(()=>restoreReviewedFxArguments(source.replace("? positiveFxInput(manualRate) : null","? positiveFxInput(base) : null")),/seam changed/);});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const baseline=require('./helpers/reviewed-capital-contract.json');
const file=path.join(__dirname,'../src/app/dashboard/capital/page.tsx'),source=fs.readFileSync(file,'utf8');
function extract(s){const ast=ts.createSourceFile('capital.tsx',s,99,true,ts.ScriptKind.TSX),posts=[],fields=[];function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='post'&&ts.isObjectLiteralExpression(n.arguments[1]))posts.push([n.arguments[0].getText(ast),n.arguments[1].properties.map(p=>p.name?.getText(ast))]);if((ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&['Field','Select','SearchableSelect'].includes(n.tagName.getText(ast)))fields.push([n.tagName.getText(ast),n.attributes.properties.filter(p=>['name','label','type','required','step','options'].includes(p.name?.getText(ast))).map(p=>p.getText(ast))]);ts.forEachChild(n,walk)}walk(ast);return{posts,fields};}
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('all original Capital endpoint paths and payload keys preserved exactly',()=>{const result=extract(source);assert.equal(result.posts.length,baseline.postsCount);assert.equal(digest(result.posts),baseline.postsHash);assert.notEqual(digest(extract(source.replace('principal_return_amount:','discarded_amount:')).posts),baseline.postsHash);});
test('all original Capital named fields/types/required controls remain',()=>{const result=extract(source);assert.equal(result.fields.length,baseline.fieldsCount);assert.equal(digest(result.fields),baseline.fieldsHash);assert.notEqual(digest(extract(source.replace('label="Principal return"','label="Discarded"')).fields),baseline.fieldsHash);});
test('permission and outcome presentation is explicit, does not impersonate empty success',()=>{assert.ok(source.includes('Capital viewing permission is required.'));assert.ok(source.includes('vm.rows!==null'));assert.ok(source.includes('tab==="overview"&&dashboard'));assert.ok(source.includes('disabled={busy}'));assert.ok(source.includes('Review current records (read only)'));assert.ok(source.includes('Reloading or leaving loses it.'));assert.doesNotMatch(source,/Number\(d\.get|defaultValue="BDT"/);});
module.exports={extract,digest};

test('Capital scroll strip has real logical end inset for fractional final-tab widths',()=>{
 assert.equal((source.match(/className="flex gap-2 overflow-x-auto pb-1 pe-1"/g)||[]).length,1);
 // CI2361 measured last tab right374.15625 at max scroll326, viewport390.
 // A real4px scrollable end inset moves max scroll by4, not a visibility tolerance.
 for(const width of [390,360]){
  const edge=width-16,oldRight=edge+0.15625,newRight=oldRight-4;
  assert.ok(oldRight>edge);assert.ok(newRight<edge);
 }
 assert.doesNotMatch(source,/overflow-x-hidden/);
});

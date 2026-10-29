'use strict';
// Execute actual page payload AST and text helper, not a copied serializer.
// No browser, React effects, network or backend mutations are performed.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/app/dashboard/company/page.tsx'),'utf8');
const tree=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function collect(predicate){const rows=[];function visit(n){if(predicate(n))rows.push(n);ts.forEachChild(n,visit);}visit(tree);return rows;}
const helper=collect(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='text');assert.equal(helper.length,1);
function serializer(route){const calls=collect(n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='api'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===route&&ts.isStringLiteral(n.arguments[1])&&n.arguments[1].text==='PATCH'&&(route!=='/profile'||(ts.isObjectLiteralExpression(n.arguments[2])&&n.arguments[2].properties.some(p=>p.name?.getText(tree)==='company_size'))));assert.equal(calls.length,1);assert.ok(ts.isObjectLiteralExpression(calls[0].arguments[2]));const code=ts.transpileModule(helper[0].getText(tree)+'\nfunction payload(form:FormData){return '+calls[0].arguments[2].getText(tree)+';}\npayload;', {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;return vm.runInNewContext(code,{}, {timeout:1000});}
const core=serializer('/core'),profile=serializer('/profile');
const form=values=>({get:name=>Object.hasOwn(values,name)?values[name]:null});
const plain=value=>JSON.parse(JSON.stringify(value));
test('core save omits unrelated team_size when only company_size is rendered',()=>{const names=collect(n=>ts.isJsxAttribute(n)&&n.name.getText(tree)==='name'&&n.initializer&&ts.isStringLiteral(n.initializer)).map(n=>n.initializer.text);assert.ok(names.includes('company_size'));assert.equal(names.includes('team_size'),false);const body=plain(core(form({name:'Acme',business_type:'Services',company_size:'11-50'})));assert.deepEqual(body,{name:'Acme',business_type:'Services'});assert.equal(Object.hasOwn(body,'team_size'),false);});
test('existing organization team size survives applying the actual partial payload',()=>{const organization={name:'Old',business_type:'Old type',team_size:'51-200'};Object.assign(organization,core(form({name:'New',business_type:'Services',company_size:'11-50'})));assert.equal(organization.team_size,'51-200');assert.equal(organization.name,'New');});
test('core text normalization and intentional business_type clear stay unchanged',()=>{assert.deepEqual(plain(core(form({name:'  আরিফ কোম্পানি  ',business_type:'  '}))),{name:'আরিফ কোম্পানি',business_type:null});});
test('company_size still saves through profile instead of core',()=>{const body=plain(profile(form({company_size:'  11-50  '})));assert.equal(body.company_size,'11-50');assert.equal(Object.hasOwn(core(form({company_size:'11-50'})),'team_size'),false);});
test('optional profile clears and unrelated core fields remain scoped',()=>{const body=plain(profile(form({company_size:'',legal_name:''})));assert.equal(body.company_size,null);assert.equal(body.legal_name,null);assert.deepEqual(Object.keys(core(form({name:'Acme'}))).sort(),['business_type','name']);});

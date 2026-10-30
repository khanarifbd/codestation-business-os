'use strict';
/** Pure display functions only: no API requests, financial operations or browser session. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(relative){const filename=path.join(root,relative);if(cache.has(filename))return cache.get(filename).exports;const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;cache.set(filename,mod);mod.require=id=>id.startsWith('@/')?load('src/'+id.slice(2)+'.ts'):require(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports;}
const formatters=[['project detail',load('src/components/projects/project-model.ts').money],['project list',load('src/components/projects/project-list-model.ts').projectMoney]];
function expected(currency,whole,fraction,negativeZero=false){const parts=new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).formatToParts(negativeZero?-0:BigInt(whole));const localizedFraction=new Intl.NumberFormat(undefined,{useGrouping:false,minimumIntegerDigits:2,maximumFractionDigits:0}).format(fraction);return `${currency} ${parts.map(part=>part.type==='fraction'?localizedFraction:part.value).join('')}`;}
for(const [name,money]of formatters){
 test(`${name}: max Numeric(16,2) string retains every cent`,()=>{assert.equal(money('99999999999999.99','USD'),expected('USD','99999999999999',99));assert.notEqual(money('99999999999999.99','USD'),`USD ${Number('99999999999999.99').toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);});
 test(`${name}: signed large amounts and negative sub-unit cents retain sign/precision`,()=>{assert.equal(money('-99999999999999.99','GBP'),expected('GBP','-99999999999999',99));assert.equal(money('-0.01','USD'),expected('USD','0',1,true));assert.equal(money('-12.30','USD'),expected('USD','-12',30));});
 test(`${name}: ordinary numeric and decimal-string values preserve currency prefix and two places`,()=>{for(const currency of ['USD','GBP','BDT']){assert.equal(money('12500.50',currency),expected(currency,'12500',50));assert.equal(money(1234.5,currency),expected(currency,'1234',50));assert.equal(money('42',currency),expected(currency,'42',0));}});
 test(`${name}: zero/nullish runtime values remain zero without inventing a currency`,()=>{for(const value of [0,-0,'0','0.00',null,undefined])assert.equal(money(value,'USD'),expected('USD','0',0));assert.equal(money('12.30',''),expected('','12',30));});
 test(`${name}: invalid values are explicitly unavailable, not NaN/Infinity or zero`,()=>{for(const value of ['', ' ', 'not-money', 'NaN','Infinity',Infinity,-Infinity,NaN,'1e999'])assert.equal(money(value,'GBP'),'GBP —');});
 test(`${name}: shared exact formatter rounds display only, input remains untouched`,()=>{const value='1.005';assert.equal(money(value,'USD'),expected('USD','1',1));assert.equal(value,'1.005');assert.equal(money('-1.005','USD'),expected('USD','-1',1));});
}

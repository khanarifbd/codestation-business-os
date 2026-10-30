const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {beforeReviewedQuotationDecimals:before,changes,accessChanges,beforeAccess,beforeDecimals,responseChanges,beforeResponse}=require('./helpers/reviewed-quotation-decimals.cjs');
for(const [file,hunks] of Object.entries(changes))test(`Quotation exact decimal review rejects changed or duplicated hunks: ${file}`,()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../',file),'utf8');
 assert.doesNotThrow(()=>before(file,source));
 const normalized=beforeAccess(file,beforeResponse(file,source));
 for(const hunk of hunks){assert.throws(()=>beforeDecimals(file,normalized.replace(hunk.after,hunk.after.replace(/\S/,'!'))));assert.throws(()=>beforeDecimals(file,normalized+hunk.after));}
});

for(const [file,hunks] of Object.entries(accessChanges))test(`Quotation access review rejects changed or duplicated hunks: ${file}`,()=>{const source=beforeResponse(file,fs.readFileSync(path.resolve(__dirname,'../',file),'utf8'));for(const hunk of hunks){assert.throws(()=>beforeAccess(file,source.replace(hunk.after,hunk.after.replace(/\S/,'!'))));assert.throws(()=>beforeAccess(file,source+hunk.after));}});
test('printed quantities retain all four decimal places and exact large integer grouping',()=>{
 const ts=require('typescript');const source=fs.readFileSync(path.resolve(__dirname,'../src/app/print/quotations/[quotationId]/page.tsx'),'utf8');const ast=ts.createSourceFile('print.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='quantityText');assert.ok(fn);const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;const quantity=new Function(code+';return quantityText;')();
 assert.equal(quantity('1.2345'),'1.2345');assert.equal(quantity('9999999999.9999'),'9,999,999,999.9999');assert.equal(quantity('1.0001'),'1.0001');assert.equal(quantity('2.0000'),'2');assert.match(source,/\{quantityText\(item.quantity\)\}/);
});

for(const [file,hunks] of Object.entries(responseChanges))test(`Quotation status response review rejects changed or duplicated hunks: ${file}`,()=>{const source=fs.readFileSync(path.resolve(__dirname,'../',file),'utf8');for(const hunk of hunks){assert.throws(()=>beforeResponse(file,source.replace(hunk.after,hunk.after.replace(/\S/,'!'))));assert.throws(()=>beforeResponse(file,source+hunk.after));}});

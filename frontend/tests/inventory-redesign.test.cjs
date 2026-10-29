/** Inventory extraction contracts. Baseline and app source only; never a service/DB fixture. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const baseline=process.env.BASELINE_FRONTEND?path.resolve(process.env.BASELINE_FRONTEND):path.join(root,'../test-fixtures/frontend-original');
const original=path.join(baseline,'src/app/dashboard/inventory/page.tsx');
const controller=path.join(root,'src/hooks/use-inventory-workspace.ts');
const model=path.join(root,'src/components/inventory/inventory-model.ts');
const printer=ts.createPrinter({removeComments:true});
const parse=file=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(file,name){const ast=parse(file);let value;function visit(n){if((ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name?.getText(ast)===name)value=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(value,`${name} exists in ${path.basename(file)}`);return{ast,node:value};}
function printed(file,name,part){const {ast,node}=declaration(file,name);return printer.printNode(ts.EmitHint.Unspecified,part?node[part]:node,ast).replace(/^export /,'');}
for(const name of ['Overview','Product','Warehouse','Category','Supplier','TaxCode','Stock','Purchase','Movement','PurchaseLine','ItemForm','SupplierForm','WarehouseForm'])test(`model ${name}: original DTO/form definition is unchanged`,()=>assert.equal(name==='Movement'?printed(model,name).replace('    product_id?: string;\n',''):printed(model,name),printed(original,name)));
for(const name of ['today','money','emptyItem','emptySupplier','emptyWarehouse','labelType','serviceDurationLabel'])test(`model ${name}: defaults and formatting remain exact`,()=>assert.equal(printed(model,name),printed(original,name)));
for(const name of ['activeStockProducts','activeSuppliers','activeWarehouses','activeCategoryOptions','filteredItems','filteredSuppliers','filteredPurchases','filteredStock','filteredMovements','salesTaxes','purchaseTaxes','purchaseProducts','transferProducts','transferAvailable','purchaseTotals','missingPurchaseSetup'])test(`${name}: existing eligibility, search, currency and calculation expression is exact`,()=>assert.equal(printed(controller,name,'initializer'),printed(original,name,'initializer')));
function nestedVariable(file,fn,name){const {ast,node}=declaration(file,fn);let value;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)value=n.initializer;ts.forEachChild(n,visit);};visit(node);assert.ok(value,`${fn}/${name}`);return printer.printNode(ts.EmitHint.Unspecified,value,ast);}
for(const [fn,name]of [['submitItem','duration'],['submitItem','body'],['submitSupplier','body'],['submitPurchase','supplier'],['submitPurchase','lines']])test(`${fn}/${name}: numeric/nullable financial payload preparation is unchanged`,()=>assert.equal(nestedVariable(controller,fn,name),nestedVariable(original,fn,name)));
for(const fn of ['submitWarehouse','saveCategory','toggleCategory','toggleSupplier','toggleItem','submitAdjustment','submitPurchase','submitTransfer'])test(`${fn}: original save payload object is unchanged`,()=>{
 function payloads(file){const{ast,node}=declaration(file,fn);const values=[];const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='save')values.push(printer.printNode(ts.EmitHint.Unspecified,n.arguments[2],ast));ts.forEachChild(n,visit);};visit(node);assert.ok(values.length);return values;}assert.deepEqual(payloads(controller),payloads(original));
});
test('submitItem: duration request still carries only duration_months, not a changed product contract',()=>{
 function bodies(file){const{ast,node}=declaration(file,'submitItem'),values=[];const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='JSON.stringify')values.push(printer.printNode(ts.EmitHint.Unspecified,n.arguments[0],ast));ts.forEachChild(n,visit);};visit(node);return values;}assert.deepEqual(bodies(controller),bodies(original));
});
for(const fn of ['submitItem','submitPurchase'])test(`${fn}: original pre-submit business validation remains intact`,()=>{
 function guards(file){const{ast,node}=declaration(file,fn);return node.body.statements.filter(ts.isIfStatement).filter(n=>n.thenStatement.getText(ast).includes('setError(')).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast));}assert.deepEqual(guards(controller),guards(original));
});
for(const file of ['src/components/service-sales-panel.tsx','src/components/service-duration-fields.tsx','src/app/api/inventory/[[...path]]/route.ts','src/app/api/services/[[...path]]/route.ts'])test(`${file}: existing service workflow and authenticated proxy remain unchanged`,()=>assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(baseline,file),'utf8')));

test('editor fields retain the original value, options, constraints and state-update callbacks',()=>{
 function fields(file){const ast=parse(file),values=[];const visit=n=>{if(ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n)){const attrs=n.attributes.properties.filter(ts.isJsxAttribute),value=attrs.find(a=>['value','checked','durationMonths'].includes(a.name.text));if(value&&/\{(?:itemForm|supplierForm|warehouseForm|categoryDraft|adjustForm|purchaseForm|transferForm|line)\./.test(value.initializer?.getText(ast)||'')&&attrs.some(a=>['onChange','onValueChange'].includes(a.name.text))){values.push(attrs.filter(a=>['value','checked','durationMonths','onChange','onValueChange','type','required','optional','options','min','max','step'].includes(a.name.text)).map(a=>printer.printNode(ts.EmitHint.Unspecified,a,ast)).sort().join(' | '));}}ts.forEachChild(n,visit);};visit(ast);return values.sort();}assert.deepEqual(fields(path.join(root,'src/components/inventory/inventory-editor.tsx')),fields(original));
});

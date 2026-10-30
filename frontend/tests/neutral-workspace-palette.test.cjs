const {beforeReviewedFinanceCompatibility}=require('./helpers/reviewed-finance-coexistence.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const baseline=require('./neutral-palette-baseline.json');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const restore=s=>s.replace('font-family:var(--font-sans);','font-family:var(--font-inter),Arial,sans-serif;').replace(/var\(--workspace-(?:neutral-[\w-]+|surface(?:-[\w-]+)?),\s*(#[\da-fA-F]{3,8}|white)\)/g,'$1');
function beforeMoneyOutViewFit(file,css){
 if(file!=='src/components/accounting-money-out/money-out.css')return css;
 for(const [after,before] of [
 ['.mo-columns,.mo-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(105px,1fr) minmax(105px,.8fr) max-content','.mo-columns,.mo-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(105px,1fr) minmax(105px,.8fr) 50px'],
 ['.mo-columns,.mo-row{gap:12px;grid-template-columns:minmax(0,1.1fr) minmax(95px,.85fr) minmax(95px,.8fr) max-content}', '.mo-columns,.mo-row{gap:12px;grid-template-columns:minmax(0,1.1fr) minmax(95px,.85fr) minmax(95px,.8fr) 40px}'],
 ['.mo-row .aa-row-link{justify-self:end;white-space:nowrap}', '.mo-row .aa-row-link{justify-self:end}'],
 ]){assert.equal(css.split(after).length-1,1,'exact reviewed MoneyOut row-fit delta');css=css.replace(after,before);}
 return css;
}
const hrSetupMobileFit='\n  .ht-setup > .ht-section-heading {\n    flex-direction:column;\n    align-items:flex-start\n  }';
function beforeHRSetupMobileFit(file,css){
 if(file!=='src/components/hr-time/hr-time.css')return css;
 assert.equal(css.split(hrSetupMobileFit).length-1,1,'one scoped HR setup delta');
 const anchor='  .ht-section-heading h2 {\n    font-size:1rem\n  }'+hrSetupMobileFit;
 assert.equal(css.split(anchor).length-1,1,'exact reviewed mobile HR setup header delta');
 return css.replace(hrSetupMobileFit,'');
}
const digest=s=>createHash('sha256').update(s.replace(/\s+/g,'')).digest('hex');
for(const [file,sha] of Object.entries(baseline))test(`${file}: only palette references change; original dark fallback, selectors and geometry remain exact`,()=>{
 const css=beforeReviewedFinanceCompatibility(file,beforeMoneyOutViewFit(file,beforeHRSetupMobileFit(file,read(file))));assert.equal(digest(restore(css)),sha);
 assert.notEqual(digest(restore(css.replace(/padding:/,'padding-left:'))),sha);
});
test('neutral palette is scoped to light authenticated workspaces, not dark or public pages',()=>{
 const css=read('src/app/globals.css');const rule=css.match(/:root:not\(\.dark\) \.workspace-shell:not\(\.dark\):not\(\.dark \*\) \{([^}]+)\}/)[1];
 for(const [name,value] of Object.entries({'surface':'#ffffff','surface-hover':'#f5f5f5','surface-selected':'#ebebeb','neutral-ink':'#171717','neutral-muted':'#626262','neutral-action':'#171717','neutral-on-action':'#ffffff'})) assert.ok(rule.includes(`--workspace-${name}: ${value};`));
 assert.doesNotMatch(css,/filter:\s*grayscale|background[^;]*!important/);
});
test('marked surfaces and primary actions use central palette instead of decorative literals',()=>{
 const css=read('src/components/dashboard/dashboard-design.css');
 for(const selector of ['.ws-sidebar ','.ws-context-bar ','.ws-mobile-header ','.ws-drawer ']){
  const rule=css.slice(css.indexOf(selector)).split('}')[0];assert.match(rule,/background:var\(--workspace-surface,/);
 }
 const inventory=read('src/components/inventory/inventory-register.css');
 assert.match(inventory,/\.inventory-attention\{[^}]*background:var\(--workspace-surface, #fffefa\)/);
 assert.match(inventory,/\.inventory-primary,\.inventory-secondary\{[^}]*background:var\(--workspace-neutral-action,/);
 assert.match(inventory,/\.inventory-primary,\.inventory-secondary\{[^}]*color:var\(--workspace-neutral-on-action, white\)/);
 assert.match(inventory,/\.inventory-negative\{color:#a34237\}/);
});

test('centralized shell font normalization rejects altered or duplicated overrides',()=>{
 const file='src/components/dashboard/dashboard-design.css'; const css=read(file);
 assert.equal((css.match(/font-family:var\(--font-sans\);/g)||[]).length,1);
 assert.notEqual(digest(restore(css.replace('font-family:var(--font-sans);','font-family:Arial,sans-serif;'))),baseline[file]);
 assert.notEqual(digest(restore(css.replace('font-family:var(--font-sans);','font-family:var(--font-sans);font-family:var(--font-sans);'))),baseline[file]);
});

test('MoneyOut row-fit inverse rejects changed or duplicate geometry allowances',()=>{
 const file='src/components/accounting-money-out/money-out.css',css=read(file);
 for(const changed of [css.replace('minmax(105px,.8fr) max-content','minmax(105px,.8fr) 50px'),css.replace('minmax(105px,.8fr) max-content','minmax(105px,.8fr) 60px'),css.replace('minmax(95px,.8fr) max-content','minmax(95px,.8fr) 40px'),css.replace('minmax(95px,.8fr) max-content','minmax(95px,.8fr) 50px'),css.replace('white-space:nowrap','white-space:normal'),css+'.mo-row .aa-row-link{justify-self:end;white-space:nowrap}'])assert.throws(()=>beforeMoneyOutViewFit(file,changed));
 const unrelated=css.replace('.mo-local-grid{display:grid;grid-template-columns:minmax(0,1.5fr)', '.mo-local-grid{display:grid;grid-template-columns:minmax(0,2fr)');
 assert.notEqual(digest(restore(beforeReviewedFinanceCompatibility(file,beforeMoneyOutViewFit(file,unrelated)))),baseline[file]);
});

test('HR setup header inverse rejects broadened or altered mobile layout',()=>{
 const file='src/components/hr-time/hr-time.css',css=read(file);
 for(const changed of [css.replace(hrSetupMobileFit,''),css+hrSetupMobileFit,css.replace(hrSetupMobileFit,hrSetupMobileFit.replace('column','row')),css.replace(hrSetupMobileFit,hrSetupMobileFit.replace('.ht-setup > ',''))])assert.throws(()=>beforeHRSetupMobileFit(file,changed));
 const altered=css.replace('gap:18px','gap:19px');assert.notEqual(digest(restore(beforeHRSetupMobileFit(file,altered))),baseline[file]);
});

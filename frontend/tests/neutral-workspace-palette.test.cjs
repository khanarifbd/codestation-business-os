const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const baseline=require('./neutral-palette-baseline.json');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const restore=s=>s.replace('font-family:var(--font-sans);','font-family:var(--font-inter),Arial,sans-serif;').replace(/var\(--workspace-(?:neutral-[\w-]+|surface(?:-[\w-]+)?),\s*(#[\da-fA-F]{3,8}|white)\)/g,'$1');
const digest=s=>createHash('sha256').update(s.replace(/\s+/g,'')).digest('hex');
for(const [file,sha] of Object.entries(baseline))test(`${file}: only palette references change; original dark fallback, selectors and geometry remain exact`,()=>{
 const css=read(file);assert.equal(digest(restore(css)),sha);
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

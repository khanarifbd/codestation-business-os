const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../src/components/projects/project-register.css'),'utf8');
function verify(source){
 const rules=[...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].includes('projects-status-rail'));
 const expected=[
  ['.projects-status-rail','border-block:1px solid var(--workspace-neutral-border, #dce5d5)'],
  ['.projects-status-rail button','border-right:1px solid var(--workspace-neutral-border, #e1e8da)'],
  ['.projects-status-rail span','color:var(--workspace-neutral-muted, #65735c)'],
  ['.projects-status-rail button[aria-pressed=true]','background:var(--workspace-surface-selected, #eaf1df)'],
  ['.projects-status-rail button:nth-child(-n+3)','border-bottom:1px solid var(--workspace-neutral-border, #dce5d5)'],
 ];
 for(const [selector,declaration] of expected)assert.equal(rules.filter(m=>m[1].trim()===selector&&m[2].includes(declaration)).length,1,selector);
}
test('Projects decorative count rail uses central neutral selected, border and muted tokens',()=>verify(css));
test('every desktop/mobile rail regression to literal green fails the guard',()=>{
 const railRules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].includes('projects-status-rail'));
 let mutations=0;
 for(const rule of railRules)for(const token of rule[2].matchAll(/var\(--workspace-[\w-]+, (#[\da-f]+)\)/g)){
  const changedRule=rule[0].replace(token[0],token[1]);
  assert.throws(()=>verify(css.slice(0,rule.index)+changedRule+css.slice(rule.index+rule[0].length)));
  mutations++;
 }
 assert.equal(mutations,5);
});

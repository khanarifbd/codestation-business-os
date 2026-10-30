const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline={"company": "9bd05b6f175c16238f1d6c693ec4ae8e1652c42eb37dbaef04c0fc1cba7ed08b", "activity-logs": "9987b9f3a4f2976a9bec7038bc0cbe10d8ccc27ac917589e7e7c540143d2cc05"};
for(const route of ['company','activity-logs'])test(`${route}: data permissions and save/filter controller remain unchanged`,()=>{
 const s=read(`src/app/dashboard/${route}/page.tsx`),start=s.indexOf('export default function'),end=route==='company'?s.indexOf('  if(loading)return'):s.indexOf('  return (\n    <main');
 assert.equal(crypto.createHash('sha256').update(s.slice(start,end)).digest('hex'),baseline[route]);
});
test('company preserves approved text field focus and all thirteen sections',()=>{
 const s=read('src/app/dashboard/company/page.tsx');
 assert.match(s,/const inputClass="mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500"/);
 assert.match(s,/const textareaClass="mt-2 min-h-28 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500"/);
 for(const id of ['general','legal','contact','addresses','localization','currencies','finance','payments','defaults','numbering','branding','documents','online'])assert.ok(s.includes(`["${id}",`));
 assert.match(s,/aria-label="Company settings sections"/);
 assert.match(s,/aria-current=\{activeTab===id\?"page":undefined\}/);
});
test('modern administration surfaces are scoped, responsive and do not add field focus rings',()=>{
 const css=read('src/components/company/administration-workspace.css');
 assert.match(css,/\.company-settings-navigation\{[^}]*overflow-x:auto/);
 assert.match(css,/\.company-settings-navigation button\{[^}]*flex:0 0 auto/);
 assert.match(css,/\.activity-log-workspace :is\(button,a\):focus-visible/);
 assert.doesNotMatch(css,/:is\(input[^}]*outline|input:focus|textarea:focus/);
 assert.match(css,/--workspace-surface-selected/);
 assert.match(css,/@media\(max-width:640px\)/);
});
test('activity controls have accessible labels and keyboard detail action',()=>{
 const s=read('src/app/dashboard/activity-logs/page.tsx');
 for(const label of ['Action contains','Entity type','Outcome','From date','To date','Close activity detail'])assert.ok(s.includes(`aria-label="${label}"`));
 assert.ok(s.includes('aria-label={`View activity ${item.action}`}'));
 assert.ok(s.includes('role="dialog" aria-label="Activity detail"'));
});

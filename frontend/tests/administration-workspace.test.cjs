const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function restorePanelComposition(source){for(const {before,after} of require("./helpers/reviewed-company-panel-composition.json")){assert.equal(source.split(after).length,2,"exact reviewed panel composition seam");source=source.replace(after,before);}return source;}
const baseline={"company": "d7c31419027299f002e60eafa134662e2017116932829df63bb99eba97247531", "activity-logs": "9987b9f3a4f2976a9bec7038bc0cbe10d8ccc27ac917589e7e7c540143d2cc05"};
for(const route of ['company','activity-logs'])test(`${route}: reviewed owned controller remains exact`,()=>{
 const s=read(`src/app/dashboard/${route}/page.tsx`),start=s.indexOf('export default function'),end=route==='company'?s.indexOf('  if(loading)return'):s.indexOf('  return (\n    <main');
 if(route==='company')assert.equal(crypto.createHash('sha256').update(restorePanelComposition(s.slice(start,end))).digest('hex'),baseline[route]);else assertReviewedActivity(s.slice(start,end));
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
 for(const label of ['Action contains','Entity type','Outcome','From date','To date'])assert.ok(s.includes(`aria-label="${label}"`));
 assert.ok(s.includes('aria-label={`View activity ${item.action}`}'));
 const drawer=read('src/components/company/activity-read-drawer.tsx');
 assert.ok(drawer.includes('aria-label="Close activity detail"'));
 assert.ok(drawer.includes('role="dialog" aria-modal="true" aria-label="Activity detail"'));
 assert.ok(s.includes('ActivityReadDrawer key={detailVersion} onClose={closeDetail}'));
});

const reviewedActivityHashes={"src/hooks/use-activity-log-read.ts": "05a95f3bc7395fb4ad73384edcd834e332762446241d498daa11261d2173904d", "src/hooks/use-administration-read-owner.ts": "ca98e3375cf999505e1f613d8399972ee12c05bb3b5a5a8b0f2a6e6d4fa02150"};
function assertReviewedActivity(controller, override={}) { assert.equal(crypto.createHash("sha256").update(controller).digest("hex"),"218ee9b0f6f19b934f6e48aaf75c629c8997ac9bedd3ac7da44a02df6ab57796"); for(const [file,expected] of Object.entries(reviewedActivityHashes))assert.equal(crypto.createHash("sha256").update(override[file]??read(file)).digest("hex"),expected); }
test('reviewed Activity extraction rejects mutation of ownership gate',()=>{const s=read('src/app/dashboard/activity-logs/page.tsx'),controller=s.slice(s.indexOf('export default function'),s.indexOf('  return (\n    <main'));const file='src/hooks/use-activity-log-read.ts',before=read(file),after=before.replace('if(!owns()||append','if(append');assert.notEqual(after,before);assert.throws(()=>assertReviewedActivity(controller,{[file]:after}));});

test('reviewed Company controller rejects removing admission ownership',()=>{const s=read('src/app/dashboard/company/page.tsx'),controller=s.slice(s.indexOf('export default function'),s.indexOf('  if(loading)return')),changed=controller.replace('if(!owns()||readPending.current||inFlight.current','if(readPending.current||inFlight.current');assert.notEqual(changed,controller);assert.notEqual(crypto.createHash('sha256').update(restorePanelComposition(changed)).digest('hex'),baseline.company);});

test("Company panel composition inverse rejects altered child leave registration",()=>{const s=read("src/app/dashboard/company/page.tsx"),controller=s.slice(s.indexOf("export default function"),s.indexOf("  if(loading)return"));assert.throws(()=>restorePanelComposition(controller.replace("currenciesLeaveGuard.current?.()??false","currenciesLeaveGuard.current?.()??true")),/exact reviewed/);});

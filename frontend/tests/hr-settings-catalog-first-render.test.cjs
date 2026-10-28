/* Actual component + actual hook SSR before layout effects. Not browser interaction proof. */
const {test}=require('node:test');const assert=require('node:assert/strict');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./reconciliation-harness.cjs');
const {harness,deferred}=require('./hr-settings-catalog-harness.cjs');
for(const kind of ['leave','shift','holiday']) {
 test(kind+': already-ready actual first render enables editor without a layout-driven rerender',()=>{
  let vm,hook;const loader=sourceLoader({
   './use-hr-settings-identity':{useHRSettingsIdentity:()=>({scope:'ready-owner',canManage:true,accessLoading:false,accessError:null})},
   'next/navigation':{useRouter:()=>({replace(){}}),usePathname:()=>`/dashboard/hr/settings/catalog/${kind}/new`,useSearchParams:()=>new URLSearchParams()},
   './use-document-navigation-guard':{useDocumentNavigationGuard:()=>({markClean(){}})},
   '@/hooks/use-hr-settings-catalog-create':{useHRSettingsCatalogCreate:k=>(vm=hook(k))},
  });
  hook=loader.load('src/hooks/use-hr-settings-catalog-create.ts').useHRSettingsCatalogCreate;
  const Component=loader.load('src/components/hr-settings/catalog-create.tsx').CatalogCreate;
  // Exactly one SSR render: layout effects never run and no artificial retry/render occurs.
  const html=renderToStaticMarkup(React.createElement(Component,{kind}));
  assert.match(html,/<form/);assert.match(html,/<fieldset/);assert.doesNotMatch(html,/<fieldset[^>]*\bdisabled/);
  assert.equal(vm.editable,true);assert.equal(vm.canEdit(),false);assert.equal(vm.review({}),false);
 });
 test(kind+': render readiness does not weaken pending, unknown or stale-owner imperative locks',async()=>{
  const h=harness(kind),body=deferred();let run;
  try {
   await h.flush();assert.equal(h.vm().editable,true);assert.equal(h.review(),true);await h.flush();assert.equal(h.vm().editable,false);
   h.respondWrites(()=>({ok:true,status:201,json:()=>body.promise}));const reviewed=h.vm();run=reviewed.submit();await reviewed.submit();await h.flush();
   assert.equal(h.writes().length,1);assert.equal(h.vm().busy,true);assert.equal(h.vm().editable,false);assert.equal(h.review(),false);
   body.resolve(null);await run;await h.flush();assert.equal(h.vm().phase,'acknowledged');assert.equal(h.vm().editable,false);assert.equal(h.review(),false);await h.submit();assert.equal(h.writes().length,1);
   const old=h.vm();h.identity({organizationId:'replacement-owner'});h.render();await old.submit();assert.equal(old.review(h.formNode),false);await h.flush();assert.equal(h.vm().editable,true);assert.equal(h.writes().length,1);
   h.caps({can_manage:false});await h.flush();assert.equal(h.vm().editable,false);assert.equal(h.review(),false);
  } finally {body.resolve(null);await run;h.cleanup();}
 });
}

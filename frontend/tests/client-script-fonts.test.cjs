const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const layout = read('src/app/layout.tsx');
const css = read('src/app/globals.css');
const spec = read('e2e/clients-final-revision.spec.mjs');

test('Targeted script fallbacks preserve Inter primary and untouched mono, without global font preloads', () => {
  assert.ok(layout.includes('const inter = Inter({\n  variable: "--font-inter",\n  subsets: ["latin"],\n  display: "swap",\n});'));
  assert.ok(layout.includes('const geistMono = Geist_Mono({\n  variable: "--font-geist-mono",\n  subsets: ["latin"],\n  display: "swap",\n});'));
  for (const [name, variable] of [['Noto_Sans_Bengali','--font-noto-bengali'],['Noto_Sans_JP','--font-noto-japanese']]) {
    const declaration = layout.match(new RegExp(`${name}\\(\\{([\\s\\S]*?)\\}\\)`))[1];
    assert.ok(declaration.includes(`variable: "${variable}"`));
    assert.match(declaration, /preload: false/);
    assert.match(declaration, /adjustFontFallback: false/);
    assert.match(declaration, /display: "swap"/);
  }
  for (const token of ['sans','heading']) assert.ok(css.includes(`--font-${token}: var(--font-inter), var(--font-noto-bengali), var(--font-noto-japanese), system-ui, sans-serif;`));
  assert.match(css, /--font-mono: var\(--font-geist-mono\);/);
  assert.doesNotMatch(layout, /fonts\.googleapis|fonts\.gstatic|<link/);
});

test('Unicode fixtures and real Chromium glyph assertions remain before all four screenshots', () => {
  assert.ok(spec.includes('Müller 株式会社')); assert.ok(spec.includes('José O’Connor / মোঃ আরিফ'));
  assert.ok(spec.includes("CSS.getPlatformFontsForNode"));
  assert.ok(spec.includes('await document.fonts.ready'));
  assert.doesNotMatch(spec, /document\.fonts\.check/);
  assert.equal((spec.match(/await assertRenderedScriptFont\(/g)||[]).length,5);
  assert.equal((spec.match(/await page\.screenshot\(/g)||[]).length,4);
  assert.ok(spec.includes('font.isCustomFont && font.glyphCount > 0'));
});

const helper = spec.slice(spec.indexOf('async function assertRenderedScriptFont'), spec.indexOf('// Real application'));
async function probe(fonts) {
  const calls = [];
  const session = { async send(name) { calls.push(name); if(name==='DOM.getDocument')return {root:{nodeId:1}};if(name==='DOM.querySelector')return {nodeId:2};if(name==='CSS.getPlatformFontsForNode')return {fonts};return {}; }, async detach(){calls.push('detach');} };
  const page = { evaluate:async()=>calls.push('font-ready-and-paint'), context:()=>({newCDPSession:async()=>session}) };
  const locator = { visible:true, evaluate:async()=>calls.push('probe-marker') };
  const expect = (value) => ({toBeVisible:async()=>assert.equal(value.visible,true),toBeGreaterThan:n=>assert.ok(value>n),toBe:expected=>assert.equal(value,expected)});
  const context={expect,console:{log(){}},result:null};vm.createContext(context);vm.runInContext(helper+'; result=assertRenderedScriptFont;',context);
  try { await context.result(page,locator,/Noto.*Bengali/i,'unit'); } finally { assert.equal(calls.at(-2),'detach');assert.equal(calls.at(-1),'probe-marker'); }
  return calls;
}
const inter={familyName:'Inter',isCustomFont:true,glyphCount:12};
test('Glyph probe accepts actually used self-hosted script face and Inter together',async()=>{
  const calls=await probe([inter,{familyName:'Noto Sans Bengali',isCustomFont:true,glyphCount:7}]);assert.ok(calls.includes('CSS.getPlatformFontsForNode'));assert.equal(calls[0],'font-ready-and-paint');
});
for(const [label,fonts] of [['only Latin',[inter]],['system fallback',[inter,{familyName:'Noto Sans Bengali',isCustomFont:false,glyphCount:7}]],['unused font',[inter,{familyName:'Noto Sans Bengali',isCustomFont:true,glyphCount:0}]],['lost Inter',[{familyName:'Noto Sans Bengali',isCustomFont:true,glyphCount:7}]]])test(`Glyph probe rejects ${label}, even with matching CSS names`,async()=>{await assert.rejects(()=>probe(fonts));});

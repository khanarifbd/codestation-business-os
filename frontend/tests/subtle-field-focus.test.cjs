const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const focus = css.slice(css.indexOf('/* Match Company Settings'));
const scope = ':root:not(.dark) .workspace-shell:not(.dark):not(.dark *)';
test('field focus is centralized, light-workspace scoped and leaves non-field focus alone', () => {
  const rules = [...focus.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => !selector.includes('@media'));
  assert.equal(rules.length, 5);
  for (const [, selector] of rules) {
    assert.ok(selector.trim().startsWith(scope));
    assert.ok(selector.includes(':focus'));
    assert.doesNotMatch(selector, /(?:^|,\s*)(button|a|summary)(?:\W|$)/);
  }
  for (const type of ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image']) {
    for (const [, selector] of rules) assert.ok(selector.includes(`[type="${type}"]`));
  }
  assert.match(rules[0][2], /outline: none;/);
  assert.match(rules[0][2], /box-shadow: none;/);
  assert.doesNotMatch(focus, /!important|border-width|padding|border-radius|background:/);
});
test('focus matches Company Settings border, preserves validation and forced-colors cues', () => {
  const company = fs.readFileSync(path.join(root, 'src/app/dashboard/company/page.tsx'), 'utf8');
  assert.match(company, /outline-none transition focus:border-neutral-500/);
  assert.match(focus, /:focus:not\(\[aria-invalid="true"\]\):not\(\[data-invalid\]\):not\(:user-invalid\)\s*\{\s*border-color: var\(--color-neutral-500, #737373\);/);
  const invalid = focus.match(/:focus:is\(\[aria-invalid="true"\], \[data-invalid\], :user-invalid\)\s*\{([^}]+)\}/)[1];
  assert.match(invalid, /box-shadow: inset 0 -1px/);
  assert.doesNotMatch(invalid, /border/);
  assert.match(focus, /@media \(forced-colors: active\)/);
  assert.match(focus, /outline: 1px solid Highlight;\s*outline-offset: -1px;/);
});

test('borderless field controls retain an inset focus indicator without changing normal fields', () => {
  const nav = fs.readFileSync(path.join(root, 'src/components/hr-module-nav.tsx'), 'utf8');
  assert.match(nav, /aria-label="More People and HR pages"/);
  assert.match(nav, /rounded-lg border-0/);
  const rule = focus.match(/:is\(\.border-0, \.border-none\):focus\s*\{([^}]+)\}/)[1];
  assert.match(rule, /box-shadow: inset 0 -2px 0 currentColor;/);
  assert.doesNotMatch(rule, /outline|border-width|padding|background/);
});

test('native client type focus QA targets its unique form name rather than concatenated option labels', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/neutral-workspace-theme.spec.mjs'), 'utf8');
  assert.ok(source.includes(`const clientType = dialog.locator('select[name="client_type"]');`));
  assert.ok(source.includes('await expect(clientType).toHaveCount(1);'));
  assert.ok(source.includes("await expect(clientType).toHaveValue('company');"));
  assert.doesNotMatch(source, /getByLabel\('Client type', \{ exact: true \}\)/);
});

test('contrast helper normalizes CSS color formats, rejects unsupported alpha/invalid colors and retains 4.5', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'e2e/neutral-workspace-theme.spec.mjs'), 'utf8');
  const helper = source.slice(source.indexOf('async function readable('), source.indexOf("test('neutral workspace:"));
  const background = 'lab(96.52 -0.0000298023 0.0000119209)';
  const foregrounds = ['rgb(82, 82, 82)', 'rgba(82, 82, 82, 1)', 'lab(34.924 0 0)', 'oklch(0.438 0 0)'];
  const resolved = [];
  // Contract fixture provides browser-resolved pixels, NOT a fake Lab formula.
  // Actual CSS-to-sRGB rendering remains covered by the real browser HR journey.
  const pixels = new Map(foregrounds.map(color => [color, [82, 82, 82, 255]]));
  pixels.set(background, [245, 245, 245, 255]);
  pixels.set('rgba(82, 82, 82, 0.5)', [82, 82, 82, 128]);
  const canvasUnsupported = 'color(srgb 1 0 0)';
  const runtime = {
    CSS: { supports: (property, color) => property === 'color' && (pixels.has(color) || color === canvasUnsupported) },
    getComputedStyle: element => element.style,
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      return { getContext(kind, options) {
        assert.equal(kind, '2d'); assert.equal(options.colorSpace, 'srgb');
        let fillStyle = '#000000';
        return {
          clearRect() {}, fillRect() {},
          set fillStyle(value) { if (pixels.has(value) || ['#010203', '#040506'].includes(value)) fillStyle = value; },
          get fillStyle() { return fillStyle; },
          getImageData() { resolved.push(fillStyle); return { data: pixels.get(fillStyle) }; },
        };
      } };
    } },
    expect: (ratio, diagnostic) => ({ toBeGreaterThanOrEqual(threshold) {
      assert.equal(threshold, 4.5);
      assert.ok(diagnostic.includes('computed'));
      assert.ok(diagnostic.includes('[82,82,82]'));
      assert.ok(ratio >= threshold, `Contrast ${ratio} is below ${threshold}`);
    } }),
  };
  const readable = vm.runInNewContext(`${helper}; readable`, runtime);
  const locator = color => ({ evaluate: callback => callback({ style: { color, backgroundColor: background } }) });
  for (const color of foregrounds) await readable(locator(color));
  assert.deepEqual(resolved, foregrounds.flatMap(color => [color, background]));
  await assert.rejects(readable(locator('not-a-color')), /Invalid computed CSS color/);
  await assert.rejects(readable(locator(canvasUnsupported)), /Canvas cannot normalize CSS color/);
  await assert.rejects(readable(locator('rgba(82, 82, 82, 0.5)')), /requires opaque resolved colors/);
  pixels.set(background, [82, 82, 82, 255]);
  await assert.rejects(readable(locator(foregrounds[0])), /Contrast 1 is below 4.5/);
  assert.doesNotMatch(helper, /color\.match/);
});

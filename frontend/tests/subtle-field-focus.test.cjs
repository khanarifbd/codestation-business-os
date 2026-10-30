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

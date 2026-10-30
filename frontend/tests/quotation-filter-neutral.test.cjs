const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const list = read('src/components/commercial/quotations-list.css');
const workspace = read('src/components/commercial/quotation-workspace.css');
const globals = read('src/app/globals.css');
function rule(css, selector, property) {
  const matches = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].trim() === selector && (!property || m[2].includes(`${property}:`)));
  assert.equal(matches.length, 1, selector);
  return matches[0][2];
}
function assertNeutral(listCss, workspaceCss) {
  // The browse selectors win border specificity; base selector owns color/surface.
  for (const control of ['button', 'select']) {
    assert.match(rule(listCss, `.quotation-browse .quotation-status-filter ${control}`, 'border'), /border:1px solid var\(--workspace-neutral-border, #d2decb\);/);
  }
  const button = rule(workspaceCss, '.quotation-status-filter button', 'background');
  assert.match(button, /color:var\(--workspace-neutral-ink, #48623f\);/);
  assert.match(button, /background:var\(--workspace-surface, #f5f8f1\);/);
}
test('quotation Reset and status filter use existing light-workspace neutral cascade', () => {
  assertNeutral(list, workspace);
  const scope = rule(globals, ':root:not(.dark) .workspace-shell:not(.dark):not(.dark *)');
  for (const value of ['--workspace-neutral-border: #e5e5e5;', '--workspace-neutral-ink: #171717;', '--workspace-surface: #ffffff;']) assert.ok(scope.includes(value));
  assert.match(list, /\.quotation-browse \.quotation-status-filter button \{[^}]*min-height:44px;[^}]*padding:0 10px;/);
  assert.match(list, /\.quotation-browse \.quotation-status-filter select \{[^}]*padding:0 9px;[^}]*min-height:44px;/);
});
test('each decorative regression is rejected independently', () => {
  for (const selector of ['button', 'select']) {
    const source = rule(list, `.quotation-browse .quotation-status-filter ${selector}`, 'border');
    assert.throws(() => assertNeutral(list.replace(source, source.replace('var(--workspace-neutral-border, #d2decb)', '#d2decb')), workspace));
  }
  assert.throws(() => assertNeutral(list, workspace.replace('var(--workspace-neutral-ink, #48623f)', '#48623f')));
  assert.throws(() => assertNeutral(list, workspace.replace('var(--workspace-surface, #f5f8f1)', '#f5f8f1')));
});
test('semantic status colors remain exact rather than neutralized', () => {
  for (const [selector, background, color] of [
    ['.quotation-browse-status', '#f1f3e9', '#62683d'],
    ['.quotation-browse-status[data-status=sent]', '#edf2f8', '#43657e'],
    ['.quotation-browse-status[data-status=accepted]', '#eaf3e5', '#3f6e35'],
    ['.quotation-browse-status[data-status=rejected]', '#fbede7', '#8d5140'],
    ['.quotation-browse-status[data-status=cancelled]', '#eff0ed', '#697064'],
  ]) {
    // Base selector also has a responsive sizing-only rule; select the color owner.
    const owners = [...list.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].trim() === selector && m[2].includes('background:'));
    assert.equal(owners.length, 1);
    assert.ok(owners[0][2].includes(`background:${background};`));
    assert.ok(owners[0][2].includes(`color:${color};`));
    assert.doesNotMatch(owners[0][2], /workspace-neutral/);
  }
});

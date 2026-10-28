// Isolated source/component fixture, not a browser or React lifecycle integration test.
// State hooks and effects are controlled; actual source, callbacks, JSX and static
// child rendering are exercised. Every request must use the supplied fetch stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => findNode(child, predicate)).find(Boolean) || null;
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}
function componentFixture(relativePath, { states, fetch, confirm = () => true, params = {}, router = {}, exportName = 'default', props = {} }) {
  const values = [...states];
  let cursor = 0;
  let tree;
  let effects = [];
  const modules = new Map();
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useEffect(effect) { effects.push(effect); },
    useMemo: calculate => calculate(),
    useCallback: callback => callback,
  };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const compiled = { exports: {} };
    modules.set(filename, compiled.exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      module: compiled, exports: compiled.exports, Error, console,
      fetch: fetch || (() => { throw new Error('Unexpected fixture request'); }),
      window: { confirm },
      require(name) {
        if (name === 'react') return hooks;
        if (name === 'next/navigation') return { useParams: () => params, useRouter: () => router };
        if (name === 'next/link') return { default: ({ href, children }) => React.createElement('a', { href }, children) };
        if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
        if (name === '@/components/searchable-select') return { SearchableSelect: () => null };
        if (name.startsWith('@/')) {
          const base = path.resolve(__dirname, '../../src', name.slice(2));
          return load(['.tsx', '.ts'].map(extension => base + extension).find(file => fs.existsSync(file)));
        }
        return require(name);
      },
    }, { filename });
    return compiled.exports;
  }
  const Component = load(path.resolve(__dirname, '../../src', relativePath))[exportName];
  return {
    states: values,
    render() { cursor = 0; effects = []; tree = Component(props); return renderToStaticMarkup(tree); },
    effects() { return [...effects]; },
    find(predicate) { return findNode(tree, predicate); },
    button(label) { const button = findNode(tree, node => node.type === 'button' && textOf(node) === label); assert.ok(button, `Button not found: ${label}`); return button; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
  };
}
function response(status, payload) { return { status, ok: status >= 200 && status < 300, json: async () => payload }; }
module.exports = { componentFixture, response };

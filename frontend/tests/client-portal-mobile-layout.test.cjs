'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../src/components/client-portal/portal.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
// Current scoped presentation contract, not a hash or exact-delta snapshot.
function rule(selector){const found=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].trim()===selector);assert.ok(found.length,`Missing scoped rule: ${selector}`);return Object.assign({},...found.map(m=>Object.fromEntries(m[2].split(';').filter(x=>x.includes(':')).map(x=>{const i=x.indexOf(':');return[x.slice(0,i).trim(),x.slice(i+1).trim()];}))));}
const actions=()=>rule('.cp-page .aa-actions'),name=()=>rule('.cp-page .cp-document-title > span'),titles=()=>rule('.cp-page :is(.cp-milestones,.cp-profiles) h3');
test('Portal document actions wrap instead of requiring a single line',()=>assert.equal(actions()['flex-wrap'],'wrap'));
test('Portal action group can shrink but cannot exceed its container',()=>{assert.match(actions()['min-width'],/^0(?:px)?$/);assert.equal(actions()['max-width'],'100%');});
test('valid unbroken document client name wraps within the row',()=>{assert.equal(name()['overflow-wrap'],'anywhere');assert.match(name()['min-width'],/^0(?:px)?$/);assert.equal(name()['max-width'],'100%');});
test('milestone and profile headings wrap long valid titles',()=>assert.equal(titles()['overflow-wrap'],'anywhere'));
test('the narrow presentation rules do not hide or truncate content',()=>{for(const declarations of[actions(),name(),titles()]){assert.notEqual(declarations.overflow,'hidden');assert.notEqual(declarations['text-overflow'],'ellipsis');assert.notEqual(declarations.display,'none');assert.notEqual(declarations['white-space'],'nowrap');}});
test('existing Portal action touch minimum and visible focus affordance stay present',()=>{assert.ok(parseFloat(rule('.cp-button')['min-height'])>=44);const focus=rule('.cp-page :is(button,a,input,select,summary,[tabindex]):focus-visible');assert.match(focus.outline,/3px/);assert.ok(parseFloat(focus['outline-offset'])>=2);});

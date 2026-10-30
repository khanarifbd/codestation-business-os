// Execute the actual keyed child components; only export their otherwise private
// names for the hook harness. No business handlers or JSX are substituted.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
for(const [file,name] of [['currency-settings-panel.tsx','CurrencySettingsContent'],['payment-gateways-settings-panel.tsx','PaymentGatewaysContent']]){
 const source=fs.readFileSync(path.join(__dirname,'../../src/components/company',file),'utf8');
 const exact=`function ${name}(`;if(source.split(exact).length!==2)throw Error('Panel export seam changed');
 const code=ts.transpileModule(source.replace(exact,`export ${exact}`),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const compiled={exports:{}};new Function('require','module','exports',code)(require,compiled,compiled.exports);exports[name]=compiled.exports[name];
}

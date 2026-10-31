/* Executes the real page controller before JSX, under the actual-hook harness.
 * No replacement business handlers. Only exposes otherwise internal callbacks. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const file=path.join(__dirname,'../../src/app/dashboard/company/page.tsx'),source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CompanySettingsContent');
const body=fn.body.statements.slice(0,fn.body.statements.findIndex(n=>ts.isIfStatement(n)&&n.expression.getText(tree)==='loading')).map(n=>n.getText(tree)).join('\n');
const imports=tree.statements.filter(n=>ts.isImportDeclaration(n)&&['react','next/navigation','lucide-react','@/hooks/use-administration-read-owner','@/hooks/use-company-defaults','@/hooks/use-document-navigation-guard','@/lib/api-error'].includes(n.moduleSpecifier.text)).map(n=>n.getText(tree)).join('\n');
const tabs=tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='tabs')).getText(tree);
const verification=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='verifiedCompanyBundle').getText(tree);
const code=ts.transpileModule(imports+'\n'+tabs+'\n'+verification+'\nexport function useCompanyMainController(){'+body+'\nreturn {bundle,loading,saving,error,message,version,writePhase,dirty,activeTab,activeAddressTab,load,retryLoad,api,uploadDocument,runSave,markDirty,switchTab,switchAddress,back,registerDefaultsLeave,registerCurrenciesLeave,registerGatewaysLeave};}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const compiled={exports:{}};new Function('require','module','exports',code)(require,compiled,compiled.exports);module.exports=compiled.exports;

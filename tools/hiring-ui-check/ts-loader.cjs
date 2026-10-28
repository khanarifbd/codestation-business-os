'use strict';
const path=require('node:path'),root=process.env.HR_SOURCE_ROOT;
if(!root)throw Error('Explicit frozen HR source root required');
const ts=require('node:module').createRequire(path.join(root,'package.json'))('typescript');
module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,esModuleInterop:true,sourceMap:false}}).outputText;};

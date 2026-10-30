// Export the actual page content only; no event handlers or JSX are replaced.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../src/app/dashboard/activity-logs/page.tsx'),'utf8');
const seam='function ActivityLogsContent()';if(source.split(seam).length!==2)throw Error('Activity content export seam changed');
const code=ts.transpileModule(source.replace(seam,'export '+seam),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compiled={exports:{}};new Function('require','module','exports',code)(require,compiled,compiled.exports);module.exports=compiled.exports;

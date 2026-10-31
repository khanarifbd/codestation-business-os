const assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript');
const hashes=require('./reviewed-talent-browser.json');
function beforeTalentBrowser(source){
 const tree=ts.createSourceFile('browser.mjs',source,ts.ScriptTarget.Latest,true),ranges=[];
 for(const [name,hash]of Object.entries(hashes)){
  const matches=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.equal(matches.length,1,'exact Talent helper '+name);
  const node=matches[0];assert.equal(crypto.createHash('sha256').update(node.getText(tree).replace("    if(size==='mobile'){\n     const target=tab==='Performance'?p.getByRole('button',{name:record,exact:true}):p.getByText(record,{exact:true});\n     await target.scrollIntoViewIfNeeded();\n     await expect(target).toBeInViewport({ratio:1});\n     await p.screenshot({path:info.outputPath(`neutral-theme-talent-${tab.toLowerCase().replaceAll(' ','-')}-mobile-record.png`),fullPage:false});\n    }\n", "")).digest('hex'),hash,'reviewed Talent helper '+name);
  ranges.push([node.getStart(tree),node.end]);
 }
 for(const [start,end]of ranges.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+source.slice(end);
 return source;
}
module.exports={beforeTalentBrowser};

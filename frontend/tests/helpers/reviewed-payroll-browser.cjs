const assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript');
const hashes=require('./reviewed-payroll-browser.json');
function beforePayrollBrowser(source){
 const reviewed="await expect(p.locator('form.pr-editor fieldset')).toHaveJSProperty('disabled',true);await expect(p.locator('form.pr-editor fieldset').getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();";
 assert.equal(source.split(reviewed).length,2,'exact reviewed Payroll fieldset semantic assertion');
 source=source.replace(reviewed,"await expect(p.locator('form.pr-editor fieldset')).toBeDisabled();");
 const tree=ts.createSourceFile('browser.mjs',source,ts.ScriptTarget.Latest,true),ranges=[];
 for(const [name,hash]of Object.entries(hashes)){
  const matches=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.equal(matches.length,1,'exact Payroll helper '+name);
  const node=matches[0];assert.equal(crypto.createHash('sha256').update(node.getText(tree)).digest('hex'),hash,'reviewed Payroll helper '+name);
  ranges.push([node.getStart(tree),node.end]);
 }
 for(const [start,end]of ranges.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+source.slice(end);
 return source;
}
module.exports={beforePayrollBrowser};

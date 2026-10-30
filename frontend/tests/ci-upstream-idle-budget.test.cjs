const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/ci.yml'),'utf8');
function verify(source){
 const jobs=new Map([...source.matchAll(/^  ([a-z][\w-]*):\n([\s\S]*?)(?=^  [a-z][\w-]*:\n|$(?![\s\S]))/gm)].map(match=>[match[1],match[2]]));
 const launches=[...source.matchAll(/^\s*nohup \.venv\/bin\/uvicorn .*$/gm)].map(match=>match[0].trim());
 assert.equal(launches.length,2);
 const expected=new Map([
  ['browser-smoke','>/tmp/business-os-backend.log 2>&1 &'],
  ['admin-readonly','>"$RUNNER_TEMP/admin-readonly-backend.log" 2>&1 &'],
 ]);
 for(const [job,output] of expected){
  const command='nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --timeout-keep-alive 60 '+output;
  assert.equal(launches.filter(line=>line===command).length,1);
  assert.ok(jobs.get(job)?.includes(command),job+' must own its exact isolated loopback launch');
 }
 assert.equal((source.match(/--timeout-keep-alive/g)||[]).length,2);
}
test('only both isolated CI upstream launches receive the reviewed60s idle budget',()=>verify(workflow));
test('missing, shorter, broader and wrong-job idle overrides fail closed',()=>{
 for(const changed of [
  workflow.replace(' --timeout-keep-alive 60',''),
  workflow.replace('--timeout-keep-alive 60','--timeout-keep-alive 5'),
  workflow.replace('--timeout-keep-alive 60','--timeout-keep-alive 600'),
  workflow.replace('  admin-readonly:\n','  unrelated-job:\n'),
  workflow+'\n# --timeout-keep-alive 60\n',
  workflow.replace('--host 127.0.0.1','--host 0.0.0.0'),
 ])assert.throws(()=>verify(changed));
});

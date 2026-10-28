"""Portable full149 source-test handoff. No tests run without explicit --run."""
from pathlib import Path
import argparse,hashlib,json,os,re,shutil,subprocess,tempfile,time
P=Path(__file__).resolve().parent;REPO=P.parents[1];FE=REPO/'frontend'
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def need(ok,msg):
 if not ok:raise SystemExit(msg)
a=argparse.ArgumentParser();a.add_argument('--baseline-frontend',type=Path,required=True);a.add_argument('--run',action='store_true');a.add_argument('--output',type=Path);args=a.parse_args()
B=args.baseline_frontend.resolve();need(B.name=='frontend' and B.is_dir(),'Supply verified baseline source/frontend, not the current checkout')
for n,h in read(P/'baseline-801-map.json').items():
 q=B.parent/n;need(q.is_file()and not q.is_symlink()and sha(q)==h,'Baseline801 missing/drift: '+n)
entries=read(P/'entrypoints-149.json');need(len(entries)==149 and len(set(entries))==149,'149 entrypoint inventory required')
need(sorted(entries)==sorted(str(q.relative_to(FE))for q in (FE/'tests').glob('*.test.cjs')),'Current149 entrypoint list differs; do not skip or auto-update')
manifest=read(P/'manifest.json');need(len(manifest['files'])==33,'Wrong support count')
# Validate every collision before writing any fixture; never overwrite different bytes.
for n,row in manifest['files'].items():
 source=P/'files'/n;target=FE/n
 need(source.is_file()and not source.is_symlink()and sha(source)==row['sha256'],'Historical fixture drift: '+n)
 need(not target.is_symlink(),'Fixture symlink forbidden: '+n)
 if target.exists():need(target.is_file()and sha(target)==row['sha256'],'Refusing different existing fixture: '+n)
 for ancestor in target.parents:
  if ancestor==FE:break
  need(not ancestor.is_symlink(),'Fixture ancestor symlink forbidden')
node=shutil.which('node');need(bool(node),'Node not installed; use project-supported pinned runtime/dependencies')
need((FE/'node_modules/typescript').exists(),'Install project dependencies from lockfile before running')
print('Admission passed: baseline801,149 entrypoint paths,33 immutable support files. Test bodies NOT RUN.')
if not args.run:raise SystemExit(0)
need(args.output is not None,'--output fresh directory required with --run')
out=args.output.resolve();need(not out.exists(),'Refusing existing/uncertain result directory; inspect it rather than blindly rerun');out.mkdir(parents=True)
for n,row in manifest['files'].items():
 target=FE/n
 if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(P/'files'/n,target)
 need(sha(target)==row['sha256'],'Installed fixture mismatch')
command=[node,'--test','--test-concurrency=1','--test-reporter=tap',*entries]
proof={'status':'RUNNING','entrypoints':149,'command':command,'test_count':'NOT_YET_MEASURED','support_files':33,'baseline_files':801,'network_guard':'PROCESS_LOCAL_HTTP_NET_TLS_DNS_FETCH_BLOCK; attempts not measured; not OS isolation','limits':'Source unit/contracts only; no real browser, backend aggregate, PostgreSQL, provider or production build claim.'}
def persist():(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
persist();start=time.monotonic()
try:
 with tempfile.TemporaryDirectory(prefix='hiring-test-home-')as home:
  env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'HOME':home,'CI':'1','NEXT_TELEMETRY_DISABLED':'1','NODE_OPTIONS':'--max-old-space-size=2048 --require='+str(P/'network-block.cjs'),'BASELINE_FRONTEND':str(B),'BACKEND_SOURCE':str(REPO/'backend')}
  with(out/'tests.tap').open('wb')as log:rc=subprocess.run(command,cwd=FE,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1200).returncode
 text=(out/'tests.tap').read_text();counts={k:int(re.findall('^# '+k+r' (\d+)$',text,re.M)[-1])for k in ['tests','pass','fail','cancelled','skipped','todo']if re.findall('^# '+k+r' (\d+)$',text,re.M)}
 need(rc==0 and set(counts)=={'tests','pass','fail','cancelled','skipped','todo'}and counts['tests']==counts['pass']and counts['tests']>0 and all(counts[k]==0 for k in ['fail','cancelled','skipped','todo']),'Failed/incomplete aggregate; retain full output')
 for n,row in manifest['files'].items():need(sha(FE/n)==row['sha256'],'Post-run fixture drift')
 proof.update(status='PASS_SOURCE_TESTS_ONLY',exit_code=rc,counts=counts,test_count=counts['tests'])
except BaseException as exc:proof.update(status='FAIL_OR_INTERRUPTED',error=str(exc));raise
finally:proof['elapsed_seconds']=round(time.monotonic()-start,3);persist()

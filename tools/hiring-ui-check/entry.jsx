import React from 'react';
import {createRoot} from 'react-dom/client';
import Register from '@/app/dashboard/hr/talent/hiring/page';
import Job from '@/app/dashboard/hr/talent/hiring/jobs/[jobId]/page';
import Candidate from '@/app/dashboard/hr/talent/hiring/candidates/[candidateId]/page';
import {useFixture,update} from './adapter';
function App(){const s=useFixture(),Page=location.pathname.includes('/jobs/')?Job:location.pathname.includes('/candidates/')?Candidate:Register;return <><aside style={{padding:12,background:'#fff4cc',color:'#111',borderBottom:'2px solid #554400'}}><strong>SYNTHETIC READ-ONLY HIRING CHECK — no real accounts or backend</strong><p>Actual Hiring route/component/hooks; synthetic session and routing adapters. Not full Dashboard/Next SSR.</p><label>Scenario <select value={s.scenario} onChange={e=>update({scenario:e.target.value,company:s.company==='A'?'B':'A'})}>{['normal','empty','long-content','error','unauthorized','malformed','slow','stale401'].map(v=><option key={v}>{v}</option>)}</select></label>{' '}<button onClick={()=>update({company:s.company==='A'?'B':'A'})}>Switch synthetic owner</button>{' '}<label><input type="checkbox" checked={s.denied} onChange={e=>update({denied:e.target.checked})}/> Deny HR access</label><p>External resume and legacy links are blocked. Native GET search, Back/Forward and detail links stay local. 401 login redirect is intercepted, not authenticated.</p><p role="status">{s.blocked.at(-1)||'No blocked navigation recorded.'}</p></aside><Page/></>;}
createRoot(document.getElementById('app')).render(<App/>);

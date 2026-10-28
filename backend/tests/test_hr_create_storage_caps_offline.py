"""Source-relative actual schema boundaries; no live persistence or HTTP auth proof."""
import ast
import copy
from pathlib import Path
import unittest
from pydantic import BaseModel, Field, ValidationError
TREE=ast.parse((Path(__file__).resolve().parents[1]/'app/api/v1/hr.py').read_text())
nodes=[copy.deepcopy(next(n for n in TREE.body if isinstance(n,ast.ClassDef)and n.name==name)) for name in ['JobCreate','CandidateCreate']]
NS={'__name__':__name__,'BaseModel':BaseModel,'Field':Field}
exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'<actual-hr-create-schemas>','exec'),NS)
class Tests(unittest.TestCase):pass
GROUPS=[('JobCreate',{'title':'ok'},dict(title=180,employment_type=32,location=180)),('CandidateCreate',dict(job_opening_id='job',full_name='ok',email='a@example.invalid'),dict(full_name=180,email=320,phone=80,resume_url=1000))]
for schema,base,fields in GROUPS:
 for field,cap in fields.items():
  def exact(self,schema=schema,base=base,field=field,cap=cap):self.assertEqual(getattr(NS[schema](**(base|{field:'x'*cap})),field),'x'*cap)
  def over(self,schema=schema,base=base,field=field,cap=cap):
   with self.assertRaises(ValidationError)as e:NS[schema](**(base|{field:'x'*(cap+1)}))
   self.assertEqual([x['loc']for x in e.exception.errors()],[(field,)])
  setattr(Tests,'test_'+schema+'_'+field+'_cap_accepted',exact);setattr(Tests,'test_'+schema+'_'+field+'_cap_plus_one_rejected',over)
 for field in fields:
  def empty(self,schema=schema,base=base,field=field):self.assertEqual(getattr(NS[schema](**(base|{field:''})),field),'')
  setattr(Tests,'test_'+schema+'_'+field+'_empty_policy_preserved',empty)
for schema,base,field in [('JobCreate',{'title':'ok'},'location'),('CandidateCreate',dict(job_opening_id='job',full_name='ok',email='ok'),'phone'),('CandidateCreate',dict(job_opening_id='job',full_name='ok',email='ok'),'resume_url')]:
 def nullable(self,schema=schema,base=base,field=field):
  self.assertIsNone(getattr(NS[schema](**base),field));self.assertIsNone(getattr(NS[schema](**(base|{field:None})),field))
 setattr(Tests,'test_'+schema+'_'+field+'_omitted_null_preserved',nullable)
def defaults(self):
 p=NS['JobCreate'](title='ok');self.assertEqual(p.employment_type,'full_time');self.assertEqual(p.openings,1);self.assertIsNone(p.department_id)
Tests.test_job_defaults_preserved=defaults
def flexible(self):
 self.assertEqual(NS['JobCreate'](title='  ',employment_type='custom').employment_type,'custom')
 p=NS['CandidateCreate'](job_opening_id='job',full_name='  ',email='not email syntax',resume_url='not url syntax');self.assertEqual(p.email,'not email syntax');self.assertEqual(p.resume_url,'not url syntax')
Tests.test_no_email_url_enum_or_whitespace_policy_added=flexible
if __name__=='__main__':unittest.main()

"""Portable CRM PATCH null contract. No database, router or filesystem fixtures."""
import unittest
from pydantic import ValidationError
from app.schemas import crm as after

GROUPS={'LeadStatusUpdate':['name','category','sort_order','is_default','is_active'],'LeadSourceUpdate':['name','sort_order','is_active'],'LeadUpdate':['contact_name','lead_type','probability_percent']}
class Tests(unittest.TestCase):pass

def add(name,fn):setattr(Tests,'test_'+name,fn)
for cls,fields in GROUPS.items():
 for field in fields:
  def test(self,cls=cls,field=field):
   with self.assertRaises(ValidationError)as err:getattr(after,cls)(**{field:None})
   self.assertEqual([e['loc']for e in err.exception.errors()],[(field,)])
  add(cls+'_'+field+'_explicit_null_rejected',test)
 def omission(self,cls=cls):self.assertEqual(getattr(after,cls)().model_dump(exclude_unset=True),{})
 add(cls+'_omission_preserved',omission)
for cls,field,value in [('LeadStatusUpdate','sort_order',0),('LeadStatusUpdate','is_default',False),('LeadStatusUpdate','is_active',False),('LeadSourceUpdate','sort_order',0),('LeadSourceUpdate','is_active',False),('LeadUpdate','probability_percent',0)]:
 def test(self,cls=cls,field=field,value=value):self.assertEqual(getattr(after,cls)(**{field:value}).model_dump(exclude_unset=True),{field:value})
 add(cls+'_'+field+'_zero_false_retained',test)
nullable={'LeadStatusUpdate':['color'],'LeadUpdate':['company_name','email','phone','whatsapp','website','country_code','state_region','city','address_line1','source_id','assigned_employee_id','estimated_value','currency','next_follow_up_at','notes']}
for cls,fields in nullable.items():
 for field in fields:
  def test(self,cls=cls,field=field):self.assertEqual(getattr(after,cls)(**{field:None}).model_dump(exclude_unset=True),{field:None})
  add(cls+'_'+field+'_intentional_nullable_clear_retained',test)
for cls,field in [('LeadStatusUpdate','name'),('LeadSourceUpdate','name')]:
 def test(self,cls=cls,field=field):self.assertEqual(getattr(after,cls)(**{field:'   '}).model_dump(exclude_unset=True),{field:'   '})
 add(cls+'_whitespace_policy_unchanged',test)
def blank_contact(self):
 with self.assertRaises(ValidationError):after.LeadUpdate(contact_name='   ')
add('LeadUpdate_contact_name_whitespace_rejected',blank_contact)
def status(self):self.assertEqual(after.LeadUpdate(status_id=None).model_dump(exclude_unset=True),{'status_id':None})
add('lead_status_control_schema_unchanged_handler_still_owns_rejection',status)
if __name__=='__main__':unittest.main(verbosity=2)

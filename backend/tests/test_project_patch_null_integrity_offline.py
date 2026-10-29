"""Pure payload validation only; no HTTP permission, SQL or transaction proof."""
from pathlib import Path
import importlib.util
import unittest
from pydantic import ValidationError
_PATH=Path(__file__).resolve().parents[1]/'app/schemas/project_execution.py'
_SPEC=importlib.util.spec_from_file_location('project_patch_null_schema_only',_PATH)
S=importlib.util.module_from_spec(_SPEC);_SPEC.loader.exec_module(S)

class ProjectPatchNullIntegrityTests(unittest.TestCase):
    def reject(self, cls, **payload):
        with self.assertRaises(ValidationError):cls(**payload)
    def test_milestone_status_explicit_null_rejected(self):self.reject(S.MilestoneUpdate,status=None)
    def test_milestone_sort_order_explicit_null_rejected(self):self.reject(S.MilestoneUpdate,sort_order=None)
    def test_task_priority_explicit_null_rejected(self):self.reject(S.TaskUpdate,priority=None)
    def test_task_status_explicit_null_rejected(self):self.reject(S.TaskUpdate,status=None)
    def test_credential_access_explicit_null_rejected(self):self.reject(S.CredentialUpdate,access_level=None)
    def test_milestone_omission_preserved(self):self.assertEqual(S.MilestoneUpdate().model_dump(exclude_unset=True),{})
    def test_task_omission_preserved(self):self.assertEqual(S.TaskUpdate().model_dump(exclude_unset=True),{})
    def test_credential_omission_preserved(self):self.assertEqual(S.CredentialUpdate().model_dump(exclude_unset=True),{})
    def test_milestone_valid_values_preserved(self):
        for status in ['planned','in_progress','completed','cancelled']:
            for order in [0,10000]:self.assertEqual(S.MilestoneUpdate(status=status,sort_order=order).model_dump(exclude_unset=True),{'sort_order':order,'status':status})
    def test_task_valid_values_preserved(self):
        for status in ['todo','in_progress','blocked','review','completed','cancelled']:
            for priority in ['low','normal','high','urgent']:self.assertEqual(S.TaskUpdate(status=status,priority=priority).model_dump(exclude_unset=True),{'priority':priority,'status':status})
    def test_credential_valid_values_preserved(self):
        for value in ['manager_only','team']:self.assertEqual(S.CredentialUpdate(access_level=value).model_dump(exclude_unset=True),{'access_level':value})
    def test_sort_order_range_preserved(self):
        for value in [-1,10001]:self.reject(S.MilestoneUpdate,sort_order=value)
    def test_milestone_unknown_status_rejected(self):self.reject(S.MilestoneUpdate,status='not-a-status')
    def test_task_unknown_enums_rejected(self):
        self.reject(S.TaskUpdate,status='not-a-status');self.reject(S.TaskUpdate,priority='not-a-priority')
    def test_credential_unknown_access_rejected(self):self.reject(S.CredentialUpdate,access_level='public')
    def test_milestone_nullable_clear_preserved(self):self.assertEqual(S.MilestoneUpdate(description=None,due_date=None).model_dump(exclude_unset=True),{'description':None,'due_date':None})
    def test_task_nullable_clears_preserved(self):
        values=dict(milestone_id=None,description=None,assignee_employee_id=None,planned_start_date=None,due_date=None,estimated_minutes=None);self.assertEqual(S.TaskUpdate(**values).model_dump(exclude_unset=True),values)
    def test_credential_nullable_clears_preserved(self):
        values=dict(username=None,url=None,notes=None,secret=None);self.assertEqual(S.CredentialUpdate(**values).model_dump(exclude_unset=True),values)
    def test_create_defaults_unchanged(self):
        self.assertEqual(S.MilestoneCreate(title='M').sort_order,0);self.assertEqual(S.TaskCreate(title='T').priority,'normal');self.assertEqual(S.CredentialCreate(name='C',secret='x').access_level,'manager_only')

if __name__=='__main__':unittest.main()

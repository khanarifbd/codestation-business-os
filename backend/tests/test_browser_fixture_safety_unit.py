"""Actual browser-QC safety gates, without importing the app or opening sockets."""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
def load_function(script, name, **namespace):
    tree=ast.parse((ROOT/'scripts'/script).read_text())
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    exec(compile(ast.Module(body=[node],type_ignores=[]),script,'exec'),namespace)
    return namespace[name]
class BrowserFixtureSafetyTests(unittest.TestCase):
    def gate(self,host='127.0.0.1',port=5432,database='codestation_business_os',environment='test',smtp='',dialect='postgresql'):
        settings=NS(environment=environment,smtp_host=smtp,smtp_configured=bool(smtp))
        engine=NS(url=NS(host=host,port=port,database=database,get_backend_name=lambda:dialect))
        return load_function('seed_qc_personal_client_browser.py','assert_browser_fixture_target',settings=settings,engine=engine,os=os)
    def test_explicit_github_disposable_target(self):
        with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','QC_BROWSER_FIXTURE':'1'},clear=True):self.gate()()
    def test_existing_dedicated_local_target(self):
        with patch.dict(os.environ,{},clear=True):self.gate(port=55433,database='business_os_qc_expanded20261022')()
    def test_ci_requires_both_explicit_flags(self):
        for env in ({},{'GITHUB_ACTIONS':'true'},{'QC_BROWSER_FIXTURE':'1'},{'GITHUB_ACTIONS':'false','QC_BROWSER_FIXTURE':'1'}):
            with self.subTest(env=env),patch.dict(os.environ,env,clear=True),self.assertRaises(AssertionError):self.gate()()
    def test_unsafe_targets_remain_rejected(self):
        with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','QC_BROWSER_FIXTURE':'1'},clear=True):
            for change in ({'environment':'production'},{'host':'db.example.com'},{'port':5433},{'database':'production'},{'smtp':'smtp.example.com'},{'dialect':'sqlite'}):
                with self.subTest(change=change),self.assertRaises(AssertionError):self.gate(**change)()
    def test_output_path_required_before_database_session(self):
        def forbidden_session():raise RuntimeError('database session must not start')
        run=load_function('seed_qc_personal_client_browser.py','main',assert_browser_fixture_target=lambda:None,app=NS(dependency_overrides={}),os=os,SessionLocal=forbidden_session)
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(AssertionError,'BROWSER_FIXTURE'):
            run()
    def mail_check(self,smtp=''):
        return load_function('verify_qc_hr_project_extended.py','verify_mail_disabled',assert_local_test_database=lambda:None,settings=NS(smtp_host=smtp,smtp_configured=bool(smtp)))
    def test_native_socket_methods_report_false_without_attribute_error(self):
        with patch.dict(os.environ,{},clear=True),contextlib.redirect_stdout(io.StringIO()) as out:self.mail_check()()
        self.assertFalse(json.loads(out.getvalue())['outbound_socket_guard'])
    def test_requested_socket_guard_still_fails_when_missing(self):
        with patch.dict(os.environ,{'PYTHONPATH':'/synthetic/no-network'},clear=True),self.assertRaises(AssertionError):self.mail_check()()
    def test_smtp_configured_still_fails(self):
        with self.assertRaises(AssertionError):self.mail_check('smtp.example.com')()
    def test_both_guard_methods_report_true(self):
        def guarded(*args):pass
        guarded.__module__='sitecustomize'
        fake=NS(socket=NS(connect=guarded,connect_ex=guarded))
        with patch.dict('sys.modules',{'socket':fake}),patch.dict(os.environ,{'PYTHONPATH':'no-network'},clear=True),contextlib.redirect_stdout(io.StringIO()) as out:self.mail_check()()
        self.assertTrue(json.loads(out.getvalue())['outbound_socket_guard'])
if __name__=='__main__':unittest.main()

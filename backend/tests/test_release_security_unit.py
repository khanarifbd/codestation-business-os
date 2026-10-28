"""Release security config/logging regressions. Synthetic; no DB or network."""
import asyncio
from datetime import datetime
import os
import socket
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy.engine import Engine
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import Settings
from app import main


class ReleaseSecurityUnits(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine, 'connect', side_effect=AssertionError('No DB in release unit tests')).start()
        patch.object(socket.socket, 'connect', side_effect=AssertionError('No network in release unit tests')).start()

    def settings(self, **values):
        with patch.dict(os.environ, {}, clear=True):
            return Settings(_env_file=None, **values)

    def test_deployed_missing_default_empty_short_and_placeholders_rejected(self):
        for environment in ['production', 'staging', ' Production ', 'STAGING']:
            for value in [None, '', 'short', 'development-only-change-me', 'development-only-' + 'x'*64, 'replace_with_a_long_random_jwt_secret']:
                with self.subTest(environment=environment, value=value):
                    kwargs={} if value is None else {'jwt_secret_key':value}
                    with self.assertRaises(ValidationError):self.settings(environment=environment, **kwargs)

    def test_local_development_and_explicit_test_configuration_unchanged(self):
        for environment in ['development', 'test']:
            self.assertEqual(self.settings(environment=environment).jwt_secret_key, 'development-only-change-me')
            self.assertEqual(self.settings(environment=environment,jwt_secret_key='local-only').jwt_secret_key,'local-only')

    def test_generated_shape_key_accepted_without_rewriting_or_rotation(self):
        key='Synthetic-test-only-7c9f7af516f46dd20c8abf8f15e17e72'
        for environment in ['production','staging']:
            self.assertEqual(self.settings(environment=environment,jwt_secret_key=key).jwt_secret_key,key)

    def test_hmac_minimum_lengths_match_configured_algorithm(self):
        for algorithm,minimum in [('HS256',32),('HS384',48),('HS512',64)]:
            with self.subTest(algorithm=algorithm):
                with self.assertRaises(ValidationError):self.settings(environment='production',jwt_algorithm=algorithm,jwt_secret_key='a'*(minimum-1))
                # Accepted length does not claim this deliberately weak repeated fixture has entropy.
                self.assertEqual(self.settings(environment='production',jwt_algorithm=algorithm,jwt_secret_key='a'*minimum).jwt_secret_key,'a'*minimum)

    def test_config_exception_string_does_not_disclose_supplied_secret(self):
        value='Synthetic-short-secret'
        with self.assertRaises(ValidationError) as error:self.settings(environment='production',jwt_secret_key=value)
        self.assertNotIn(value,str(error.exception))

    def request(self, matched=True):
        token='SYNTHETIC_POSSESSION_TOKEN_NOT_REAL'
        path='/api/v1/employee-invitations/'+token
        scope={'type':'http','method':'GET','path':path,'raw_path':path.encode(),'headers':[(b'x-request-id',b'synthetic-request-id')],'query_string':b'token=SYNTHETIC_QUERY_TOKEN','client':('127.0.0.1',1)}
        if matched:scope['route']=SimpleNamespace(path='/api/v1/employee-invitations/{token}')
        return Request(scope)

    def test_matched_route_template_hides_possession_token_and_query(self):
        self.assertEqual(main._observability_path(self.request()),'/api/v1/employee-invitations/{token}')

    def test_unmatched_route_has_constant_safe_label(self):
        self.assertEqual(main._observability_path(self.request(False)),'[unmatched]')

    def test_middleware_redacts_paths_preserves_status_and_request_id(self):
        async def run(matched):
            request=self.request(matched)
            async def response(_):return Response(status_code=201)
            with patch.object(main.performance_logger,'info') as info,patch.object(main.performance_logger,'warning') as warning:
                result=await main.request_observability(request,response)
            calls=info.call_args_list+warning.call_args_list
            self.assertEqual(len(calls),1)
            self.assertEqual(calls[0].args[2],'/api/v1/employee-invitations/{token}' if matched else '[unmatched]')
            self.assertNotIn('SYNTHETIC_POSSESSION_TOKEN',repr(calls))
            self.assertNotIn('SYNTHETIC_QUERY_TOKEN',repr(calls))
            self.assertEqual(result.status_code,201)
            self.assertEqual(result.headers['X-Request-ID'],'synthetic-request-id')
        asyncio.run(run(True));asyncio.run(run(False))

    def test_exception_telemetry_uses_same_safe_path(self):
        from starlette.exceptions import HTTPException
        async def run():
            with patch.object(main.logger,'error') as error:
                result=await main.safe_http_exception_handler(self.request(),HTTPException(500,main.VAULT_CONFIGURATION_ERROR))
            self.assertEqual(result.status_code,503)
            self.assertEqual(error.call_args.kwargs['extra']['path'],'/api/v1/employee-invitations/{token}')
        asyncio.run(run())


if __name__=='__main__':unittest.main()

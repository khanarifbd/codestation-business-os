"""Actual restore-script target selection; Docker is a fail-closed local stub.

No database, network, decryption or deployment is executed.
"""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RestoreComposeTargetTests(unittest.TestCase):
    def run_target(self, override=None, *, existing_override=True, default_exists=True, mode="--verify"):
        with tempfile.TemporaryDirectory(prefix='restore-target-') as directory:
            root = Path(directory)
            deployment = root / 'deployment'
            deployment.mkdir()
            script = deployment / 'restore.sh'
            script.write_text((ROOT / 'deployment/restore.sh').read_text())
            default = deployment / 'docker-compose.yml'
            if default_exists:
                default.write_text('services: {}\n')
            selected = root / 'isolated target' / 'compose.yml'
            selected.parent.mkdir()
            if existing_override:
                selected.write_text('services: {}\n')
            env_file = root / 'synthetic.env'
            env_file.write_text('POSTGRES_USER=qa_user\nPOSTGRES_DB=qa_db\n'
                                'COMPOSE_PROJECT_NAME=qa-isolated\n'
                                'BACKUP_ENCRYPTION_KEY=synthetic-test-only\n')
            archive = root / 'synthetic.enc'
            archive.write_text('not-an-archive; must never be decrypted')
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            log = root / 'docker-arguments.json'
            docker = bin_dir / 'docker'
            docker.write_text(f'#!{sys.executable}\nimport json, sys\n'
                              f'from pathlib import Path\nPath({str(log)!r}).write_text(json.dumps(sys.argv[1:]))\n'
                              'sys.exit(73)\n')
            docker.chmod(0o700)
            env = {'PATH': str(bin_dir) + os.pathsep + os.defpath,
                   'BUSINESS_OS_ENV_FILE': str(env_file)}
            if override is not None:
                env['BUSINESS_OS_COMPOSE_FILE'] = str(selected) if override else ''
            result = subprocess.run([shutil.which('bash'), str(script), str(archive), mode],
                                    env=env, text=True, capture_output=True, timeout=10)
            args = json.loads(log.read_text()) if log.exists() else None
            return result, args, str(default), str(selected), str(env_file)

    def assert_first_call(self, args, compose, env_file):
        self.assertEqual(args, ['compose', '-p', 'qa-isolated', '--env-file', env_file,
                                '-f', compose, 'up', '-d', 'postgres'])

    def test_explicit_isolated_compose_is_used_without_default_fallback(self):
        result, args, _, selected, env_file = self.run_target(True, default_exists=False)
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assert_first_call(args, selected, env_file)

    def test_missing_override_fails_before_any_docker_call(self):
        result, args, _, selected, _ = self.run_target(True, existing_override=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(args)
        self.assertIn('Missing ' + selected, result.stderr)

    def test_unset_override_preserves_default_compose(self):
        result, args, default, _, env_file = self.run_target()
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assert_first_call(args, default, env_file)

    def test_empty_override_preserves_default_compose(self):
        result, args, default, _, env_file = self.run_target(False)
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assert_first_call(args, default, env_file)

    def test_apply_rejects_custom_compose_before_any_docker_call(self):
        result, args, _, _, _ = self.run_target(True, mode='--apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(args)
        self.assertIn('override is supported only with --verify', result.stderr)

    def test_default_apply_target_selection_is_retained(self):
        # Stop at the first Docker stub call; this does not test an actual apply.
        result, args, default, _, env_file = self.run_target(mode='--apply')
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assert_first_call(args, default, env_file)

    def test_restore_table_check_preserves_compose_array_arguments(self):
        source = (ROOT / 'deployment/restore.sh').read_text()
        statements = re.findall(r'^restored_users_table=.*?^if grep', source, re.MULTILINE | re.DOTALL)
        self.assertEqual(len(statements), 1)
        statement = statements[0].removesuffix('if grep')
        with tempfile.TemporaryDirectory(prefix='restore query ') as directory:
            root = Path(directory)
            stub = root / 'docker stub.py'
            log = root / 'args.json'
            stub.write_text('import json, sys\nfrom pathlib import Path\n'
                            + f'Path({str(log)!r}).write_text(json.dumps(sys.argv[1:]))\n'
                            + 'print("t")\n')
            compose = str(root / 'isolated target.yml')
            env_file = str(root / 'synthetic env')
            bash = 'set -Eeuo pipefail\nCOMPOSE=("$1" "$2" compose -p qa --env-file "$3" -f "$4")\n'
            bash += 'POSTGRES_USER=qa_user\nscratch_db=qa_scratch\n' + statement
            bash += 'printf "%s" "$restored_users_table"\n'
            result = subprocess.run([shutil.which('bash'), '-c', bash, 'restore-check',
                                     sys.executable, str(stub), env_file, compose],
                                    env={'PATH': os.defpath}, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, 't')
            self.assertEqual(json.loads(log.read_text()),
                             ['compose', '-p', 'qa', '--env-file', env_file, '-f', compose,
                              'exec', '-T', 'postgres', 'psql', '-U', 'qa_user', '-d',
                              'qa_scratch', '-Atc', "SELECT to_regclass('public.users') IS NOT NULL;"])

    def test_missing_default_fails_before_any_docker_call(self):
        result, args, default, _, _ = self.run_target(default_exists=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(args)
        self.assertIn('Missing ' + default, result.stderr)


if __name__ == '__main__':
    unittest.main()

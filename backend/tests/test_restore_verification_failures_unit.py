"""Full restore --verify control flow with synthetic encrypted archives.

Docker is a fail-closed argument-checking stub. Real tar/openssl are used only on
private temporary synthetic files; no PostgreSQL, Docker or network is used.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RestoreVerificationFailureTests(unittest.TestCase):
    def verify(self, case='valid'):
        with tempfile.TemporaryDirectory(prefix='restore verify ') as directory:
            root = Path(directory)
            deployment = root / 'deployment'
            deployment.mkdir()
            script = deployment / 'restore.sh'
            script.write_text((ROOT / 'deployment/restore.sh').read_text())
            compose = root / 'isolated compose.yml'
            compose.write_text('services: {}\n')
            env_file = root / 'synthetic.env'
            env_file.write_text('POSTGRES_USER=qa_user\nPOSTGRES_DB=qa_db\n'
                                'COMPOSE_PROJECT_NAME=qa-isolated\n'
                                'BACKUP_ENCRYPTION_KEY=synthetic-test-only\n')
            uploads = io.BytesIO()
            with tarfile.open(fileobj=uploads, mode='w:gz') as tar:
                data = b'synthetic upload'
                info = tarfile.TarInfo('example.txt')
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            bundle = root / 'bundle.tar.gz'
            with tarfile.open(bundle, mode='w:gz') as tar:
                members = {'database.dump': b'synthetic dump, validated by stub only',
                           'uploads.tar.gz': uploads.getvalue(),
                           'manifest.txt': b'alembic_version=0096_payroll_policy\n'}
                if case == 'missing_manifest':
                    del members['manifest.txt']
                if case == 'corrupt_uploads':
                    members['uploads.tar.gz'] = b'not gzip'
                for name, data in members.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
            archive = root / 'backup.tar.gz.enc'
            key = 'wrong-synthetic-key' if case == 'wrong_key' else 'synthetic-test-only'
            subprocess.run([shutil.which('openssl'), 'enc', '-aes-256-cbc', '-salt', '-pbkdf2',
                            '-iter', '200000', '-pass', 'env:QA_KEY', '-in', str(bundle),
                            '-out', str(archive)], env={'PATH': os.defpath, 'QA_KEY': key},
                           check=True, capture_output=True, timeout=10)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            if case == 'bad_checksum':
                digest = '0' * 64
            Path(str(archive) + '.sha256').write_text(f'{digest}  {archive.name}\n')
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            log = root / 'docker.jsonl'
            stub = bin_dir / 'docker'
            prefix = ['compose', '-p', 'qa-isolated', '--env-file', str(env_file), '-f', str(compose)]
            stub.write_text(f'''#!{sys.executable}
import json, sys
from pathlib import Path
args = sys.argv[1:]
with Path({str(log)!r}).open('a') as f:
    f.write(json.dumps(args) + '\\n')
assert args[:7] == {prefix!r}, 'Unexpected Compose target'
a = args[7:]
if a == ['up', '-d', 'postgres']:
    sys.exit(0)
assert a[:3] == ['exec', '-T', 'postgres'], 'Unexpected Docker action'
a = a[3:]
assert a[0] in ['pg_isready', 'pg_restore', 'createdb', 'dropdb', 'psql'], 'Unexpected service command'
if a[0] == 'pg_restore':
    sys.stdin.buffer.read()
    if '--list' not in a and {case!r} == 'restore_failure':
        sys.exit(42)
if a[0] == 'psql':
    print('f' if {case!r} == 'missing_users' else 't')
sys.exit(0)
''')
            stub.chmod(0o700)
            temp = root / 'temp'
            temp.mkdir()
            result = subprocess.run([shutil.which('bash'), str(script), str(archive), '--verify'],
                env={'PATH': str(bin_dir) + os.pathsep + os.defpath,
                     'BUSINESS_OS_ENV_FILE': str(env_file), 'BUSINESS_OS_COMPOSE_FILE': str(compose),
                     'TMPDIR': str(temp)}, capture_output=True, text=True, timeout=15)
            calls = [json.loads(line)[7:] for line in log.read_text().splitlines()]
            self.assertEqual(list(temp.iterdir()), [], 'Temporary verification files leaked')
            self.assertTrue(all(c[0] in ['up', 'exec'] for c in calls))
            return result, calls

    def assert_no_database_restore(self, calls):
        self.assertFalse(any('createdb' in c for c in calls))
        self.assertFalse(any('dropdb' in c for c in calls))

    def assert_scratch_cleaned(self, calls):
        creates = [c for c in calls if 'createdb' in c]
        drops = [c for c in calls if 'dropdb' in c]
        self.assertEqual(len(creates), 1)
        self.assertEqual(len(drops), 1)
        self.assertTrue(creates[0][-1].startswith('business_os_restore_verify_'))
        self.assertEqual(creates[0][-1], drops[0][-1])

    def test_valid_synthetic_archive_control_flow(self):
        result, calls = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Backup restore verification passed.', result.stdout)
        self.assert_scratch_cleaned(calls)

    def test_wrong_key_stops_before_database_creation(self):
        result, calls = self.verify('wrong_key')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('verification passed', result.stdout)
        self.assert_no_database_restore(calls)

    def test_corrupt_checksum_stops_before_database_creation(self):
        result, calls = self.verify('bad_checksum')
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_database_restore(calls)

    def test_missing_manifest_stops_before_database_creation(self):
        result, calls = self.verify('missing_manifest')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing manifest.txt', result.stderr)
        self.assert_no_database_restore(calls)

    def test_corrupt_upload_archive_stops_before_database_creation(self):
        result, calls = self.verify('corrupt_uploads')
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_database_restore(calls)

    def test_database_restore_failure_cleans_scratch_database(self):
        result, calls = self.verify('restore_failure')
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertNotIn('verification passed', result.stdout)
        self.assert_scratch_cleaned(calls)

    def test_missing_restored_users_cleans_scratch_database(self):
        result, calls = self.verify('missing_users')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing the users table', result.stderr)
        self.assert_scratch_cleaned(calls)


if __name__ == '__main__':
    unittest.main()

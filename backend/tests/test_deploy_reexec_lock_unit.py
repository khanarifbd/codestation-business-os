"""Actual re-exec FD admission only; never executes deploy.sh or any services."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DeployReexecLockTests(unittest.TestCase):
    def guard(self):
        source = (ROOT / 'deployment/deploy.sh').read_text()
        matches = re.findall(
            r'if \[\[ "\$\{BUSINESS_OS_DEPLOY_REEXEC:-0\}" == "1" \]\]; then\n'
            r'(  \[\[ -e [^\n]+\n)else\n', source)
        self.assertEqual(len(matches), 1, 'Expected exactly one actual re-exec admission guard')
        return matches[0]

    def run_guard(self, inherited):
        bash = shutil.which('bash')
        self.assertIsNotNone(bash, 'bash is required for the deployment shell contract')
        # The deployment target is Linux. Fail explicitly rather than silently
        # claiming coverage on hosts without its /proc FD interface.
        self.assertTrue(Path('/proc/self/fd').is_dir(), 'Linux /proc FD interface required')
        with tempfile.TemporaryDirectory(prefix='deploy-fd-unit-') as directory:
            root = Path(directory)
            child = root / 'guard.sh'
            child.write_text('set -Eeuo pipefail\nfail() { printf "%s\\n" "$*" >&2; exit 1; }\n'
                             + self.guard() + 'printf "admission-passed\\n"\n')
            # A fresh shell controls FD9, then execs a second shell just as the
            # deployment re-exec does. No flock, global lock, git or Docker call.
            setup = 'exec 9>"$1"' if inherited else 'exec 9>&-'
            command = setup + '\nexec "$2" "$3"'
            return subprocess.run(
                [bash, '-c', command, 'fd-fixture', str(root / 'fixture.lock'), bash, str(child)],
                env={'PATH': os.defpath}, capture_output=True, text=True,
                timeout=10, check=False, close_fds=True)

    def test_actual_guard_accepts_fd9_inherited_across_exec(self):
        result = self.run_guard(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'admission-passed\n')

    def test_actual_guard_rejects_missing_fd9(self):
        result = self.run_guard(False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Deployment re-exec lost its deployment lock', result.stderr)
        self.assertNotIn('admission-passed', result.stdout)


if __name__ == '__main__':
    unittest.main()

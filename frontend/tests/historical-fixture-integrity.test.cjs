/** Original artifacts must never silently become a copy of the current app. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const provenance = require('../evidence/recovered-fixtures-provenance.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [group, directory] of [['support', root], ['baseline', path.resolve(root, provenance.baseline.fixture_root)]]) {
  test(`sealed historical ${group} inputs match their original SHA256 manifest`, () => {
    const entries = Object.entries(provenance[group].files);
    assert.ok(entries.length > 0, 'Historical inventory must not be empty');
    for (const [relative, expected] of entries) {
      assert.match(expected, /^[a-f0-9]{64}$/);
      const filename = path.resolve(directory, relative);
      assert.ok(filename.startsWith(directory + path.sep), 'Fixture path stays inside its declared root');
      assert.equal(sha256(fs.readFileSync(filename)), expected, relative);
    }
  });
}

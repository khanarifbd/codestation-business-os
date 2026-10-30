// Exact reviewed phase-2 deltas only: restore them before the older immutable
// redesign contract checks. Unrelated actions, payloads and permissions remain guarded.
const assert = require('node:assert/strict');
const changes = require('./reviewed-clients-revision.json');
function restorePriorClients(file, source) {
  for (const [before, after] of changes[file] ?? []) {
    assert.ok(after.length > 0, `Reviewed hunk needs context: ${file}`);
    assert.equal(source.split(after).length - 1, 1, `Expected one exact reviewed Clients hunk: ${file}`);
    source = source.replace(after, before);
  }
  return source;
}

const submodules = require('./reviewed-client-submodules.json');
function restoreClientSubmodules(file, source) {
  for (const [before, after] of submodules[file] ?? []) {
    assert.equal(source.split(after).length - 1, 1, `Expected one exact reviewed Clients submodule hunk: ${file}`);
    source = source.replace(after, before);
  }
  return source;
}
exports.restorePriorClients = restorePriorClients;
exports.restoreClientSubmodules = restoreClientSubmodules;
exports.restoreReviewedClients = (file, source) => restorePriorClients(file, restoreClientSubmodules(file, source));

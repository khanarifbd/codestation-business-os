const assert = require('node:assert/strict');
const original = '<div className="workspace-shell min-h-screen bg-[var(--app-canvas)] text-neutral-950 lg:flex">';
const reviewed = '<div className={cn("workspace-shell min-h-screen bg-[var(--app-canvas)] text-neutral-950 lg:flex", pathname === "/dashboard" && !clientOnly && !employeeSelfService && "dashboard-design-a")}>';

// Restore only the explicitly reviewed root presentation marker. Existing hashes
// still certify all other routing, permissions, effects, links and lifecycle bytes.
function beforeDashboardDesignA(file, source) {
  if (file !== 'src/components/dashboard-shell.tsx') return source;
  assert.equal(source.split(reviewed).length - 1, 1, 'one exact Dashboard A root marker');
  assert.equal(source.split(original).length - 1, 0, 'no duplicate original shell root');
  return source.replace(reviewed, original);
}
module.exports = { beforeDashboardDesignA, original, reviewed };

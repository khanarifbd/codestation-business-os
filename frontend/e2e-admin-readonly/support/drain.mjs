// Test-harness lifecycle only: observe requests from start, not only response headers.
// Never retries, cancels, suppresses errors, or changes application traffic.
class DrainTimeout extends Error {}
export function requestDrain() {
  const active = new Set();
  let generation = 0;
  return {
    started(request) { if (new URL(request.url()).pathname.startsWith('/api/')) { active.add(request); generation++; } },
    settled(request) { if (active.delete(request)) generation++; },
    async wait(pendingResponses, { timeoutMs = 10_000, pollMs = 10, quietMs = 100 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let quietSince = null, observedGeneration = generation;
      for (;;) {
        if (Date.now() >= deadline) throw new DrainTimeout('Read-only API drain timed out before context teardown');
        // Short-lived requests between polls must also restart the quiet interval.
        if (generation !== observedGeneration) { observedGeneration = generation; quietSince = null; }
        if (active.size || pendingResponses.size) quietSince = null;
        else {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= quietMs) return;
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }
    },
  };
}
async function bounded(work, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DrainTimeout('Read-only teardown deadline exceeded');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new DrainTimeout('Read-only teardown deadline exceeded')), remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}
/** Execute cleanup even after drain/save failure; final evidence includes every failure.
 * The preparation and cleanup phases each have explicit absolute budgets. Timeout
 * stops waiting, not the underlying request: no retry or cancellation is injected.
 */
export async function finishReadOnlyBatch({ drain, pendingResponses, persist, close, reconcile, recordFailure, terminal }, { timeoutMs = 10_000, cleanupTimeoutMs = 2_000 } = {}) {
  const fail = (stage, reason) => recordFailure(`teardown_${stage}_${reason instanceof DrainTimeout ? 'timeout' : 'failed'}`);
  const deadline = Date.now() + timeoutMs;
  let stage = 'drain';
  try {
    await drain.wait(pendingResponses, { timeoutMs: deadline - Date.now() });
    reconcile();
    stage = 'snapshot';
    await bounded(persist, deadline);
    stage = 'drain';
    await drain.wait(pendingResponses, { timeoutMs: deadline - Date.now() });
  } catch (reason) { fail(stage, reason); }
  const cleanupDeadline = Date.now() + cleanupTimeoutMs;
  try { await bounded(close, cleanupDeadline); }
  catch (reason) { fail('close', reason); }
  try { await drain.wait(pendingResponses, { timeoutMs: cleanupDeadline - Date.now() }); }
  catch (reason) { fail('completion', reason); }
  try { reconcile(); }
  catch (reason) { fail('reconcile', reason); }
  terminal();
}

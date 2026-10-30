import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function boundedExit(exited, milliseconds) {
  let timer;
  try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export function portIsFree() {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 3000 });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

function ownedGroupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export async function startDevelopmentFrontend({ env, directory, batch, emit, spawnProcess = spawn,
  signalGroup = (pid, signal) => process.kill(-pid, signal), fetchPage = fetch,
  wait = sleep, waitExit = boundedExit, freePort = portIsFree, groupExists = ownedGroupExists }) {
  if (env.CI !== 'true' || env.ADMIN_SWEEP_RUNTIME !== 'development' || env.NODE_ENV === 'production') throw new Error('Explicit development fixture runtime required; no production spoofing');
  if (!await freePort()) throw new Error('Frontend port is already owned; refusing to replace another process');
  const fd = openSync(path.join(directory, `frontend-${batch}.log`), 'wx', 0o600);
  let child;
  try {
    child = spawnProcess(process.execPath, ['--max-old-space-size=6144', 'node_modules/next/dist/bin/next', 'dev', '--turbopack', '-H', '127.0.0.1', '-p', '3000'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), detached: true,
      stdio: ['ignore', fd, fd], env,
    });
  } finally { closeSync(fd); }
  let terminal = null, stopped = false;
  const exited = new Promise(resolve => {
    child.once('error', () => { terminal = 'spawn_failed'; resolve(); });
    child.once('exit', () => { terminal = 'exited'; resolve(); });
  });
  async function stop() {
    if (stopped) return;
    stopped = true;
    // A Next worker can outlive its CLI leader. The owned process group, not
    // only the leader's exit event, remains the cleanup boundary.
    if (child.pid && groupExists(child.pid)) {
      try { signalGroup(child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await waitExit(exited, 10_000);
      for (let attempt = 0; attempt < 10 && groupExists(child.pid); attempt++) await wait(100);
      if (groupExists(child.pid)) {
        try { signalGroup(child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await waitExit(exited, 5_000);
      }
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((!child.pid || !groupExists(child.pid)) && await freePort()) {
        emit({ event: 'frontend_stopped', runtime: 'development' }); return;
      }
      await wait(100);
    }
    throw new Error('Owned frontend group or port did not release; no next batch');
  }
  try {
    const deadline = Date.now() + 60_000;
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      if (terminal) throw new Error('Owned frontend exited before readiness');
      try {
        const response = await fetchPage('http://localhost:3000/login', { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          emit({ event: 'frontend_started', runtime: 'development', batch, v8_heap_limit_mb: 6144 });
          return { stop };
        }
      } catch { /* Bounded startup read only; never a business-action retry. */ }
      await wait(1000);
    }
    throw new Error('Development frontend readiness failed; no runtime fallback');
  } catch (error) { await stop(); throw error; }
}

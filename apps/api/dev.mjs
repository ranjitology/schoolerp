/**
 * Development runner for the API.
 *
 * `tsx`/esbuild does not emit `design:paramtypes` decorator metadata, which
 * NestJS dependency injection relies on. Running the API through `tsx watch`
 * therefore produces an app where every constructor injection is `undefined`.
 *
 * This launcher compiles with the real TypeScript compiler (which does emit
 * decorator metadata) and restarts Node when the compiled output changes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/lib/tsc.js');

const children = new Set();
let shuttingDown = false;

function run(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[dev] ${label} exited (${signal ?? code}); stopping API dev runner`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] compiling API (decorator metadata required for NestJS DI)');
const initial = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
if (initial.status !== 0) {
  console.error('[dev] initial TypeScript build failed');
  process.exit(initial.status ?? 1);
}

run('tsc --watch', [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']);
run('api', ['--watch', '--enable-source-maps', 'dist/main.js']);

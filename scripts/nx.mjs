import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = { ...process.env };
if (process.platform === 'win32') {
  // The checkout's absolute path exceeds Windows' plugin socket path limit.
  env.NX_ISOLATE_PLUGINS ??= 'false';
  env.NX_DAEMON ??= 'false';
}
const child = spawn(process.execPath, [require.resolve('nx/bin/nx.js'), ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

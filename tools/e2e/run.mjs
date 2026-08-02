import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { build, preview } from 'vite';

const repositoryRoot = process.cwd();
const gameRoot = resolve(repositoryRoot, 'apps/game');
const playwrightCli = resolve(repositoryRoot, 'node_modules/@playwright/test/cli.js');
const playwrightArguments = [playwrightCli, 'test', ...process.argv.slice(2)];

let previewServer;
let playwrightProcess;
let shuttingDown = false;

async function closePreviewServer() {
  const server = previewServer;
  previewServer = undefined;
  if (server === undefined || !server.httpServer.listening) return;
  server.httpServer.closeAllConnections?.();
  await new Promise((resolveClose, rejectClose) => {
    server.httpServer.close((error) => {
      if (error !== undefined && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

async function stopProcesses() {
  if (playwrightProcess !== undefined && !playwrightProcess.killed) {
    playwrightProcess.kill();
  }
  await closePreviewServer();
}

async function handleSignal() {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopProcesses();
  process.exitCode = 1;
}

process.once('SIGINT', () => void handleSignal());
process.once('SIGTERM', () => void handleSignal());

try {
  await build({ root: gameRoot });
  previewServer = await preview({
    root: gameRoot,
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  });

  const result = await new Promise((resolveResult, rejectResult) => {
    playwrightProcess = spawn(process.execPath, playwrightArguments, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    playwrightProcess.once('error', rejectResult);
    playwrightProcess.once('exit', (code, signal) => resolveResult({ code, signal }));
  });

  await closePreviewServer();
  if (result.signal !== null) process.exitCode = 1;
  else process.exitCode = result.code ?? 1;
} catch (error) {
  await stopProcesses().catch((closeError) => {
    process.stderr.write(`${String(closeError)}\n`);
  });
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
}

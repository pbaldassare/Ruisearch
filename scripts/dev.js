#!/usr/bin/env node
// Avvia API di lettura + Vite. Una sola console per sviluppare la dashboard.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const figli = [];

function avvia(comando, args, extra = {}) {
  const figlio = spawn(comando, args, {
    cwd: root,
    stdio: 'inherit',
    ...extra,
  });
  figli.push(figlio);
  figlio.on('exit', (code) => {
    if (code && code !== 0) {
      for (const altro of figli) {
        if (altro !== figlio && !altro.killed) altro.kill('SIGTERM');
      }
      process.exitCode = code;
    }
  });
  return figlio;
}

avvia(process.execPath, [join(root, 'scripts/api.js')]);
avvia('npm', ['run', 'dev', '--prefix', 'web']);

function ferma() {
  for (const figlio of figli) {
    if (!figlio.killed) figlio.kill('SIGTERM');
  }
}

process.on('SIGINT', ferma);
process.on('SIGTERM', ferma);

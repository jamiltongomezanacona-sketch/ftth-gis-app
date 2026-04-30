/**
 * Comprueba sintaxis JS/MJS del servidor, scripts de mantenimiento y cliente (sin ejecutarlos).
 */
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} dir */
async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'vendor') continue;
      await walk(p);
    } else if (
      e.isFile() &&
      (e.name.endsWith('.js') || e.name.endsWith('.mjs')) &&
      !e.name.endsWith('.min.js')
    ) {
      execFileSync(process.execPath, ['--check', p], {
        stdio: 'inherit',
        cwd: root
      });
    }
  }
}

for (const rel of ['server', 'scripts', 'public/js']) {
  await walk(join(root, rel));
}
console.log('[ci-syntax] OK');

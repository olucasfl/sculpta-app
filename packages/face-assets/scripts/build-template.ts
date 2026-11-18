// Gera dist/template-head.glb e copia para o web (public/models) e para o worker (assets).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTemplateGlb } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const glb = buildTemplateGlb();
const targets = [
  join(root, 'dist', 'template-head.glb'),
  join(root, '..', '..', 'apps', 'web', 'public', 'models', 'template-head.glb'),
  join(root, '..', '..', 'services', 'worker', 'assets', 'template-head.glb'),
];
for (const t of targets) {
  mkdirSync(dirname(t), { recursive: true });
  writeFileSync(t, glb);
}
console.log(`[face-assets] template-head.glb (${(glb.byteLength / 1024).toFixed(0)} KB) gerado`);

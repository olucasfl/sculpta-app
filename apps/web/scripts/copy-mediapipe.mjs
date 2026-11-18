// Serve o WASM do MediaPipe pelo próprio app (sem CDN de terceiros).
// Com --download-model, baixa também o modelo oficial face_landmarker.task para public/models.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dst = join(root, 'public', 'mediapipe', 'wasm');
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}

if (process.argv.includes('--download-model')) {
  const model = join(root, 'public', 'models', 'face_landmarker.task');
  const url = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  if (!existsSync(model)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao baixar o modelo: HTTP ${res.status}`);
    mkdirSync(dirname(model), { recursive: true });
    writeFileSync(model, Buffer.from(await res.arrayBuffer()));
  }
  console.log('[mediapipe] Modelo em public/models/face_landmarker.task');
}

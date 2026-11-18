import { SIMULATION_DISCLAIMER } from '@sim/contracts';
import type { ViewerHandle, ViewName } from './FaceViewer';

export const EXPORT_VIEWS: { id: 'FRONT' | 'THREE_QUARTER' | 'PROFILE'; label: string; view: ViewName }[] = [
  { id: 'FRONT', label: 'Frente', view: 'FRONT' },
  { id: 'THREE_QUARTER', label: '45°', view: 'LEFT_45' },
  { id: 'PROFILE', label: 'Perfil', view: 'LEFT_90' },
];

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao montar a imagem'));
    img.src = src;
  });

/**
 * Monta a prancha antes/depois (vistas em colunas) com a marca d'água obrigatória.
 * Não inclui nome do paciente nem dados pessoais.
 */
export async function buildExportImage(
  viewer: ViewerHandle,
  opts: { views: typeof EXPORT_VIEWS; title: string; demo: boolean },
): Promise<Blob> {
  const cellW = 520, cellH = 640, pad = 32, header = 96, footer = 72, label = 40;
  const cols = opts.views.length;
  const W = pad * 2 + cellW * cols + pad * (cols - 1);
  const H = header + (label + cellH) * 2 + pad + footer;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1d2327';
  ctx.font = '600 30px Inter, system-ui, sans-serif';
  ctx.fillText(opts.title, pad, 52);
  ctx.fillStyle = '#5b6670';
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillText(
    `${new Date().toLocaleDateString('pt-BR')}${opts.demo ? ' · modelo demonstrativo (não representa o paciente)' : ''}`,
    pad,
    80,
  );

  for (const [row, original] of [[0, true], [1, false]] as const) {
    const y0 = header + row * (label + cellH + pad / 2);
    ctx.fillStyle = '#1d2327';
    ctx.font = '600 20px Inter, system-ui, sans-serif';
    for (let c = 0; c < cols; c++) {
      const v = opts.views[c]!;
      const x0 = pad + c * (cellW + pad);
      ctx.fillText(`${original ? 'Antes' : 'Simulação'} · ${v.label}`, x0, y0 + 26);
      ctx.fillStyle = '#f6f6f3';
      ctx.fillRect(x0, y0 + label, cellW, cellH);
      const img = await loadImage(viewer.snapshot({ view: v.view, original, width: cellW, height: cellH }));
      ctx.drawImage(img, x0, y0 + label, cellW, cellH);
      ctx.fillStyle = '#1d2327';
    }
  }

  // Marca d'água diagonal + aviso no rodapé (planejamento §2).
  ctx.save();
  ctx.translate(W / 2, (header + H - footer) / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.fillStyle = 'rgba(29, 35, 39, 0.07)';
  ctx.font = '700 64px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SIMULAÇÃO ILUSTRATIVA', 0, 0);
  ctx.restore();
  ctx.fillStyle = '#a15c07';
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillText(SIMULATION_DISCLAIMER, pad, H - footer / 2 + 6);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao exportar'))), 'image/png'));
}

/** Miniatura JPEG da vista frontal para a lista de versões. */
export function thumbnail(viewer: ViewerHandle): string | undefined {
  const png = viewer.snapshot({ view: 'FRONT', original: false, width: 240, height: 300 });
  if (!png) return undefined;
  return png;
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

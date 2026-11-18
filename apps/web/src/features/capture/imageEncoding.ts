import { fitWithin } from './vision/analysis';

export interface EncodedPhoto {
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
}

/**
 * Redesenha a imagem num canvas e gera JPEG com lado maior de até 2048 px.
 * Reencodar descarta todos os metadados EXIF (inclusive localização).
 */
export async function encodeJpeg(source: CanvasImageSource, srcWidth: number, srcHeight: number, mirror = false): Promise<EncodedPhoto> {
  const { width, height } = fitWithin(srcWidth, srcHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador');
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a foto'))), 'image/jpeg', 0.9),
  );
  return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
}

/** Abre um arquivo respeitando a orientação EXIF (fotos de celular "deitadas"). */
export async function decodeFile(file: File): Promise<ImageBitmap> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Formato não suportado. Use JPEG, PNG ou WebP.');
  }
  if (file.size > 30 * 1024 * 1024) throw new Error('Arquivo grande demais (máx. 30 MB).');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível abrir a imagem.');
  }
}

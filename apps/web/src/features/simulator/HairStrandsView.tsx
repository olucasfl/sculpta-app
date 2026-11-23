import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildStrands, type PhotoImage, type StrandStyle } from './hairStrands';

/** Lê a textura das fotos do modelo (reduzida a 512 px); sem textura legível (ex.: testes), devolve null. */
function readPhoto(map: THREE.Texture | null | undefined): PhotoImage | null {
  try {
    const img = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!img || !img.width) return null;
    const w = 512;
    const h = Math.round((512 * img.height) / img.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null;
  }
}

interface Props {
  /** Malha da cabeça (com `_hair`, `position`, `normal` e índices). */
  head: THREE.Mesh;
  /** Cor média do cabelo (hex), medida na textura das fotos. */
  color: string;
  /** Fios por cm² (0 desliga). */
  density: number;
  /** Comprimento médio, em metros. */
  length: number;
  /** Altura dos olhos e plano da frente do rosto (metros); sem eles, a franja não é limitada. */
  eyeY?: number;
  faceZ?: number;
  style?: StrandStyle;
  photoDirection?: boolean;
  colorMix?: number;
}

/** Fios de cabelo sobre o couro cabeludo do modelo reconstruído; só nascem onde o `.glb` marca cabelo. */
export function HairStrands({ head, color, density, length, eyeY, faceZ, style, photoDirection, colorMix }: Props) {
  const geometry = useMemo(() => {
    const g = head.geometry;
    const hairAttr = g.getAttribute('_hair') as THREE.BufferAttribute | undefined;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const index = g.getIndex();
    if (!hairAttr || !pos || !nor || !index || density <= 0) return null;
    const hair = new Float32Array(hairAttr.count);
    for (let i = 0; i < hair.length; i++) hair[i] = hairAttr.getX(i); // getX devolve o valor já normalizado (0 a 1)
    const uvAttr = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const photo = uvAttr ? readPhoto((head.material as THREE.MeshStandardMaterial).map) : null;
    const b = new THREE.Color(color);
    const s = buildStrands(pos.array, nor.array, index.array, hair, {
      density,
      length,
      seed: 11,
      eyeY,
      faceZ,
      style,
      photoDirection,
      colorMix,
      ...(photo && uvAttr ? { photo, uv: uvAttr.array, base: [b.r, b.g, b.b] as [number, number, number] } : {}),
    });
    if (s.strands === 0) return null;
    const base = new THREE.Color(color);
    const colors = s.colors ?? new Float32Array(s.shade.length * 3);
    for (let i = 0; i < s.shade.length && !s.colors; i++) {
      colors[i * 3] = Math.min(1, base.r * s.shade[i]!);
      colors[i * 3 + 1] = Math.min(1, base.g * s.shade[i]!);
      colors[i * 3 + 2] = Math.min(1, base.b * s.shade[i]!);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return out;
  }, [head, color, density, length, eyeY, faceZ, style, photoDirection, colorMix]);

  const material = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 }), []);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

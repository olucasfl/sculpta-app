import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { followWeight, makeHairFollower, type Attachment } from './hairDeform';
import { buildStrands, mulberry32, type PhotoImage, type StrandPath, type StrandStyle } from './hairStrands';

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
  /** Fios por cm² do couro cabeludo coberto de cabelo. */
  density: number;
  /** Comprimento médio, em metros (só vale sem `style`). */
  length: number;
  /** Altura dos olhos e plano da frente do rosto (metros); sem eles, a franja não é limitada. */
  eyeY?: number;
  faceZ?: number;
  style?: StrandStyle;
  photoDirection?: boolean;
  colorMix?: number;
}

interface Built {
  geometry: THREE.BufferGeometry;
  attach: Attachment;
}

/**
 * Cabelo em muitos fios finos (linhas), cada um com curva própria, colados na cabeça e na cor da pessoa.
 * Nascem só onde o `.glb` marca cabelo e acompanham a cabeça quando ela é modelada.
 */
export function HairStrands({ head, color, density, length, eyeY, faceZ, style, photoDirection, colorMix }: Props) {
  const built = useMemo<Built | null>(() => {
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
    const base: [number, number, number] = [b.r, b.g, b.b];
    const maxLen = style ? Math.max(style.top, style.side, style.back) : length;
    const segments = style
      ? Math.min(26, Math.max(style.curl > 0.4 ? 12 : 8, Math.round(maxLen / 0.012)))
      : 6;
    const paths: StrandPath[] = [];
    const res = buildStrands(pos.array, nor.array, index.array, hair, {
      density,
      length,
      seed: 11,
      eyeY,
      faceZ,
      style,
      photoDirection,
      colorMix,
      segments,
      ...(photo && uvAttr ? { photo, uv: uvAttr.array, base } : {}),
      onStrand: (s) => paths.push(s),
    });
    if (paths.length === 0) return null;

    // pontos, índices dos segmentos, cor por ponto e vértice da cabeça a que cada ponto se prende
    const total = paths.reduce((a, p) => a + p.pts.length, 0);
    const position = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const idx: number[] = [];
    const attach: Attachment = { index: new Int32Array(total).fill(-1), weight: new Float32Array(total) };
    const rnd = mulberry32(31);
    let v = 0;
    for (const path of paths) {
      const n = path.pts.length;
      const c = path.rgb ?? base;
      const highlight = rnd() < 0.15 ? 1.25 : 1; // alguns fios mais claros (reflexos)
      const tone = (0.78 + 0.34 * rnd()) * highlight;
      let lastIdx = -1;
      for (let k = 0; k < n; k++) {
        const p = path.pts[k]!;
        position.set(p, v * 3);
        const t = k / Math.max(1, n - 1);
        const g0 = tone * (0.68 + 0.4 * t); // raiz mais escura, ponta mais clara
        colors[v * 3] = Math.min(1, c[0] * g0);
        colors[v * 3 + 1] = Math.min(1, c[1] * g0);
        colors[v * 3 + 2] = Math.min(1, c[2] * g0 * (highlight > 1 ? 0.9 : 1));
        const [i, d] = res.attach(p);
        if (i >= 0) {
          lastIdx = i;
          attach.index[v] = i;
          attach.weight[v] = followWeight(d);
        } else if (lastIdx >= 0) {
          attach.index[v] = lastIdx; // longe da pele: segue a última raiz, com pouco peso
          attach.weight[v] = 0.3;
        }
        if (k > 0) idx.push(v - 1, v);
        v++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(idx);
    return { geometry, attach };
  }, [head, color, density, length, eyeY, faceZ, style, photoDirection, colorMix]);

  // o cabelo acompanha a cabeça quando ela é modelada (sliders e pincel): o visualizador chama `hairSync` antes de cada desenho
  useEffect(() => {
    if (!built) return;
    const follow = makeHairFollower(head, [{ geometry: built.geometry, attr: 'position', attach: built.attach }]);
    head.userData.hairSync = follow;
    follow(false);
    return () => {
      if (head.userData.hairSync === follow) delete head.userData.hairSync;
    };
  }, [built, head]);

  const material = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true }), []);
  useEffect(() => () => built?.geometry.dispose(), [built]);
  useEffect(() => () => material.dispose(), [material]);

  if (!built) return null;
  return <lineSegments geometry={built.geometry} material={material} frustumCulled={false} />;
}

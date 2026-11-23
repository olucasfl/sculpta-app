import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildLocks } from './hairLocks';
import { followWeight, makeHairFollower, type Attachment } from './hairDeform';
import { createHairMaterial } from './hairMaterial';
import { buildStrands, type HeadShape, type PhotoImage, type StrandPath, type StrandStyle } from './hairStrands';

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
  /** Multiplicador da quantidade de mechas e fios (1 = padrão). */
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
  locks: THREE.BufferGeometry | null;
  fly: THREE.BufferGeometry | null;
  center: THREE.Vector3;
  attachLocks: Attachment | null;
  attachFly: Attachment | null;
}

/** Mechas (fitas com espessura, onda e brilho) mais alguns fios soltos, nascidos só onde o `.glb` marca cabelo. */
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
    const common = {
      length,
      seed: 11,
      eyeY,
      faceZ,
      style,
      photoDirection,
      colorMix,
      ...(photo && uvAttr ? { photo, uv: uvAttr.array, base } : {}),
    };

    // fios soltos (linhas finas, poucos): dão a borda macia
    let fly: THREE.BufferGeometry | null = null;
    let attachFly: Attachment | null = null;
    let attachLocks: Attachment | null = null;
    const lines = buildStrands(pos.array, nor.array, index.array, hair, { ...common, density: 2 * density });
    if (lines.strands > 0) {
      const colors = lines.colors ?? new Float32Array(lines.shade.length * 3);
      for (let i = 0; i < lines.shade.length && !lines.colors; i++) {
        colors[i * 3] = Math.min(1, b.r * lines.shade[i]!);
        colors[i * 3 + 1] = Math.min(1, b.g * lines.shade[i]!);
        colors[i * 3 + 2] = Math.min(1, b.b * lines.shade[i]!);
      }
      fly = new THREE.BufferGeometry();
      fly.setAttribute('position', new THREE.BufferAttribute(lines.positions, 3));
      fly.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const nv = lines.positions.length / 3;
      attachFly = { index: new Int32Array(nv).fill(-1), weight: new Float32Array(nv) };
      for (let v = 0; v < nv; v++) {
        const [i, d] = lines.attach([lines.positions[v * 3]!, lines.positions[v * 3 + 1]!, lines.positions[v * 3 + 2]!]);
        if (i >= 0) {
          attachFly.index[v] = i;
          attachFly.weight[v] = followWeight(d);
        }
      }
    }

    let locks: THREE.BufferGeometry | null = null;
    let headShape: HeadShape = lines.head;
    if (style) {
      const maxLen = Math.max(style.top, style.side, style.back);
      const meanLen = (style.top + style.side + style.back) / 3;
      const width = Math.min(0.011, Math.max(0.0035, meanLen * 0.06));
      const spacingCm = Math.max(0.25, width * 100 * 0.9);
      const perCm2 = (1 / (spacingCm * spacingCm)) * 2.6 * density;
      const wave = style.wave ?? 0;
      const segments =
        wave > 0.05 || style.curl > 0.3
          ? Math.min(32, Math.max(12, Math.round(maxLen / 0.014)))
          : Math.min(18, Math.max(6, Math.round(maxLen / 0.03)));
      const paths: StrandPath[] = [];
      const res = buildStrands(pos.array, nor.array, index.array, hair, {
        ...common,
        density: perCm2,
        lockMode: true,
        segments,
        onStrand: (s) => paths.push(s),
      });
      headShape = res.head;
      if (paths.length > 0) {
        const lg = buildLocks(paths, res.head, { base, wave, puff: style.puff, seed: 11, attach: res.attach });
        attachLocks = { index: lg.attachIndex, weight: lg.attachWeight };
        locks = new THREE.BufferGeometry();
        locks.setAttribute('position', new THREE.BufferAttribute(lg.position, 3));
        locks.setAttribute('tangent', new THREE.BufferAttribute(lg.tangent, 3));
        locks.setAttribute('side', new THREE.BufferAttribute(lg.side, 1));
        locks.setAttribute('along', new THREE.BufferAttribute(lg.along, 1));
        locks.setAttribute('info', new THREE.BufferAttribute(lg.info, 3));
        locks.setAttribute('aColor', new THREE.BufferAttribute(lg.color, 3));
        locks.setIndex(new THREE.BufferAttribute(lg.index, 1));
      }
    }
    if (!locks && !fly) return null;
    return { locks, fly, center: new THREE.Vector3(0, headShape.cy, headShape.cz), attachLocks, attachFly };
  }, [head, color, density, length, eyeY, faceZ, style, photoDirection, colorMix]);

  // o cabelo acompanha a cabeça quando ela é modelada (sliders e pincel): o visualizador chama `hairSync` antes de cada desenho
  useEffect(() => {
    if (!built) return;
    const targets = [
      ...(built.locks && built.attachLocks ? [{ geometry: built.locks, attr: 'position', attach: built.attachLocks }] : []),
      ...(built.fly && built.attachFly ? [{ geometry: built.fly, attr: 'position', attach: built.attachFly }] : []),
    ];
    const follow = makeHairFollower(head, targets);
    head.userData.hairSync = follow;
    follow(false);
    return () => {
      if (head.userData.hairSync === follow) delete head.userData.hairSync;
    };
  }, [built, head]);

  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }), []);
  const hairMaterial = useMemo(() => (built ? createHairMaterial(built.center) : null), [built]);
  useEffect(
    () => () => {
      built?.locks?.dispose();
      built?.fly?.dispose();
    },
    [built],
  );
  useEffect(() => () => lineMaterial.dispose(), [lineMaterial]);
  useEffect(() => () => hairMaterial?.dispose(), [hairMaterial]);

  if (!built) return null;
  return (
    <group>
      {built.locks && hairMaterial && <mesh geometry={built.locks} material={hairMaterial} frustumCulled={false} />}
      {built.fly && <lineSegments geometry={built.fly} material={lineMaterial} frustumCulled={false} />}
    </group>
  );
}

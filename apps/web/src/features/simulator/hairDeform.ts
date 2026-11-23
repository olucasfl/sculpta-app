import * as THREE from 'three';

/**
 * O cabelo acompanha a cabeça quando ela muda (sliders de região e pincel de modelagem).
 * Cada ponto do cabelo guarda o vértice da cabeça mais próximo e um peso (1 colado na pele, menos nas pontas soltas);
 * a cada mudança, o cabelo recebe o mesmo deslocamento que o vértice da cabeça recebeu (morph targets + escultura).
 */

/** Peso pelo qual um ponto do cabelo segue a cabeça, conforme a distância até a pele (m). */
export function followWeight(distance: number): number {
  const t = Math.max(0, Math.min(1, (distance - 0.015) / (0.07 - 0.015)));
  return 1 - 0.65 * t * t * (3 - 2 * t);
}

export interface Attachment {
  /** Vértice da cabeça de cada ponto (−1 = nenhum). */
  index: Int32Array;
  weight: Float32Array;
}

/** Calcula o deslocamento de cada vértice da cabeça (m) somando os morph targets ativos e a escultura. */
export function headDisplacement(head: THREE.Mesh, original: boolean, out: Float32Array): boolean {
  const g = head.geometry;
  const n = g.getAttribute('position').count;
  out.fill(0);
  if (original) return false;
  let any = false;
  const inf = head.morphTargetInfluences ?? [];
  const morphs = g.morphAttributes.position as THREE.BufferAttribute[] | undefined;
  const base = g.getAttribute('position') as THREE.BufferAttribute;
  const relative = g.morphTargetsRelative;
  if (morphs) {
    for (let m = 0; m < morphs.length; m++) {
      const w = inf[m] ?? 0;
      if (!w) continue;
      any = true;
      const a = morphs[m]!;
      for (let v = 0; v < n; v++) {
        out[v * 3] = out[v * 3]! + w * (a.getX(v) - (relative ? 0 : base.getX(v)));
        out[v * 3 + 1] = out[v * 3 + 1]! + w * (a.getY(v) - (relative ? 0 : base.getY(v)));
        out[v * 3 + 2] = out[v * 3 + 2]! + w * (a.getZ(v) - (relative ? 0 : base.getZ(v)));
      }
    }
  }
  const sc = g.getAttribute('aSculpt') as THREE.BufferAttribute | undefined;
  if (sc) {
    const arr = sc.array as ArrayLike<number>;
    for (let k = 0; k < n * 3; k++) {
      if (arr[k]) {
        out[k] = out[k]! + arr[k]!;
        any = true;
      }
    }
  }
  return any;
}

/**
 * Cria a função que move o cabelo: guarda as posições originais e, a cada chamada, soma o deslocamento da cabeça
 * (ponderado). Só recalcula quando algo mudou (sliders, escultura ou antes/depois).
 */
export function makeHairFollower(head: THREE.Mesh, targets: { geometry: THREE.BufferGeometry; attr: string; attach: Attachment }[]) {
  const n = head.geometry.getAttribute('position').count;
  const disp = new Float32Array(n * 3);
  const bases = targets.map((t) => Float32Array.from(t.geometry.getAttribute(t.attr).array as ArrayLike<number>));
  let lastKey = '';
  return (original: boolean) => {
    const sculptVersion = (head.geometry.getAttribute('aSculpt') as THREE.BufferAttribute | undefined)?.version ?? 0;
    const key = `${original ? 1 : 0}|${sculptVersion}|${(head.morphTargetInfluences ?? []).join(',')}`;
    if (key === lastKey) return;
    lastKey = key;
    headDisplacement(head, original, disp);
    targets.forEach((t, i) => {
      const attr = t.geometry.getAttribute(t.attr) as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const base = bases[i]!;
      const { index, weight } = t.attach;
      for (let v = 0; v < index.length; v++) {
        const a = index[v]!;
        const w = a < 0 ? 0 : weight[v]!;
        arr[v * 3] = base[v * 3]! + (a < 0 ? 0 : disp[a * 3]! * w);
        arr[v * 3 + 1] = base[v * 3 + 1]! + (a < 0 ? 0 : disp[a * 3 + 1]! * w);
        arr[v * 3 + 2] = base[v * 3 + 2]! + (a < 0 ? 0 : disp[a * 3 + 2]! * w);
      }
      attr.needsUpdate = true;
    });
  };
}

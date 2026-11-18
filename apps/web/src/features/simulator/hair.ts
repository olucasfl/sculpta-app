import * as THREE from 'three';

export interface HairParams {
  volume: number;
  length: number;
  hairline: number;
  /** Altura dos olhos no modelo; sem ela, supõe 58% da altura da cabeça. */
  eyeY?: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * "Molde" de cabelo: uma casca que acompanha o crânio. Escolhe as regiões de cima e de trás da cabeça
 * (a linha do cabelo é mais alta na frente e desce na nuca e nas laterais conforme o comprimento) e
 * afasta os vértices ao longo da normal. A espessura some perto da borda, para a casca se fundir ao couro
 * cabeludo. É aproximado de propósito: não são fios, e o formato vem de controles manuais ou das cores da foto.
 */
export function buildHairGeometry(head: THREE.BufferGeometry, p: HairParams): THREE.BufferGeometry | null {
  const pos = head.getAttribute('position');
  const nor = head.getAttribute('normal');
  const index = head.getIndex();
  if (!pos || !nor || !index) return null;

  head.computeBoundingBox();
  const box = head.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const thickness = 0.004 + p.volume * 0.012;

  // Alturas medidas a partir dos olhos (ou de 58% da altura): a linha do cabelo na frente fica entre os olhos e o
  // topo da cabeça; nas laterais e atrás desce conforme o comprimento. Assim nunca cobre olhos nem sobrancelhas.
  const top = box.max.y;
  const eyeY = p.eyeY ?? box.min.y + size.y * 0.58;
  const span = top - eyeY;
  const frontY = eyeY + span * (0.52 + p.hairline * 0.26);
  const sideY = eyeY + span * (0.42 - p.length * 0.2);
  const backY = eyeY + span * (0.2 - p.length * 1.6);
  const feather = Math.max(span * 0.22, size.y * 0.03);
  const v = new THREE.Vector3();
  const weight = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center).divide(size).multiplyScalar(2).normalize();
    // 0 = de lado, 1 = de frente, -1 = de trás
    const front = v.z;
    const threshold = front > 0 ? THREE.MathUtils.lerp(sideY, frontY, smooth(0.05, 0.9, front)) : THREE.MathUtils.lerp(sideY, backY, smooth(0, 0.6, -front));
    weight[i] = smooth(threshold, threshold + feather, pos.getY(i));
  }

  const keep: number[] = [];
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const weights: number[] = [];
  const idx: number[] = [];
  const add = (i: number) => {
    let n = remap.get(i);
    if (n === undefined) {
      n = remap.size;
      remap.set(i, n);
      const o = thickness * weight[i]!;
      positions.push(pos.getX(i) + nor.getX(i) * o, pos.getY(i) + nor.getY(i) * o, pos.getZ(i) + nor.getZ(i) * o);
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      weights.push(weight[i]!);
    }
    return n;
  };
  for (let f = 0; f < index.count; f += 3) {
    const a = index.getX(f), b = index.getX(f + 1), c = index.getX(f + 2);
    // Triângulos com algum peso: a borda fica com espessura ~0 e some no couro cabeludo.
    if (weight[a]! > 0.001 || weight[b]! > 0.001 || weight[c]! > 0.001) {
      if (weight[a]! + weight[b]! + weight[c]! > 0.02) keep.push(add(a), add(b), add(c));
    }
  }
  if (keep.length === 0) return null;
  idx.push(...keep);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('aWeight', new THREE.Float32BufferAttribute(weights, 1));
  g.setIndex(idx);
  return g;
}

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { followWeight, makeHairFollower } from './hairDeform';

function fakeHead() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.morphTargetsRelative = true;
  g.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array([0, 0, 0.1, 0, 0, 0.2, 0, 0, 0]), 3)];
  const sculpt = new THREE.BufferAttribute(new Float32Array(9), 3);
  g.setAttribute('aSculpt', sculpt);
  const head = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  head.morphTargetInfluences = [0];
  return { head, sculpt };
}

describe('cabelo acompanha a cabeça', () => {
  it('o peso cai com a distância da pele', () => {
    expect(followWeight(0.005)).toBe(1);
    expect(followWeight(0.2)).toBeCloseTo(0.35, 2);
    expect(followWeight(0.04)).toBeLessThan(1);
    expect(followWeight(0.04)).toBeGreaterThan(0.35);
  });

  it('segue morph targets e escultura, e volta ao original em "antes"', () => {
    const { head, sculpt } = fakeHead();
    const hair = new THREE.BufferGeometry();
    hair.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 5, 5, 5]), 3));
    const attach = { index: new Int32Array([0, 1, -1]), weight: new Float32Array([1, 0.5, 0]) };
    const follow = makeHairFollower(head, [{ geometry: hair, attr: 'position', attach }]);
    const pos = hair.getAttribute('position').array as Float32Array;

    head.morphTargetInfluences![0] = 1;
    follow(false);
    expect(pos[2]).toBeCloseTo(0.1); // vértice 0 sobe 0,1 em z com peso 1
    expect(pos[5]).toBeCloseTo(0.1); // vértice 1: 0,2 com peso 0,5
    expect(pos[8]).toBeCloseTo(5); // sem vértice: não mexe

    (sculpt.array as Float32Array)[0] = 0.05; // escultura empurra o vértice 0 em x
    sculpt.needsUpdate = true;
    follow(false);
    expect(pos[0]).toBeCloseTo(0.05);

    follow(true); // "antes": cabelo na posição original
    expect(pos[0]).toBeCloseTo(0);
    expect(pos[2]).toBeCloseTo(0);
  });
});

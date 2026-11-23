import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyMorphNames } from './morph';

describe('nomes dos morph targets', () => {
  it('mantém os nomes dos sliders mesmo com atributos de morph sem nome', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(9), 3), new THREE.BufferAttribute(new Float32Array(9), 3)];
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    expect(Object.keys(mesh.morphTargetDictionary ?? {})).toEqual(['0', '1']); // o que o three faz sozinho
    applyMorphNames(mesh, { 'lips.upperVolume': 0, 'chin.projection': 1 });
    expect(mesh.morphTargetDictionary).toEqual({ 'lips.upperVolume': 0, 'chin.projection': 1 });
    expect(mesh.morphTargetInfluences).toEqual([0, 0]);
  });
});

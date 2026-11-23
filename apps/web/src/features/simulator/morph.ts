import type * as THREE from 'three';

/**
 * Dá aos morph targets da malha os nomes dos sliders (`extras.targetNames` do .glb).
 *
 * O construtor da malha e `updateMorphTargets()` refazem o dicionário com nomes numéricos ("0", "1"...) porque os
 * atributos de morph do glTF não têm nome. Se os nomes forem copiados ANTES, ficam sobrescritos e todos os sliders
 * deixam de ter efeito (o simulador mostrava o rosto parado). Por isso os nomes entram por último.
 */
export function applyMorphNames(mesh: THREE.Mesh, names: Record<string, number> | undefined): void {
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = { ...(names ?? {}) };
  mesh.morphTargetInfluences = new Array(Object.keys(mesh.morphTargetDictionary).length).fill(0);
}

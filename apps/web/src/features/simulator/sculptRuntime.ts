import type { SculptData } from '@sim/contracts';
import * as THREE from 'three';
import {
  applyBrush,
  buildSculptMesh,
  decodeOffsets,
  encodeOffsets,
  StrokeHistory,
  updateNormalDeltas,
  type BrushParams,
} from './sculpt';

export interface SculptState {
  canUndo: boolean;
  canRedo: boolean;
  /** Há deslocamentos aplicados. */
  hasSculpt: boolean;
  /** Muda a cada traço, desfazer, refazer ou limpar (não ao carregar uma versão). */
  revision: number;
  /** Maior deslocamento da pele hoje, em milímetros (o limite por vértice é `MAX_OFFSET`). */
  maxMm: number;
}

export interface SculptRuntime {
  vertexCount: number;
  stamp(point: THREE.Vector3, params: BrushParams): void;
  endStroke(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  /** Aplica os deslocamentos de uma versão salva (ou zera, se `null`). */
  load(data: SculptData | null): void;
  encode(): SculptData | null;
  /** Mostra (1) ou esconde (0) a escultura: o "antes" usa 0. */
  setMix(value: number): void;
  patchMaterial(material: THREE.Material): void;
  state(): SculptState;
}

/**
 * Liga o motor do pincel (`sculpt.ts`) a uma geometria do three.js. Os deslocamentos viram dois atributos
 * extras por vértice (posição e normal) somados no vertex shader por `uSculptMix`. Não usa morph targets
 * de propósito: o three.js guarda os morph targets numa textura que NÃO se atualiza quando os dados mudam,
 * e reenviar essa textura a cada toque seria lento.
 */
export function createSculptRuntime(
  geometry: THREE.BufferGeometry,
  onChange: (s: SculptState) => void,
  invalidate: () => void,
): SculptRuntime | null {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!pos || !nor || !index) return null;

  const n = pos.count;
  const mesh = buildSculptMesh(Float32Array.from(pos.array as ArrayLike<number>), Float32Array.from(nor.array as ArrayLike<number>), index.array);
  const offsets = new Float32Array(n * 3);
  const normalDeltas = new Float32Array(n * 3);
  const aOffset = new THREE.BufferAttribute(offsets, 3).setUsage(THREE.DynamicDrawUsage);
  const aNormal = new THREE.BufferAttribute(normalDeltas, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aSculpt', aOffset);
  geometry.setAttribute('aSculptN', aNormal);

  const mix = { value: 1 };
  const history = new StrokeHistory();
  let revision = 0;

  const strokeAcc = new Float32Array(n);
  const maxLength = () => {
    let m = 0;
    for (let v = 0; v < n; v++) m = Math.max(m, Math.hypot(offsets[v * 3]!, offsets[v * 3 + 1]!, offsets[v * 3 + 2]!));
    return m;
  };
  const hasAny = () => {
    for (let k = 0; k < offsets.length; k++) if (offsets[k] !== 0) return true;
    return false;
  };
  const state = (): SculptState => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    hasSculpt: hasAny(),
    revision,
    maxMm: Math.round(maxLength() * 10000) / 10,
  });
  const touch = () => {
    aOffset.needsUpdate = true;
    aNormal.needsUpdate = true;
    invalidate();
  };
  const refreshNormals = (vertices: number[]) => {
    updateNormalDeltas(mesh, offsets, normalDeltas, vertices);
  };
  const emit = () => onChange(state());

  return {
    vertexCount: n,
    stamp(point, params) {
      const changed = applyBrush(mesh, offsets, [point.x, point.y, point.z], params, (vertices) => history.touch(offsets, vertices), strokeAcc);
      if (changed.length === 0) return;
      refreshNormals(changed);
      touch();
    },
    endStroke() {
      strokeAcc.fill(0); // o próximo traço tem o seu próprio teto
      history.endStroke();
      revision++;
      emit();
    },
    undo() {
      const changed = history.undo(offsets);
      if (!changed) return;
      refreshNormals(changed);
      revision++;
      touch();
      emit();
    },
    redo() {
      const changed = history.redo(offsets);
      if (!changed) return;
      refreshNormals(changed);
      revision++;
      touch();
      emit();
    },
    clear() {
      if (!hasAny()) return;
      // Limpar também pode ser desfeito: registra como um traço que zera tudo.
      const all: number[] = [];
      for (let v = 0; v < n; v++) if (offsets[v * 3] !== 0 || offsets[v * 3 + 1] !== 0 || offsets[v * 3 + 2] !== 0) all.push(v);
      history.touch(offsets, all);
      history.endStroke();
      offsets.fill(0);
      normalDeltas.fill(0);
      revision++;
      touch();
      emit();
    },
    load(data) {
      revision = 0;
      offsets.fill(0);
      normalDeltas.fill(0);
      history.clear();
      if (data) {
        const loaded = decodeOffsets(data, n);
        offsets.set(loaded);
        const touched: number[] = [];
        for (let v = 0; v < n; v++) if (offsets[v * 3] !== 0 || offsets[v * 3 + 1] !== 0 || offsets[v * 3 + 2] !== 0) touched.push(v);
        refreshNormals(touched);
      }
      touch();
      emit();
    },
    encode: () => encodeOffsets(offsets),
    setMix(value) {
      mix.value = value;
    },
    patchMaterial(material) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uSculptMix = mix;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec3 aSculpt;\nattribute vec3 aSculptN;\nuniform float uSculptMix;')
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal += aSculptN * uSculptMix;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aSculpt * uSculptMix;');
      };
      material.customProgramCacheKey = () => 'sculpta-sculpt-v1';
      material.needsUpdate = true;
    },
    state,
  };
}

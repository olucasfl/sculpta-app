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
  /** `zone`: pesos da zona do procedimento (o pincel só age onde há peso); null = sem restrição. */
  stamp(point: THREE.Vector3, params: BrushParams, zone?: ArrayLike<number> | null): void;
  endStroke(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  /** Aplica os deslocamentos de uma versão salva (ou zera, se `null`). */
  load(data: SculptData | null): void;
  encode(): SculptData | null;
  /**
   * Camada de pontos de aplicação (deslocamentos 3 floats por vértice, em m), somada ao pincel. Não entra no
   * desfazer do pincel; ao salvar, `encode()` guarda a soma (os pontos viram parte da modelagem da versão).
   */
  setLayer(layer: Float32Array | null): void;
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
  // `offsets` é só o pincel (tem desfazer); `layer` são os pontos; `display` = soma, o que vai para a tela
  const offsets = new Float32Array(n * 3);
  const layer = new Float32Array(n * 3);
  const display = new Float32Array(n * 3);
  const normalDeltas = new Float32Array(n * 3);
  const aOffset = new THREE.BufferAttribute(display, 3).setUsage(THREE.DynamicDrawUsage);
  const aNormal = new THREE.BufferAttribute(normalDeltas, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aSculpt', aOffset);
  geometry.setAttribute('aSculptN', aNormal);

  const mix = { value: 1 };
  const history = new StrokeHistory();
  let revision = 0;

  const strokeAcc = new Float32Array(n);
  let strokeTouched = false;
  const maxLength = () => {
    let m = 0;
    for (let v = 0; v < n; v++) m = Math.max(m, Math.hypot(display[v * 3]!, display[v * 3 + 1]!, display[v * 3 + 2]!));
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
    updateNormalDeltas(mesh, display, normalDeltas, vertices);
  };
  const syncDisplay = (vertices: number[]) => {
    for (const v of vertices) for (let c = 0; c < 3; c++) display[v * 3 + c] = offsets[v * 3 + c]! + layer[v * 3 + c]!;
  };
  const nonZero = (arr: Float32Array) => {
    const out: number[] = [];
    for (let v = 0; v < n; v++) if (arr[v * 3] !== 0 || arr[v * 3 + 1] !== 0 || arr[v * 3 + 2] !== 0) out.push(v);
    return out;
  };
  const emit = () => onChange(state());

  return {
    vertexCount: n,
    stamp(point, params, zone) {
      const changed = applyBrush(mesh, offsets, [point.x, point.y, point.z], params, (vertices) => history.touch(offsets, vertices), strokeAcc, zone);
      if (changed.length === 0) return;
      strokeTouched = true;
      syncDisplay(changed);
      refreshNormals(changed);
      touch();
    },
    endStroke() {
      strokeAcc.fill(0); // o próximo traço tem o seu próprio teto
      if (!strokeTouched) return; // traço fora da zona: nada mudou, não conta como alteração
      strokeTouched = false;
      history.endStroke();
      revision++;
      emit();
    },
    undo() {
      const changed = history.undo(offsets);
      if (!changed) return;
      syncDisplay(changed);
      refreshNormals(changed);
      revision++;
      touch();
      emit();
    },
    redo() {
      const changed = history.redo(offsets);
      if (!changed) return;
      syncDisplay(changed);
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
      display.set(layer);
      normalDeltas.fill(0);
      refreshNormals(nonZero(layer));
      revision++;
      touch();
      emit();
    },
    load(data) {
      revision = 0;
      offsets.fill(0);
      normalDeltas.fill(0);
      history.clear();
      if (data) offsets.set(decodeOffsets(data, n));
      for (let k = 0; k < display.length; k++) display[k] = offsets[k]! + layer[k]!;
      refreshNormals(nonZero(display));
      touch();
      emit();
    },
    setLayer(next) {
      const changed: number[] = [];
      for (let v = 0; v < n; v++) {
        for (let c = 0; c < 3; c++) {
          if (layer[v * 3 + c] !== (next ? next[v * 3 + c]! : 0)) {
            changed.push(v);
            break;
          }
        }
      }
      if (changed.length === 0) return;
      if (next) layer.set(next);
      else layer.fill(0);
      syncDisplay(changed);
      refreshNormals(changed);
      touch();
      emit();
    },
    encode: () => encodeOffsets(display),
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

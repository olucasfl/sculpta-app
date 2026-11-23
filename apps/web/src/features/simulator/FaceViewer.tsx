import { Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { FaceRegion, SculptData, SimulationParams } from '@sim/contracts';
import { forwardRef, Suspense, type ComponentRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_APPEARANCE, irisColor, skinColor, type Appearance } from './appearance';
import { BrowsAndLashes, Eyes, Hair } from './FaceExtras';
import { HairStrands } from './HairStrandsView';
import { distanceForZone, zoneBounds } from './zone';
import { resolveStyle, type DetectedHair, type HairModelId } from './hairStyles';
import type { BrushParams } from './sculpt';
import { createSculptRuntime, type SculptRuntime, type SculptState } from './sculptRuntime';
import { applySkinShader } from './skinShader';

export type CompareMode = 'off' | 'curtain' | 'side' | 'hold';
export type ViewName = 'FRONT' | 'LEFT_45' | 'RIGHT_45' | 'LEFT_90' | 'RIGHT_90';

/** Azimute da câmera por vista (+x = lado esquerdo do paciente). */
export const VIEW_AZIMUTH: Record<ViewName, number> = {
  FRONT: 0,
  LEFT_45: Math.PI / 4,
  RIGHT_45: -Math.PI / 4,
  LEFT_90: Math.PI / 2,
  RIGHT_90: -Math.PI / 2,
};

const TARGET = new THREE.Vector3(0, -0.02, 0.02);
const DISTANCE = 0.62;
const POLAR = Math.PI / 2 - 0.05;
const SKIN = new THREE.Color('#d6c0b0');
const ACCENT = new THREE.Color('#0f8f89');
// zona do procedimento escolhido: o tom multiplica a textura, então precisa ser claro e saturado para aparecer sobre a pele
const ZONE = new THREE.Color('#5ff0e0');
const REGION_TINT: Record<FaceRegion, string> = {
  nose: '#5b8def',
  lips: '#d9577a',
  chin: '#8b6fd6',
  jaw: '#3aa39a',
  malar: '#e09a3c',
  infraorbital: '#56a6d6',
  nasolabial: '#a3a33a',
  temple: '#c76bd0',
  masseter: '#d07a4e',
};
const REGIONS = Object.keys(REGION_TINT) as FaceRegion[];

export interface ModelInfo {
  kind: 'TEMPLATE' | 'RECONSTRUCTION';
  notice: string | null;
  vertices: number;
  sliders: string[];
  /** O .glb traz a textura das fotos do paciente (pele, olhos e cabelo vêm dela, não da aparência do painel). */
  textured: boolean;
  /** Estilo do cabelo lido na foto frontal (modelos reconstruídos novos). */
  hairStyle?: DetectedHair | null;
  /** Cor do cabelo lida da foto. */
  hairColor?: string | null;
  /** Deslocamento máximo real de cada slider neste rosto, em mm (modelos reconstruídos novos). */
  sliderMm?: Record<string, number> | null;
}

export interface ViewerHandle {
  /** Renderiza uma vista (antes ou depois) num PNG, sem mexer na tela. */
  snapshot(opts: { view: ViewName; original: boolean; width: number; height: number }): string;
  /** Deslocamentos do pincel para salvar na versão (`null` se não há escultura). */
  getSculpt(): SculptData | null;
  undoSculpt(): void;
  redoSculpt(): void;
  clearSculpt(): void;
}

interface Props {
  url: string;
  params: SimulationParams;
  highlight: FaceRegion | null;
  showRegions: boolean;
  wireframe: boolean;
  compare: CompareMode;
  curtain: number;
  showOriginal: boolean;
  view: ViewName;
  viewNonce: number;
  /** Zona do procedimento escolhido: a câmera se aproxima dela (muda a cada escolha, mesmo repetida). */
  focus?: { regions: FaceRegion[]; nonce: number } | null;
  onRegionPick: (region: FaceRegion) => void;
  onLoaded?: (info: ModelInfo) => void;
  /** Modo modelar: arrastar sobre o rosto (mouse, caneta, dedo) chama estes callbacks em vez de girar a câmera. */
  sculpt?: SculptHandlers;
  /** Pincel: arrastar sobre o rosto empurra, puxa, suaviza ou apaga a superfície (tem prioridade sobre `sculpt`). */
  brush?: Omit<BrushParams, 'pressure'>;
  /** Escultura de uma versão salva; recarrega quando `sculptNonce` muda. */
  sculptData?: SculptData | null;
  sculptNonce?: number;
  onSculptChange?: (state: SculptState) => void;
  /** Cor da pele, olhos, cabelo e modo leve. */
  appearance?: Appearance;
}

export interface SculptHandlers {
  start(region: FaceRegion, upperHalf: boolean): void;
  /** Deslocamento desde o último evento (px), pressão da caneta (1 = mouse/dedo) e posição na tela. */
  move(dx: number, dy: number, pressure: number, clientX: number, clientY: number): void;
  end(): void;
}

interface Shared {
  mesh: THREE.Mesh | null;
  current: number[];
  zeros: number[];
  sculpt: SculptRuntime | null;
  /** Cor da pele atual (a exportação usa a mesma, sem destaque de região). */
  skin: THREE.Color;
}

export const FaceViewer = forwardRef<ViewerHandle, Props>(function FaceViewer(props, ref) {
  const shared = useRef<Shared>({ mesh: null, current: [], zeros: [], sculpt: null, skin: new THREE.Color(SKIN) });
  const api = useRef<Pick<ViewerHandle, 'snapshot'> | null>(null);
  useImperativeHandle(ref, () => ({
    snapshot: (o) => api.current?.snapshot(o) ?? '',
    getSculpt: () => shared.current.sculpt?.encode() ?? null,
    undoSculpt: () => shared.current.sculpt?.undo(),
    redoSculpt: () => shared.current.sculpt?.redo(),
    clearSculpt: () => shared.current.sculpt?.clear(),
  }));

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      camera={{ fov: 30, near: 0.01, far: 10, position: [0, TARGET.y, DISTANCE] }}
      aria-label="Modelo 3D do rosto. No modo modelar, arraste sobre uma região para ajustá-la; no modo girar, arraste para girar. A roda aproxima."
      role="img"
      style={{ touchAction: 'none', cursor: 'grab' }}
    >
      <hemisphereLight args={['#ffffff', '#b9b2aa', 0.6]} />
      <directionalLight position={[0.4, 0.5, 0.8]} intensity={1.6} />
      <directionalLight position={[-0.6, 0.2, 0.4]} intensity={0.5} color="#dfe8ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 1, 3]} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-3, 0.5, 1]} rotation-y={Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[3, 0.5, 1]} rotation-y={-Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="ring" intensity={0.6} position={[0, 3, -2]} scale={2} />
      </Environment>
      <Suspense fallback={null}>
        <FaceModel {...props} shared={shared} />
      </Suspense>
      <Rig {...props} shared={shared} api={api} />
    </Canvas>
  );
});

function FaceModel({
  url,
  params,
  highlight,
  showRegions,
  wireframe,
  onRegionPick,
  onLoaded,
  sculpt,
  brush,
  sculptData,
  sculptNonce,
  onSculptChange,
  appearance,
  shared,
}: Props & { shared: React.RefObject<Shared> }) {
  const look = appearance ?? DEFAULT_APPEARANCE;
  const hairModelId = look.hairModel as HairModelId;
  const skinHex = skinColor(look);
  const skinMix = useRef({ value: 1 }).current;
  const gltf = useGLTF(url);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const [hover, setHover] = useState<FaceRegion | null>(null);
  const dragging = useRef(false);
  const changeRef = useRef(onSculptChange);
  changeRef.current = onSculptChange;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const brushOn = !!brush;
  const ring = useRef<THREE.Mesh>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  // a cor do anel diz o que o pincel faz: verde-azulado adiciona, âmbar reduz, azul suaviza, cinza apaga
  useEffect(() => {
    const colors = { add: '#0f8f89', reduce: '#d97706', smooth: '#3b82f6', erase: '#6b7280' } as const;
    ringMaterial.current?.color.set(brush ? colors[brush.tool] : colors.add);
    invalidate();
  }, [brush?.tool]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastStamp = useRef<THREE.Vector3 | null>(null);

  const { mesh, eyes, regionAttrs, runtime, textured, strandsColor, eyeLevel, hairCoverage, detectedHair } = useMemo(() => {
    let source: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
    });
    if (!source) throw new Error('O arquivo 3D não tem malha');
    const src = source as THREE.Mesh;
    const geometry = src.geometry.clone();
    const n = geometry.getAttribute('position').count;
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    // Modelo reconstruído traz a textura das fotos: ela substitui a cor de pele do painel.
    const photoMap = ((src.material as THREE.MeshStandardMaterial | undefined)?.map ?? null) as THREE.Texture | null;
    const material = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: photoMap,
      vertexColors: true,
      roughness: 0.6,
      sheen: 0.35,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color('#f0d2c0'),
      clearcoat: 0.1,
      clearcoatRoughness: 0.45,
    });
    const runtime = createSculptRuntime(geometry, (st) => changeRef.current?.(st), invalidate);
    runtime?.patchMaterial(material);
    applySkinShader(material, skinMix);
    const m = new THREE.Mesh(geometry, material);
    m.morphTargetDictionary = { ...(src.morphTargetDictionary ?? {}) };
    m.morphTargetInfluences = new Array(Object.keys(m.morphTargetDictionary).length).fill(0);
    m.updateMorphTargets();
    m.userData.textured = !!photoMap;
    const extras = (src.userData ?? {}) as {
      kind?: ModelInfo['kind'];
      notice?: string;
      eyes?: { centers: [number, number, number][]; radius: number };
      hairColor?: string;
      hairStyle?: DetectedHair;
      sliderMaxMm?: Record<string, number>;
      eyeY?: number;
      faceZ?: number;
    };
    const attrs = new Map<FaceRegion, THREE.BufferAttribute>();
    for (const r of REGIONS) {
      const a = geometry.getAttribute(`_region_${r}`) as THREE.BufferAttribute | undefined;
      if (a) attrs.set(r, a);
    }
    onLoaded?.({
      kind: extras.kind ?? 'RECONSTRUCTION',
      notice: extras.notice ?? null,
      vertices: n,
      sliders: Object.keys(m.morphTargetDictionary),
      textured: !!photoMap,
      hairStyle: extras.hairStyle ?? null,
      hairColor: extras.hairColor ?? null,
      sliderMm: extras.sliderMaxMm ?? null,
    });
    const hairAttr = geometry.getAttribute('_hair') as THREE.BufferAttribute | undefined;
    const hasHair = !!hairAttr;
    let coverage: Float32Array | null = null;
    if (hairAttr) {
      coverage = new Float32Array(hairAttr.count);
      for (let i = 0; i < coverage.length; i++) coverage[i] = hairAttr.getX(i); // getX devolve o valor já normalizado
    }
    return {
      mesh: m,
      eyes: extras.eyes ?? null,
      regionAttrs: attrs,
      runtime,
      textured: !!photoMap,
      strandsColor: hasHair ? (extras.hairColor ?? '#2a2018') : null,
      eyeLevel: { eyeY: extras.eyeY, faceZ: extras.faceZ },
      hairCoverage: coverage,
      detectedHair: extras.hairStyle ?? null,
    };
    // onLoaded é estável o bastante; recriar a malha a cada render seria caro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);

  const strandStyle = useMemo(
    () => (look.hairVisible ? resolveStyle(hairModelId, look.hairScale, detectedHair) : null),
    [hairModelId, look.hairScale, look.hairVisible, detectedHair],
  );

  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);

  // Liga a escultura (pincel) ao visualizador e carrega a de uma versão salva.
  useEffect(() => {
    const holder = shared.current;
    holder.sculpt = runtime;
    return () => {
      if (holder.sculpt === runtime) holder.sculpt = null;
    };
  }, [runtime, shared]);
  useEffect(() => {
    try {
      runtime?.load(sculptData ?? null);
    } catch (e) {
      console.warn('Escultura salva ignorada:', e);
      runtime?.load(null);
    }
  }, [runtime, sculptData, sculptNonce]);

  // Pesos dos sliders → influências dos morph targets.
  useEffect(() => {
    const dict = mesh.morphTargetDictionary ?? {};
    const current = new Array(mesh.morphTargetInfluences?.length ?? 0).fill(0);
    for (const [id, i] of Object.entries(dict)) current[i] = params[id as keyof SimulationParams] ?? 0;
    shared.current.mesh = mesh;
    shared.current.current = current;
    shared.current.zeros = current.map(() => 0);
    mesh.morphTargetInfluences!.splice(0, current.length, ...current);
    invalidate();
  }, [mesh, params, shared, invalidate]);

  // Pele: modo leve desliga poros e brilho; a cor da pele vale também na exportação.
  useEffect(() => {
    // Modelo com a textura das fotos: sem poros desenhados, sem brilho avermelhado de borda e sem verniz por cima.
    // A pele já vem da foto; o simulador a escurecia e a deixava alaranjada.
    const photo = !!mesh.userData.textured;
    skinMix.value = look.light || photo ? 0 : 1;
    const mat = mesh.material as THREE.MeshPhysicalMaterial;
    const coat = look.light || photo ? 0 : 0.1;
    if (mat.clearcoat !== coat) {
      mat.clearcoat = coat;
      mat.needsUpdate = true;
    }
    shared.current.skin.set(skinHex);
    invalidate();
  }, [mesh, look.light, skinHex, skinMix, shared, invalidate]);

  // Destaque de região por cor de vértice.
  useEffect(() => {
    const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const base = new THREE.Color(mesh.userData.textured ? '#ffffff' : skinHex);
    const c = new THREE.Color();
    const tints = Object.fromEntries(REGIONS.map((r) => [r, new THREE.Color(REGION_TINT[r])])) as Record<FaceRegion, THREE.Color>;
    for (let v = 0; v < color.count; v++) {
      c.copy(base);
      if (showRegions) {
        for (const [r, a] of regionAttrs) {
          const w = a.getX(v);
          if (w > 0.02) c.lerp(tints[r], Math.min(0.55, w * 0.55));
        }
      }
      const active = hover ?? highlight;
      if (active) {
        const a = regionAttrs.get(active);
        const w = a ? a.getX(v) : 0;
        if (w > 0) c.lerp(hover && hover !== highlight ? ACCENT : ZONE, Math.min(hover && hover !== highlight ? 0.4 : 0.85, w * 1.2));
      }
      color.setXYZ(v, c.r, c.g, c.b);
    }
    color.needsUpdate = true;
    invalidate();
  }, [mesh, regionAttrs, highlight, hover, showRegions, skinHex, invalidate]);

  useEffect(() => {
    if (!sculpt) setHover(null);
  }, [sculpt]);
  useEffect(() => {
    if (!brushOn && ring.current) {
      ring.current.visible = false;
      invalidate();
    }
  }, [brushOn, invalidate]);

  // Modelar: sobre o rosto o arrasto modela; fora dele a câmera gira. Antes de a câmera
  // (OrbitControls) ver o clique, decidimos se ele caiu no rosto e a desligamos só nesse caso.
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  useEffect(() => {
    const el = gl.domElement;
    if (controls) controls.enabled = true;
    if (!sculpt && !brushOn) {
      el.style.cursor = 'grab';
      return;
    }
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const overFace = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh, false)[0];
      // Só conta como "rosto" onde existe região modelável; testa/orelha continuam girando.
      return !!hit?.face && (brushOn || regionAt(hit.face) !== null);
    };
    const down = (ev: PointerEvent) => {
      if (controls) controls.enabled = !overFace(ev);
    };
    const release = () => {
      if (controls) controls.enabled = true;
    };
    const move = (ev: PointerEvent) => {
      if (ev.buttons === 0) el.style.cursor = overFace(ev) ? 'crosshair' : 'grab';
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointermove', move);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('pointermove', move);
      if (controls) controls.enabled = true;
      el.style.cursor = 'grab';
    };
    // regionAt só lê regionAttrs, que muda junto com mesh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sculpt, brushOn, gl, camera, controls, mesh]);

  useEffect(() => {
    (mesh.material as THREE.MeshPhysicalMaterial).wireframe = wireframe;
    invalidate();
  }, [mesh, wireframe, invalidate]);

  function regionAt(face: { a: number; b: number; c: number }): FaceRegion | null {
    let best: FaceRegion | null = null;
    let bestW = 0.15;
    for (const [r, a] of regionAttrs) {
      const w = (a.getX(face.a) + a.getX(face.b) + a.getX(face.c)) / 3;
      if (w > bestW) [best, bestW] = [r, w];
    }
    return best;
  }

  function pick(e: ThreeEvent<MouseEvent>) {
    if (sculpt || brushOn || e.delta > 4 || !e.face) return;
    e.stopPropagation();
    const best = regionAt(e.face);
    if (best) onRegionPick(best);
  }

  // Centro vertical de cada região: decide se o toque foi na metade de cima (ex.: lábio superior).
  const centers = useMemo(() => {
    const pos = mesh.geometry.getAttribute('position');
    const out = new Map<FaceRegion, number>();
    for (const [r, a] of regionAttrs) {
      let sum = 0;
      let wsum = 0;
      for (let v = 0; v < pos.count; v++) {
        const w = a.getX(v);
        if (w > 0.05) {
          sum += w * pos.getY(v);
          wsum += w;
        }
      }
      if (wsum > 0) out.set(r, sum / wsum);
    }
    return out;
  }, [mesh, regionAttrs]);

  function sculptDown(e: ThreeEvent<PointerEvent>) {
    if (!sculpt || !e.face || e.nativeEvent.button > 0) return;
    const region = regionAt(e.face);
    if (!region) return;
    e.stopPropagation();
    const el = gl.domElement;
    const id = e.nativeEvent.pointerId;
    let lastX = e.nativeEvent.clientX;
    let lastY = e.nativeEvent.clientY;
    el.setPointerCapture(id);
    dragging.current = true;
    onRegionPick(region);
    sculpt.start(region, e.point.y >= (centers.get(region) ?? e.point.y));
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const pressure = ev.pointerType === 'pen' ? Math.max(0.2, (ev.pressure || 0.5) * 2) : 1;
      sculpt.move(ev.clientX - lastX, ev.clientY - lastY, pressure, ev.clientX, ev.clientY);
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      dragging.current = false;
      sculpt.end();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Anel que mostra o tamanho do pincel sobre a superfície. */
  function placeRing(point: THREE.Vector3, normal?: THREE.Vector3) {
    const r = ring.current;
    const b = brushRef.current;
    if (!r || !b) return;
    const n = normal ?? new THREE.Vector3(0, 0, 1);
    r.visible = true;
    r.position.copy(point).addScaledVector(n, 0.0008);
    r.scale.setScalar(b.radius);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    invalidate();
  }

  function brushDown(e: ThreeEvent<PointerEvent>) {
    const b = brushRef.current;
    if (!b || !runtime || !e.face || e.nativeEvent.button > 0) return;
    e.stopPropagation();
    const el = gl.domElement;
    const id = e.nativeEvent.pointerId;
    el.setPointerCapture(id);
    dragging.current = true;
    // Caneta: a pressão vale; mouse e dedo usam força fixa.
    const pressureOf = (ev: PointerEvent) => (ev.pointerType === 'pen' ? Math.min(1.6, Math.max(0.1, (ev.pressure || 0.5) * 1.6)) : 1);
    const stamp = (p: THREE.Vector3, ev: PointerEvent) => {
      const cur = brushRef.current;
      if (cur) runtime.stamp(p, { ...cur, pressure: pressureOf(ev) });
    };
    const first = e.point.clone();
    stamp(first, e.nativeEvent);
    lastStamp.current = first;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh, false)[0];
      const cur = brushRef.current;
      if (!hit || !cur) return;
      placeRing(hit.point, hit.face?.normal);
      // Um toque a cada fração do raio, para a força não depender de quantos eventos o aparelho manda.
      if (lastStamp.current && hit.point.distanceTo(lastStamp.current) < cur.radius * 0.22) return;
      stamp(hit.point, ev);
      lastStamp.current = hit.point.clone();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      dragging.current = false;
      lastStamp.current = null;
      runtime.endStroke();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function brushHover(e: ThreeEvent<PointerEvent>) {
    if (!brushRef.current || dragging.current || !e.face) return;
    e.stopPropagation();
    placeRing(e.point, e.face.normal);
  }

  function sculptHover(e: ThreeEvent<PointerEvent>) {
    if (!sculpt || dragging.current || !e.face) return;
    e.stopPropagation();
    const r = regionAt(e.face);
    setHover((cur) => (cur === r ? cur : r));
  }

  return (
    <group>
      <primitive
        object={mesh}
        onClick={pick}
        onPointerDown={brushOn ? brushDown : sculptDown}
        onPointerMove={brushOn ? brushHover : sculptHover}
        onPointerOut={() => {
          if (dragging.current) return;
          setHover(null);
          if (ring.current) {
            ring.current.visible = false;
            invalidate();
          }
        }}
      />
      <mesh ref={ring} name="brush-ring" visible={false} renderOrder={10}>
        <ringGeometry args={[0.9, 1, 56]} />
        <meshBasicMaterial ref={ringMaterial} color="#0f8f89" transparent opacity={0.95} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      {eyes && <Eyes eyes={eyes} irisHex={irisColor(look)} />}
      {eyes && <BrowsAndLashes head={mesh} eyes={eyes} browHex={look.browHex} />}
      {textured && strandsColor && look.hairCap && hairCoverage && (
        <Hair
          head={mesh}
          params={{ volume: look.hairVolume, length: look.hairLength, hairline: look.hairline, eyeY: eyeLevel.eyeY, coverage: hairCoverage }}
          hex={strandsColor}
        />
      )}
      {textured && strandsColor && strandStyle && (
        <HairStrands
          head={mesh}
          color={look.hairColorHex ?? strandsColor}
          density={40 + look.hairVolume * 100}
          length={0.05}
          style={strandStyle}
          photoDirection={look.hairModel === 'auto'}
          colorMix={look.hairColorHex ? 0.1 : 0.35}
          eyeY={eyeLevel.eyeY}
          faceZ={eyeLevel.faceZ}
        />
      )}
      {look.hairVisible && !textured && (
        <Hair head={mesh} params={{ volume: look.hairVolume, length: look.hairLength, hairline: look.hairline, eyeY: eyes?.centers[0]?.[1] }} hex={look.hairHex} />
      )}
    </group>
  );
}

/** Câmera, vistas animadas, modos de comparação e snapshot para exportação. */
function Rig({
  compare,
  curtain,
  showOriginal,
  view,
  viewNonce,
  focus,
  shared,
  api,
}: Props & { shared: React.RefObject<Shared>; api: React.RefObject<Pick<ViewerHandle, 'snapshot'> | null> }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { gl, scene, camera, invalidate } = useThree();
  const goal = useRef<{ az: number; dist: number; target?: THREE.Vector3 } | null>(null);

  useEffect(() => {
    goal.current = { az: VIEW_AZIMUTH[view], dist: DISTANCE };
    invalidate();
  }, [view, viewNonce, invalidate]);

  // Escolher um procedimento aproxima a câmera da zona dele, mantendo o ângulo atual
  useEffect(() => {
    const mesh = shared.current?.mesh;
    const c = controls.current;
    if (!focus || !mesh || !c) return;
    const g = mesh.geometry;
    const weights = focus.regions
      .map((r) => g.getAttribute(`_region_${r}`) as THREE.BufferAttribute | undefined)
      .filter((a): a is THREE.BufferAttribute => !!a)
      .map((a) => Float32Array.from({ length: a.count }, (_, i) => a.getX(i)));
    const zone = zoneBounds(g.getAttribute('position').array as ArrayLike<number>, weights);
    if (!zone) return;
    const center = mesh.localToWorld(new THREE.Vector3(...zone.center));
    const offset = camera.position.clone().sub(c.target);
    goal.current = {
      az: new THREE.Spherical().setFromVector3(offset).theta,
      dist: distanceForZone(zone.radius),
      target: center,
    };
    invalidate();
    // só reage a uma nova escolha de procedimento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => invalidate(), [compare, curtain, showOriginal, invalidate]);

  const setInfluences = (original: boolean) => {
    const { mesh, current, zeros, sculpt } = shared.current;
    sculpt?.setMix(original ? 0 : 1);
    if (!mesh?.morphTargetInfluences) return;
    const src = original ? zeros : current;
    for (let i = 0; i < src.length; i++) mesh.morphTargetInfluences[i] = src[i]!;
    (mesh.userData.hairSync as ((original: boolean) => void) | undefined)?.(original); // o cabelo acompanha a cabeça
  };

  useEffect(() => {
    api.current = {
      snapshot({ view: v, original, width, height }) {
        const prevSize = gl.getSize(new THREE.Vector2());
        const prevRatio = gl.getPixelRatio();
        const cam = (camera as THREE.PerspectiveCamera).clone();
        const az = VIEW_AZIMUTH[v];
        cam.position.set(TARGET.x + DISTANCE * Math.sin(az), TARGET.y, TARGET.z + DISTANCE * Math.cos(az));
        cam.aspect = width / height;
        cam.lookAt(TARGET);
        cam.updateProjectionMatrix();
        // Exportação sempre com a superfície neutra: sem destaque de região nem wireframe.
        const material = shared.current.mesh?.material as THREE.MeshPhysicalMaterial | undefined;
        const prev = material && { vertexColors: material.vertexColors, wireframe: material.wireframe, color: material.color.clone() };
        if (material) {
          material.vertexColors = false;
          material.wireframe = false;
          material.color.copy(shared.current.mesh?.userData.textured ? new THREE.Color('#ffffff') : shared.current.skin);
          material.needsUpdate = true;
        }
        const ringObj = scene.getObjectByName('brush-ring');
        const ringWas = ringObj?.visible ?? false;
        if (ringObj) ringObj.visible = false;
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        gl.setScissorTest(false);
        setInfluences(original);
        gl.render(scene, cam);
        const url = gl.domElement.toDataURL('image/png');
        setInfluences(false);
        if (ringObj) ringObj.visible = ringWas;
        if (material && prev) {
          material.vertexColors = prev.vertexColors;
          material.wireframe = prev.wireframe;
          material.color.copy(prev.color);
          material.needsUpdate = true;
        }
        gl.setPixelRatio(prevRatio);
        gl.setSize(prevSize.x, prevSize.y, false);
        invalidate();
        return url;
      },
    };
  });

  useFrame(({ size }) => {
    const c = controls.current;
    // Transição suave até a vista escolhida.
    if (c && goal.current) {
      const offset = camera.position.clone().sub(c.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      let dAz = goal.current.az - sph.theta;
      dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      const dPol = POLAR - sph.phi;
      const dR = goal.current.dist - sph.radius;
      const dT = (goal.current.target ?? TARGET).clone().sub(c.target);
      sph.theta += dAz * 0.18;
      sph.phi += dPol * 0.18;
      sph.radius += dR * 0.18;
      c.target.addScaledVector(dT, 0.18);
      camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(c.target);
      c.update();
      if (Math.abs(dAz) + Math.abs(dPol) + Math.abs(dR) + dT.length() < 1e-3) goal.current = null;
      invalidate();
    }

    const cam = camera as THREE.PerspectiveCamera;
    const w = size.width, h = size.height;
    gl.autoClear = true;
    if (compare === 'curtain') {
      const split = Math.round(w * curtain);
      gl.setScissorTest(true);
      gl.setViewport(0, 0, w, h);
      setInfluences(true);
      gl.setScissor(0, 0, split, h);
      gl.render(scene, cam);
      setInfluences(false);
      gl.setScissor(split, 0, w - split, h);
      gl.render(scene, cam);
      gl.setScissorTest(false);
    } else if (compare === 'side') {
      const half = Math.floor(w / 2);
      cam.aspect = half / h;
      // Metade estreita: abre o enquadramento para o perfil caber inteiro.
      cam.zoom = Math.min(1, cam.aspect / 0.8);
      cam.updateProjectionMatrix();
      gl.setScissorTest(true);
      setInfluences(true);
      gl.setViewport(0, 0, half, h);
      gl.setScissor(0, 0, half, h);
      gl.render(scene, cam);
      setInfluences(false);
      gl.setViewport(half, 0, w - half, h);
      gl.setScissor(half, 0, w - half, h);
      gl.render(scene, cam);
      gl.setScissorTest(false);
      gl.setViewport(0, 0, w, h);
      cam.aspect = w / h;
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    } else {
      setInfluences(compare === 'hold' && showOriginal);
      gl.render(scene, cam);
      setInfluences(false);
    }
  }, 1);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={TARGET}
      enablePan={false}
      enableDamping={false}
      minDistance={0.22}
      maxDistance={1.1}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI - 0.15}
      onStart={() => (goal.current = null)}
    />
  );
}

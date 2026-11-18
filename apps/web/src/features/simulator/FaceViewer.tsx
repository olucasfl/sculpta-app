import { Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { FaceRegion, SimulationParams } from '@sim/contracts';
import { forwardRef, Suspense, type ComponentRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';

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
const REGION_TINT: Record<FaceRegion, string> = {
  nose: '#5b8def',
  lips: '#d9577a',
  chin: '#8b6fd6',
  jaw: '#3aa39a',
  malar: '#e09a3c',
  infraorbital: '#56a6d6',
  nasolabial: '#a3a33a',
};
const REGIONS = Object.keys(REGION_TINT) as FaceRegion[];

export interface ModelInfo {
  kind: 'TEMPLATE' | 'RECONSTRUCTION';
  notice: string | null;
  vertices: number;
  sliders: string[];
}

export interface ViewerHandle {
  /** Renderiza uma vista (antes ou depois) num PNG, sem mexer na tela. */
  snapshot(opts: { view: ViewName; original: boolean; width: number; height: number }): string;
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
  onRegionPick: (region: FaceRegion) => void;
  onLoaded?: (info: ModelInfo) => void;
}

interface Shared {
  mesh: THREE.Mesh | null;
  current: number[];
  zeros: number[];
}

export const FaceViewer = forwardRef<ViewerHandle, Props>(function FaceViewer(props, ref) {
  const shared = useRef<Shared>({ mesh: null, current: [], zeros: [] });
  const api = useRef<ViewerHandle | null>(null);
  useImperativeHandle(ref, () => ({ snapshot: (o) => api.current?.snapshot(o) ?? '' }));

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      camera={{ fov: 30, near: 0.01, far: 10, position: [0, TARGET.y, DISTANCE] }}
      aria-label="Modelo 3D do rosto. Arraste para girar, use a roda para aproximar."
      role="img"
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
  shared,
}: Props & { shared: React.RefObject<Shared> }) {
  const gltf = useGLTF(url);
  const invalidate = useThree((s) => s.invalidate);

  const { mesh, eyes, regionAttrs } = useMemo(() => {
    let source: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
    });
    if (!source) throw new Error('O arquivo 3D não tem malha');
    const src = source as THREE.Mesh;
    const geometry = src.geometry.clone();
    const n = geometry.getAttribute('position').count;
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const material = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.6,
      sheen: 0.35,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color('#f0d2c0'),
    });
    const m = new THREE.Mesh(geometry, material);
    m.morphTargetDictionary = { ...(src.morphTargetDictionary ?? {}) };
    m.morphTargetInfluences = new Array(Object.keys(m.morphTargetDictionary).length).fill(0);
    m.updateMorphTargets();
    const extras = (src.userData ?? {}) as { kind?: ModelInfo['kind']; notice?: string; eyes?: { centers: [number, number, number][]; radius: number } };
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
    });
    return { mesh: m, eyes: extras.eyes ?? null, regionAttrs: attrs };
    // onLoaded é estável o bastante; recriar a malha a cada render seria caro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);

  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);

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

  // Destaque de região por cor de vértice.
  useEffect(() => {
    const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    const tints = Object.fromEntries(REGIONS.map((r) => [r, new THREE.Color(REGION_TINT[r])])) as Record<FaceRegion, THREE.Color>;
    for (let v = 0; v < color.count; v++) {
      c.copy(SKIN);
      if (showRegions) {
        for (const [r, a] of regionAttrs) {
          const w = a.getX(v);
          if (w > 0.02) c.lerp(tints[r], Math.min(0.55, w * 0.55));
        }
      }
      if (highlight) {
        const a = regionAttrs.get(highlight);
        const w = a ? a.getX(v) : 0;
        if (w > 0) c.lerp(ACCENT, Math.min(0.6, w * 0.6));
      }
      color.setXYZ(v, c.r, c.g, c.b);
    }
    color.needsUpdate = true;
    invalidate();
  }, [mesh, regionAttrs, highlight, showRegions, invalidate]);

  useEffect(() => {
    (mesh.material as THREE.MeshPhysicalMaterial).wireframe = wireframe;
    invalidate();
  }, [mesh, wireframe, invalidate]);

  function pick(e: ThreeEvent<MouseEvent>) {
    if (e.delta > 4 || !e.face) return;
    e.stopPropagation();
    let best: FaceRegion | null = null;
    let bestW = 0.15;
    for (const [r, a] of regionAttrs) {
      const w = (a.getX(e.face.a) + a.getX(e.face.b) + a.getX(e.face.c)) / 3;
      if (w > bestW) [best, bestW] = [r, w];
    }
    if (best) onRegionPick(best);
  }

  return (
    <group>
      <primitive object={mesh} onClick={pick} />
      {eyes?.centers.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[eyes.radius, 32, 24]} />
          <meshPhysicalMaterial color="#2b2622" roughness={0.15} clearcoat={1} />
        </mesh>
      ))}
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
  shared,
  api,
}: Props & { shared: React.RefObject<Shared>; api: React.RefObject<ViewerHandle | null> }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { gl, scene, camera, invalidate } = useThree();
  const goal = useRef<{ az: number; dist: number } | null>(null);

  useEffect(() => {
    goal.current = { az: VIEW_AZIMUTH[view], dist: DISTANCE };
    invalidate();
  }, [view, viewNonce, invalidate]);

  useEffect(() => invalidate(), [compare, curtain, showOriginal, invalidate]);

  const setInfluences = (original: boolean) => {
    const { mesh, current, zeros } = shared.current;
    if (!mesh?.morphTargetInfluences) return;
    const src = original ? zeros : current;
    for (let i = 0; i < src.length; i++) mesh.morphTargetInfluences[i] = src[i]!;
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
          material.color.copy(SKIN);
          material.needsUpdate = true;
        }
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        gl.setScissorTest(false);
        setInfluences(original);
        gl.render(scene, cam);
        const url = gl.domElement.toDataURL('image/png');
        setInfluences(false);
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
      const dT = TARGET.clone().sub(c.target);
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
      minDistance={0.35}
      maxDistance={1.1}
      minAzimuthAngle={-Math.PI / 2 - 0.2}
      maxAzimuthAngle={Math.PI / 2 + 0.2}
      minPolarAngle={Math.PI / 3}
      maxPolarAngle={(2 * Math.PI) / 3}
      onStart={() => (goal.current = null)}
    />
  );
}

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildHairGeometry, type HairParams } from './hair';
import { makeIrisTexture } from './skinShader';

export interface EyeData {
  centers: [number, number, number][];
  radius: number;
}

/** Olhos em camadas: esclera, íris com textura e córnea transparente e brilhante (em vez de esferas escuras). */
export function Eyes({ eyes, irisHex }: { eyes: EyeData; irisHex: string }) {
  const iris = useMemo(() => makeIrisTexture(irisHex), [irisHex]);
  useEffect(() => () => iris.dispose(), [iris]);
  const r = eyes.radius;
  return (
    <>
      {eyes.centers.map((p, i) => (
        <group key={i} position={p}>
          <mesh>
            <sphereGeometry args={[r, 40, 28]} />
            <meshPhysicalMaterial color="#efe9e2" roughness={0.38} />
          </mesh>
          <mesh position={[0, 0, r * 0.88]}>
            <circleGeometry args={[r * 0.52, 56]} />
            <meshStandardMaterial map={iris} roughness={0.35} />
          </mesh>
          <mesh>
            <sphereGeometry args={[r * 1.018, 40, 28]} />
            <meshPhysicalMaterial transparent opacity={0.16} roughness={0.02} clearcoat={1} clearcoatRoughness={0.02} depthWrite={false} envMapIntensity={1.6} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Sobrancelhas e cílios: tubos finos. A altura da pele vem de um raio sobre a malha (a sobrancelha "assenta" no rosto). */
export function BrowsAndLashes({ head, eyes, browHex }: { head: THREE.Mesh; eyes: EyeData; browHex: string }) {
  const geometries = useMemo(() => {
    const out: { key: string; geometry: THREE.BufferGeometry; kind: 'brow' | 'lash' }[] = [];
    const ray = new THREE.Raycaster();
    const r = eyes.radius;
    head.updateMatrixWorld();
    const surfaceZ = (x: number, y: number): number | null => {
      ray.set(new THREE.Vector3(x, y, 0.5), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(head, false)[0];
      return hit ? hit.point.z : null;
    };
    eyes.centers.forEach((c, side) => {
      const dir = Math.sign(c[0]) || 1; // para fora do rosto
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8; // 0 = ponta interna, 1 = ponta externa
        const x = c[0] - dir * r * 1.1 + dir * t * r * 3.0;
        const y = c[1] + r * 2.2 + Math.sin(t * Math.PI) * r * 0.55 - t * r * 0.35;
        const z = surfaceZ(x, y);
        if (z !== null) pts.push(new THREE.Vector3(x, y, z + 0.0006));
      }
      if (pts.length >= 3) {
        out.push({ key: `brow${side}`, kind: 'brow', geometry: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r * 0.11, 6, false) });
      }
      // Cílios: linha escura no alto do olho, onde ficaria a pálpebra.
      const lash: THREE.Vector3[] = [];
      for (let k = 0; k <= 12; k++) {
        const a = THREE.MathUtils.degToRad(28 + (k / 12) * 124);
        const phi = THREE.MathUtils.degToRad(64);
        lash.push(new THREE.Vector3(c[0] + Math.cos(a) * Math.sin(phi) * r * 1.03, c[1] + Math.sin(a) * Math.sin(phi) * r * 1.03, c[2] + Math.cos(phi) * r * 1.03));
      }
      out.push({ key: `lash${side}`, kind: 'lash', geometry: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lash), 32, r * 0.035, 5, false) });
    });
    return out;
  }, [head, eyes]);
  useEffect(() => () => geometries.forEach((g) => g.geometry.dispose()), [geometries]);

  return (
    <>
      {geometries.map((g) => (
        <mesh key={g.key} geometry={g.geometry} scale={g.kind === 'brow' ? [1, 1, 0.55] : [1, 1, 1]}>
          <meshStandardMaterial color={g.kind === 'brow' ? browHex : '#0b0807'} roughness={0.85} />
        </mesh>
      ))}
    </>
  );
}

/** Cabelo aproximado: casca sobre o crânio, com listras de fios por ruído e espessura que some na borda. */
export function Hair({ head, params, hex }: { head: THREE.Mesh; params: HairParams; hex: string }) {
  const geometry = useMemo(() => buildHairGeometry(head.geometry, params), [head, params.volume, params.length, params.hairline, params.eyeY, params.coverage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.0 });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHairPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vHairPos;
float hh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  // Fios: faixas finas que seguem a vertical, com variação de tom.
  float s = hh(floor(vec3(vHairPos.x * 1400.0, vHairPos.y * 90.0, vHairPos.z * 1400.0)));
  float s2 = hh(floor(vec3(vHairPos.x * 700.0 + 7.0, vHairPos.y * 40.0, vHairPos.z * 700.0)));
  diffuseColor.rgb *= 0.7 + 0.3 * s + 0.25 * s2;
}`,
        );
    };
    m.customProgramCacheKey = () => 'sculpta-hair-v2';
    return m;
    // a cor muda por efeito, abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    material.color.set(hex);
  }, [material, hex]);
  useEffect(() => () => material.dispose(), [material]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} />;
}

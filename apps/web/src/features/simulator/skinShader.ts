import * as THREE from 'three';

const NOISE = /* glsl */ `
varying vec3 vObjPos;
uniform float uSkin;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
/* Poros: duas oitavas de ruído em coordenadas do modelo (não precisa de UV). Escala em metros. */
float pores(vec3 p) { return vnoise(p * 900.0) * 0.6 + vnoise(p * 2300.0) * 0.4; }
`;

/**
 * Pele mais convincente sobre o material físico, sem texturas: poros como relevo (derivadas de tela),
 * variação de rugosidade e um brilho avermelhado nas bordas, que aproxima o espalhamento de luz sob a pele.
 * `uSkin` liga (1) ou desliga (0) o conjunto: o modo leve usa 0.
 *
 * Honestidade: é uma APROXIMAÇÃO em tempo real. O relevo de poros é procedural, não vem da foto do paciente,
 * e o "subsurface" é um realce de borda, não uma simulação física.
 */
export function applySkinShader(material: THREE.Material, uSkin: { value: number }) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSkin = uSkin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (pores(vObjPos) - 0.5) * 0.22 * uSkin, 0.05, 1.0);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float hgt = pores(vObjPos) * 0.00011;
  vec2 dh = vec2(dFdx(hgt), dFdy(hgt));
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec3 R1 = cross(q1, normal), R2 = cross(normal, q0);
  float det = dot(q0, R1);
  vec3 grad = sign(det) * (dh.x * R1 + dh.y * R2);
  normal = normalize(abs(det) * normal - uSkin * grad);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
  totalEmissiveRadiance += vec3(0.50, 0.16, 0.10) * rim * 0.16 * uSkin;
}`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey?.() ?? ''}+skin-v1`;
  material.needsUpdate = true;
}

/** Textura procedural de íris: anel límbico escuro, fibras radiais e pupila. */
export function makeIrisTexture(hex: string): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const cx = size / 2;
  const base = new THREE.Color(hex);
  const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.28).getStyle();
  const dark = base.clone().lerp(new THREE.Color('#000000'), 0.45).getStyle();

  const radial = g.createRadialGradient(cx, cx, size * 0.1, cx, cx, cx);
  radial.addColorStop(0, light);
  radial.addColorStop(0.55, base.getStyle());
  radial.addColorStop(0.92, dark);
  radial.addColorStop(1, '#0c0a09');
  g.fillStyle = radial;
  g.fillRect(0, 0, size, size);

  // Fibras radiais (determinísticas: o mesmo olho sempre sai igual).
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = size * (0.12 + rnd() * 0.12);
    const r1 = size * (0.3 + rnd() * 0.18);
    g.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.20)';
    g.lineWidth = 1 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
    g.stroke();
  }
  // Pupila.
  g.fillStyle = '#050403';
  g.beginPath();
  g.arc(cx, cx, size * 0.115, 0, Math.PI * 2);
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

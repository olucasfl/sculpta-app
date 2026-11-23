import * as THREE from 'three';

/**
 * Sombreador das mechas de cabelo (fitas que olham para a câmera).
 *  - fios finos dentro da fita (listras com brilho e falhas diferentes) e pontas afinadas, com recorte pontilhado;
 *  - luz difusa tipo Kajiya-Kay (usa a direção do fio, não a normal), com luz principal, de preenchimento e de contorno;
 *  - dois brilhos deslocados ao longo do fio (Scheuermann 2004): um branco e fino, outro colorido e mais largo;
 *  - sombra de oclusão: raízes e camadas internas mais escuras, pontas um pouco mais claras e quentes.
 */
const vertex = /* glsl */ `
attribute vec3 tangent;
attribute float side;
attribute float along;
attribute vec3 info;
attribute vec3 aColor;
uniform vec3 uCenter;
varying vec3 vWorld;
varying vec3 vT;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vInfo;
varying vec3 vColor;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 T = normalize(mat3(modelMatrix) * tangent);
  vec3 V = cameraPosition - wp;
  vec3 B = normalize(cross(T, V));
  float taper = 1.0 - 0.78 * smoothstep(0.5, 1.0, along);
  wp += B * side * info.x * taper;
  vWorld = wp;
  vT = T;
  vN = normalize(wp - (modelMatrix * vec4(uCenter, 1.0)).xyz);
  vUv = vec2(side * 0.5 + 0.5, along);
  vInfo = info;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fragment = /* glsl */ `
varying vec3 vWorld;
varying vec3 vT;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vInfo;
varying vec3 vColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float strandSpec(vec3 T, vec3 N, vec3 H, float shift, float expo) {
  vec3 Ts = normalize(T + N * shift);
  float d = dot(Ts, H);
  return pow(sqrt(max(0.0, 1.0 - d * d)), expo);
}
void main() {
  vec3 T = normalize(vT);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  // fios finos dentro da fita: ~14 listras, cada uma com brilho próprio e falhas
  float id = floor(vUv.x * 9.0 + vInfo.z * 41.0);
  float sr = hash(vec2(id, vInfo.z * 7.0));
  float streak = hash(vec2(id, floor(vUv.y * 22.0 + vInfo.z * 13.0)));
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = smoothstep(0.0, 0.25, edge) * (0.84 + 0.16 * sr);
  a *= 1.0 - 0.9 * smoothstep(0.78, 1.0, vUv.y);
  a += (hash(gl_FragCoord.xy) - 0.5) * 0.2;
  if (a < 0.45) discard;

  vec3 Lk = normalize(vec3(0.35, 0.75, 0.9));
  vec3 Lf = normalize(vec3(-0.7, 0.2, 0.5));
  vec3 Lr = normalize(vec3(0.0, 0.4, -1.0));
  float dk = sqrt(max(0.0, 1.0 - pow(dot(T, Lk), 2.0)));
  float df = sqrt(max(0.0, 1.0 - pow(dot(T, Lf), 2.0)));
  float dr = sqrt(max(0.0, 1.0 - pow(dot(T, Lr), 2.0)));
  float diff = 0.2 + 0.62 * dk + 0.2 * df + 0.18 * dr;
  float ao = mix(0.5, 1.0, vInfo.y) * mix(0.5, 1.0, smoothstep(0.0, 0.32, vUv.y));
  ao *= 0.9 + 0.2 * streak;

  vec3 H = normalize(Lk + V);
  float s1 = strandSpec(T, N, H, 0.12, 140.0) * 0.10;
  float s2 = strandSpec(T, N, H, -0.2, 40.0) * 0.09 * (0.5 + 0.5 * sr);
  vec3 col = vColor * (0.72 + 0.56 * sr) * diff * ao;
  col = mix(col, col * vec3(1.22, 1.08, 0.88), smoothstep(0.5, 1.0, vUv.y) * 0.55);
  float lit = ao * smoothstep(0.02, 0.22, vUv.y);
  col += (vec3(1.0) * s1 + vColor * 1.6 * s2) * lit;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createHairMaterial(center: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uCenter: { value: center } },
    side: THREE.DoubleSide,
  });
}

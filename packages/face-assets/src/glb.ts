/**
 * Escritor mínimo de glTF binário (.glb) para uma malha com morph targets.
 * - Morph targets em accessors ESPARSOS (só os vértices que se movem): arquivo pequeno.
 * - Pesos de região em atributos customizados `_REGION_0..n` (escalares por vértice).
 * - Nomes dos targets em `mesh.extras.targetNames` (lido pelo GLTFLoader do three.js).
 * É o mesmo formato que o worker real entregará (ADR 0002).
 */
export interface GlbInput {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  targets: { name: string; positions: Float32Array; normals: Float32Array }[];
  scalarAttributes?: Record<string, Float32Array>;
  extras?: Record<string, unknown>;
  scale?: number;
}

const FLOAT = 5126, UINT32 = 5125, UBYTE = 5121;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

class BinBuilder {
  private parts: Uint8Array[] = [];
  private length = 0;
  readonly views: Record<string, unknown>[] = [];

  add(data: ArrayBufferView, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.push(new Uint8Array(pad));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.push(bytes);
    return this.views.length - 1;
  }

  private push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.byteLength;
  }

  concat(): Uint8Array {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.push(new Uint8Array(pad));
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }
}

function minMax(v: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, v[i + k]!);
      max[k] = Math.max(max[k]!, v[i + k]!);
    }
  }
  return { min, max };
}

const scaled = (v: Float32Array, s: number) => (s === 1 ? v : v.map((x) => x * s));

export function writeGlb(input: GlbInput): Uint8Array {
  const s = input.scale ?? 1;
  const count = input.positions.length / 3;
  const bin = new BinBuilder();
  const accessors: Record<string, unknown>[] = [];
  const accessor = (a: Record<string, unknown>) => (accessors.push(a), accessors.length - 1);

  const pos = scaled(input.positions, s);
  const posAcc = accessor({ bufferView: bin.add(pos, ARRAY_BUFFER), componentType: FLOAT, count, type: 'VEC3', ...minMax(pos) });
  const nrmAcc = accessor({ bufferView: bin.add(input.normals, ARRAY_BUFFER), componentType: FLOAT, count, type: 'VEC3' });
  const idxAcc = accessor({
    bufferView: bin.add(input.indices, ELEMENT_ARRAY_BUFFER),
    componentType: UINT32,
    count: input.indices.length,
    type: 'SCALAR',
  });

  const attributes: Record<string, number> = { POSITION: posAcc, NORMAL: nrmAcc };
  // Pesos 0–1 viram bytes normalizados (precisão de 1/255 basta para máscaras).
  for (const [name, values] of Object.entries(input.scalarAttributes ?? {})) {
    const q = new Uint8Array(count);
    for (let i = 0; i < count; i++) q[i] = Math.round(Math.min(1, Math.max(0, values[i]!)) * 255);
    attributes[name] = accessor({ bufferView: bin.add(q, ARRAY_BUFFER), componentType: UBYTE, normalized: true, count, type: 'SCALAR' });
  }

  const sparse = (values: Float32Array, isPosition: boolean) => {
    const idx: number[] = [];
    const vals: number[] = [];
    for (let v = 0; v < count; v++) {
      const x = values[v * 3]!, y = values[v * 3 + 1]!, z = values[v * 3 + 2]!;
      if (Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e-7) {
        idx.push(v);
        vals.push(x, y, z);
      }
    }
    const v32 = new Float32Array(vals);
    const a: Record<string, unknown> = { componentType: FLOAT, count, type: 'VEC3' };
    if (isPosition) Object.assign(a, minMax(v32.length ? v32 : new Float32Array(3)));
    if (idx.length > 0) {
      a.sparse = {
        count: idx.length,
        indices: { bufferView: bin.add(new Uint32Array(idx)), componentType: UINT32 },
        values: { bufferView: bin.add(v32) },
      };
    }
    return accessor(a);
  };

  const targets = input.targets.map((t) => ({
    POSITION: sparse(scaled(t.positions, s), true),
    NORMAL: sparse(t.normals, false),
  }));

  const binary = bin.concat();
  const json = {
    asset: { version: '2.0', generator: '@sim/face-assets' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'FaceMesh', mesh: 0 }],
    meshes: [
      {
        name: 'FaceMesh',
        primitives: [{ attributes, indices: idxAcc, mode: 4, targets }],
        weights: input.targets.map(() => 0),
        extras: { targetNames: input.targets.map((t) => t.name), ...(input.extras ?? {}) },
      },
    ],
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: binary.byteLength }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.byteLength + 8 + binary.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.byteLength;
  dv.setUint32(binStart, binary.byteLength, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // 'BIN'
  out.set(binary, binStart + 8);
  return out;
}

/** Lê o JSON de um .glb (para testes e validação). */
export function readGlbJson(glb: Uint8Array): Record<string, unknown> {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Não é um .glb');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as Record<string, unknown>;
}

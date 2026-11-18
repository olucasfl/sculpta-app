import { describe, expect, it } from 'vitest';
import { colorsFromPhoto, type Landmark, type RgbaImage } from './photoColors';

const W = 200, H = 200;

function image(bg: [number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
  return { data, width: W, height: H } as RgbaImage & { data: Uint8ClampedArray };
}
function paint(img: { data: Uint8ClampedArray }, cx: number, cy: number, r: number, c: [number, number, number]) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.data.set([...c, 255], (y * W + x) * 4);
}
/** 478 pontos; só os usados pela amostragem ficam em lugares conhecidos (em pixels / 200). */
function landmarks(): Landmark[] {
  const lm: [number, number, number][] = Array.from({ length: 478 }, () => [0.5, 0.5, 0]);
  const set = (i: number, x: number, y: number) => (lm[i] = [x / W, y / H, 0]);
  set(10, 100, 60); // topo da testa
  set(152, 100, 180); // queixo (altura do rosto = 120 px)
  set(9, 100, 80); // meio da testa
  set(50, 70, 130); // bochecha direita
  set(280, 130, 130); // bochecha esquerda
  set(468, 80, 100); set(469, 86, 100); // íris direita (raio 6)
  set(473, 120, 100); set(474, 126, 100); // íris esquerda
  return lm;
}

const SKIN: [number, number, number] = [220, 180, 150];
const IRIS: [number, number, number] = [70, 120, 70];
const HAIR: [number, number, number] = [60, 40, 28];

function scene(opts: { hair?: boolean; bg?: [number, number, number] } = {}) {
  const img = image(opts.bg ?? [200, 205, 210]);
  paint(img, 100, 120, 70, SKIN); // rosto
  if (opts.hair !== false) paint(img, 100, 36, 22, HAIR); // cabelo acima da testa (topo + 0,2 da altura)
  paint(img, 80, 100, 6, IRIS);
  paint(img, 120, 100, 6, IRIS);
  paint(img, 80, 100, 2, [5, 5, 5]); // pupila
  paint(img, 120, 100, 2, [5, 5, 5]);
  return img;
}

const close = (hex: string | undefined, rgb: [number, number, number], tol = 6) => {
  expect(hex).toBeDefined();
  const n = parseInt(hex!.slice(1), 16);
  const got = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  got.forEach((v, k) => expect(Math.abs(v - rgb[k]!)).toBeLessThanOrEqual(tol));
};

describe('cores da foto', () => {
  it('lê pele, íris e cabelo nos lugares certos', () => {
    const r = colorsFromPhoto(scene(), landmarks());
    close(r.skinHex, SKIN);
    close(r.irisHex, IRIS);
    close(r.hairHex, HAIR);
    expect(r.notes).toEqual([]);
  });

  it('sem cabelo acima da testa (aparece pele/fundo), recusa e avisa', () => {
    const r = colorsFromPhoto(scene({ hair: false }), landmarks());
    expect(r.hairHex).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/cabelo/);
    close(r.skinHex, SKIN);
  });

  it('fundo claro atrás do cabelo não vira cor de cabelo', () => {
    const r = colorsFromPhoto(scene({ hair: false, bg: [245, 245, 245] }), landmarks());
    expect(r.hairHex).toBeUndefined();
  });

  it('sem os 478 pontos, não inventa nada', () => {
    const r = colorsFromPhoto(scene(), landmarks().slice(0, 100));
    expect(r.skinHex).toBeUndefined();
    expect(r.notes.length).toBe(1);
  });
});

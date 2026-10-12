// Mock 图像生成（design.md §5.3）：按 scope 做真实像素变换，输出同尺寸 PNG，
// 右下角叠加半透明 `MOCK·<scope>修正` 点阵标签（诚实标识）。全程确定性。
import { PNG } from 'pngjs';
import type { Region, Scope } from '../types.js';

const NEAR_WHITE = 245;
const isContent = (r: number, g: number, b: number, a: number) => a > 0 && !(r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE);
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------- 5x7 ASCII 点阵字模（仅覆盖标签所需字符） ----------
const F: Record<string, string[]> = {
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  '·': ['.....', '.....', '.##..', '.##..', '.....', '.....', '.....'],
};

// 「修」点阵（16x16）：亻（左撇+竖）+ 丨（中竖）+ 攵（横 + 乂）+ 彡（三撇）
const XIU = [
  '...##..#....##.',
  '..##...#...#...',
  '.#.....#.#####.',
  '.#.....#..#...#.',
  '.#.....#...#.#..',
  '.#.....#....#...',
  '.#.....#...#.#..',
  '.#.....#..#...#.',
  '.#.....#........',
  '.#.....#...#.#.#',
  '.#.....#..#.#.#.',
  '.#.....#.#.#.#..',
  '.#.....##..#.#..',
  '.#.....#........',
  '.#.....#........',
  '.#.....#........',
];
// 「正」点阵（16x16：顶横、左竖、中横、中竖、底横）
const ZHENG = [
  '................',
  '.##############.',
  '.#..............',
  '.#..............',
  '.#..............',
  '.#..............',
  '.#..............',
  '.##############.',
  '.#.....#........',
  '.#.....#........',
  '.#.....#........',
  '.#.....#........',
  '.#.....#........',
  '.#.....#........',
  '.##############.',
  '................',
];

function setPx(png: PNG, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  // 半透明叠加：dst = src*a + dst*(1-a)
  const k = a / 255;
  png.data[i] = Math.round(r * k + png.data[i] * (1 - k));
  png.data[i + 1] = Math.round(g * k + png.data[i + 1] * (1 - k));
  png.data[i + 2] = Math.round(b * k + png.data[i + 2] * (1 - k));
  png.data[i + 3] = 255;
}

/** 右下角半透明标签：`MOCK·<SCOPE>` + 「修正」二字 */
function stampLabel(png: PNG, scope: Scope) {
  const scale = png.width >= 400 ? 2 : 1;
  const text = `MOCK·${scope.toUpperCase()}`;
  const cjkH = Math.max(XIU.length, ZHENG.length) * scale;                    // 16 行
  const asciiW = text.length * 6 * scale;                                     // 5 列字模 + 1 列间距
  const cjkW = (XIU[0].length + 1 + ZHENG[0].length) * scale;
  const chipW = asciiW + cjkW + 8 * scale, chipH = cjkH + 6 * scale;
  const x0 = png.width - chipW - 6, y0 = png.height - chipH - 6;

  for (let y = y0; y < y0 + chipH; y++) for (let x = x0; x < x0 + chipW; x++) setPx(png, x, y, 255, 255, 255, 110); // 半透明白底
  const dot = (x: number, y: number) => setPx(png, x0 + 4 * scale + x, y0 + 3 * scale + y, 30, 30, 30, 190);

  let cx = 0;
  for (const ch of text) {
    const g = F[ch];
    if (g) for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++) if (g[ry][rx] === '#')
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) dot(cx + rx * scale + sx, ry * scale + sy + (cjkH - 7 * scale)); // 与汉字底对齐
    cx += 6 * scale;
  }
  for (const glyph of [XIU, ZHENG]) {
    for (let ry = 0; ry < glyph.length; ry++) for (let rx = 0; rx < glyph[0].length; rx++) if (glyph[ry][rx] === '#')
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) dot(cx + rx * scale + sx, ry * scale + sy);
    cx += (glyph[0].length + 1) * scale;
  }
}

// ---------- 色彩工具 ----------
function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** 内容包围盒（像素坐标） */
function contentBBox(png: PNG) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1, n = 0, sumX = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (!isContent(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3])) continue;
    n++; sumX += x;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return n ? { minX, minY, maxX, maxY, cx: sumX / n } : null;
}

// ---------- 各 scope 的真实像素变换 ----------
function transformPose(src: PNG): PNG {
  // 内容整体向水平中心平移 + 轻剪切 + 3% 纵向收紧（可见的姿态/位置变化），白底重绘
  const out = new PNG({ width: src.width, height: src.height });
  out.data.fill(255);
  const bb = contentBBox(src);
  if (!bb) return out;
  const dx = Math.round((src.width / 2 - bb.cx) * 0.5);   // 朝中心移一半差距，方向确定
  const shear = src.width * 0.05;                          // 底部最大剪切量
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const i = (y * src.width + x) * 4;
    if (!isContent(src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3])) continue;
    const ny = bb.minY + Math.round((y - bb.minY) * 0.97);
    const nx = x + dx + Math.round((shear * (y - bb.minY)) / Math.max(1, bb.maxY - bb.minY));
    if (nx < 0 || ny < 0 || nx >= out.width || ny >= out.height) continue;
    const j = (ny * out.width + nx) * 4;
    out.data[j] = src.data[i]; out.data[j + 1] = src.data[i + 1]; out.data[j + 2] = src.data[i + 2]; out.data[j + 3] = 255;
  }
  return out;
}

function dilateDark(png: PNG, region?: { x0: number; y0: number; x1: number; y1: number }) {
  // 暗像素（lum<128）3x3 膨胀：让线条更实；region 给定时仅作用于区域内
  const { width: w, height: h, data } = png;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && lum(data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]) < 128;
  const x0 = region?.x0 ?? 0, y0 = region?.y0 ?? 0, x1 = region?.x1 ?? w - 1, y1 = region?.y1 ?? h - 1;
  const toSet: [number, number][] = []; // [目标像素 idx, 最暗邻居像素 idx]
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4;
    if (lum(data[i], data[i + 1], data[i + 2]) < 128) continue;
    let best = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!dark(nx, ny)) continue;
      const j = (ny * w + nx) * 4;
      if (best < 0 || lum(data[j], data[j + 1], data[j + 2]) < lum(data[best], data[best + 1], data[best + 2])) best = j;
    }
    if (best >= 0) toSet.push([i, best]);
  }
  for (const [i, j] of toSet) {
    data[i] = data[j]; data[i + 1] = data[j + 1]; data[i + 2] = data[j + 2]; data[i + 3] = 255;
  }
}

function hueShiftContent(png: PNG, deg: number, satBoost: number, region?: { x0: number; y0: number; x1: number; y1: number }) {
  const { width: w, data } = png;
  const x0 = region?.x0 ?? 0, y0 = region?.y0 ?? 0, x1 = region?.x1 ?? w - 1, y1 = region?.y1 ?? png.height - 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4;
    if (!isContent(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
    const [h, s, v] = rgb2hsv(data[i], data[i + 1], data[i + 2]);
    const [r, g, b] = hsv2rgb(h + deg, Math.min(1, s * satBoost + 0.02), v);
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}

function fillBackground(png: PNG) {
  // 空白区：上 2/3 柔和天色渐变，地平线取内容 bbox 底边（派生统计），其下铺地色；右上空则画圆月剪影
  const { width: w, height: h, data } = png;
  const bb = contentBBox(png);
  const horizon = bb ? Math.min(h - 1, bb.maxY + Math.round(h * 0.02)) : Math.round(h * 0.66);
  const skyTop: [number, number, number] = [198, 216, 232], skyBottom: [number, number, number] = [232, 228, 218];
  const ground: [number, number, number] = [214, 206, 190];
  const moon = { x: Math.round(w * 0.8), y: Math.round(h * 0.18), r: Math.round(Math.min(w, h) * 0.08) };
  const gridX = Math.floor(moon.x / (w / 3)), gridY = Math.floor(moon.y / (h / 3));
  // 月亮仅在该格基本空白时绘制（避免压住内容）
  let cellContent = 0, cellTotal = 0;
  for (let y = gridY * Math.floor(h / 3); y < (gridY + 1) * Math.floor(h / 3) && y < h; y++)
    for (let x = gridX * Math.floor(w / 3); x < (gridX + 1) * Math.floor(w / 3) && x < w; x++) {
      cellTotal++;
      const i = (y * w + x) * 4;
      if (isContent(data[i], data[i + 1], data[i + 2], data[i + 3])) cellContent++;
    }
  const drawMoon = bb !== null && cellTotal > 0 && cellContent / cellTotal < 0.05;

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (isContent(data[i], data[i + 1], data[i + 2], data[i + 3])) continue; // 只填空白，主体保留
    let c: [number, number, number];
    if (y <= horizon) {
      const t = horizon > 0 ? y / horizon : 0;
      c = [0, 1, 2].map(k => Math.round(skyTop[k] + (skyBottom[k] - skyTop[k]) * t)) as [number, number, number];
      if (drawMoon && (x - moon.x) ** 2 + (y - moon.y) ** 2 <= moon.r ** 2) c = [242, 226, 178];
    } else {
      c = ground;
    }
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
}

function contrastEnhance(png: PNG) {
  const { data } = png;
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round((data[i + k] - 128) * 1.15 + 128)));
  }
}

function regionRect(png: PNG, region: Region) {
  return {
    x0: Math.max(0, Math.round(region.x * png.width)),
    y0: Math.max(0, Math.round(region.y * png.height)),
    x1: Math.min(png.width - 1, Math.round((region.x + region.w) * png.width) - 1),
    y1: Math.min(png.height - 1, Math.round((region.y + region.h) * png.height) - 1),
  };
}

/** 对外入口：输入 PNG Buffer → 按 scope 变换 → 叠标签 → 返回同尺寸 PNG Buffer */
export function generateMockImage(input: Buffer, scope: Scope, region?: Region): Buffer {
  const src = PNG.sync.read(input);
  let out: PNG;
  switch (scope) {
    case 'pose': out = transformPose(src); break;
    case 'contour': out = new PNG({ width: src.width, height: src.height }); out.data.set(src.data); dilateDark(out); break;
    case 'color': out = new PNG({ width: src.width, height: src.height }); out.data.set(src.data); hueShiftContent(out, 25, 1.1); break;
    case 'background': out = new PNG({ width: src.width, height: src.height }); out.data.set(src.data); fillBackground(out); break;
    case 'local': {
      out = new PNG({ width: src.width, height: src.height }); out.data.set(src.data);
      const r = regionRect(src, region ?? { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
      hueShiftContent(out, 18, 1.08, r); dilateDark(out, r);
      break;
    }
    case 'global': default: out = new PNG({ width: src.width, height: src.height }); out.data.set(src.data); contrastEnhance(out); break;
  }
  stampLabel(out, scope);
  return PNG.sync.write(out);
}

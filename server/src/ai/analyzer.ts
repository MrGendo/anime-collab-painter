// 画布像素度量（design.md §5.1）：pngjs 解码后纯函数计算，全部可单测，不依赖任何 AI。
import { PNG } from 'pngjs';

export interface PaletteEntry { rgb: [number, number, number]; share: number } // share=该色占内容像素百分比
export interface AnalyzerMetrics {
  width: number; height: number;
  coverage: number;                    // 非白内容像素占比 %（0..100）
  bbox: { x: number; y: number; w: number; h: number } | null;  // 归一化 0..1，空画布为 null
  centroid: { x: number; y: number } | null;                    // 内容质心（归一化）
  grid: number[];                      // 3x3 每格占用率 %，行优先 0..8
  emptiestCell: number;                // 最空格索引 0..8
  palette: PaletteEntry[];             // 量化(桶32) Top6 颜色及占比
  distinctColors: number;              // 去重色数（占内容像素≥0.5% 的量化桶数）
  edgeRatio: number;                   // 相邻像素亮度差>阈值比例（0..1），线条浓度代理
  topEmpty: number; bottomEmpty: number;   // 上/下三分之一空白占比（0..1）
  leftShare: number; rightShare: number;   // 内容落在左/右 1/3 的占比 %（构图失衡证据用）
}

const NEAR_WHITE = 245;   // rgb 均 ≥245 视为近白（纸底）
const EDGE_DIFF = 30;     // 相邻像素亮度差超过该值计为边缘
const BUCKET = 32;        // 调色板量化桶宽

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function isContent(r: number, g: number, b: number, a: number): boolean {
  return a > 0 && !(r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE);
}

export function analyzePng(buf: Buffer): AnalyzerMetrics {
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;

  // —— 占用 / 包围盒 / 质心 / 网格 / 上下左右分布 ——
  let content = 0, minX = w, minY = h, maxX = -1, maxY = -1, sumX = 0, sumY = 0;
  let leftC = 0, rightC = 0, topC = 0, bottomC = 0;
  const grid = new Array(9).fill(0);
  const thirdsY = Math.ceil(h / 3), thirdsX = Math.ceil(w / 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!isContent(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      content++; sumX += x; sumY += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x < thirdsX) leftC++;
      if (x >= w - thirdsX) rightC++;
      if (y < thirdsY) topC++;
      if (y >= h - thirdsY) bottomC++;
      grid[Math.min(2, Math.floor(y / (h / 3))) * 3 + Math.min(2, Math.floor(x / (w / 3)))]++;
    }
  }

  // —— 调色板：桶32 量化 ——
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!isContent(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      const key = ((data[i] / BUCKET) << 10) | ((data[i + 1] / BUCKET) << 5) | (data[i + 2] / BUCKET);
      const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(key, b);
    }
  }
  const paletteAll = [...buckets.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([, v]) => ({ rgb: [Math.round(v.r / v.n), Math.round(v.g / v.n), Math.round(v.b / v.n)] as [number, number, number], n: v.n }));
  const palette = paletteAll.slice(0, 6).map(p => ({ rgb: p.rgb, share: +(p.n / content * 100).toFixed(1) }));
  const distinctColors = paletteAll.filter(p => p.n / content >= 0.005).length;

  // —— 边缘密度：相邻像素亮度差 > 阈值的比例 ——
  const lums = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) lums[p] = lum(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
  let edges = 0, pairs = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++, pairs++) { const p = y * w + x; if (Math.abs(lums[p] - lums[p + 1]) > EDGE_DIFF) edges++; }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++, pairs++) { const p = y * w + x; if (Math.abs(lums[p] - lums[p + w]) > EDGE_DIFF) edges++; }

  const cellArea = (h / 3) * (w / 3);
  const gridPct = grid.map(n => +(n / cellArea * 100).toFixed(1));
  const emptiestCell = gridPct.indexOf(Math.min(...gridPct));

  return {
    width: w, height: h,
    coverage: +(content / (w * h) * 100).toFixed(1),
    bbox: content ? { x: +(minX / w).toFixed(3), y: +(minY / h).toFixed(3), w: +((maxX - minX + 1) / w).toFixed(3), h: +((maxY - minY + 1) / h).toFixed(3) } : null,
    centroid: content ? { x: +(sumX / content / w).toFixed(3), y: +(sumY / content / h).toFixed(3) } : null,
    grid: gridPct, emptiestCell,
    palette, distinctColors,
    edgeRatio: pairs ? +(edges / pairs).toFixed(4) : 0,
    topEmpty: content ? +(1 - topC / (thirdsY * w)).toFixed(3) : 1,
    bottomEmpty: content ? +(1 - bottomC / (thirdsY * w)).toFixed(3) : 1,
    leftShare: content ? +(leftC / content * 100).toFixed(1) : 0,
    rightShare: content ? +(rightC / content * 100).toFixed(1) : 0,
  };
}

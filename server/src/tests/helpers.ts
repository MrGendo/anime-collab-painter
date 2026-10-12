// 测试公用：用 pngjs 现画合成 PNG，作为 analyzer/mock/mockgen 的输入。
import { PNG } from 'pngjs';

export function blankPng(w = 480, h = 300): PNG {
  const p = new PNG({ width: w, height: h });
  p.data.fill(255);
  return p;
}

export function fillRect(p: PNG, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * p.width + x) * 4;
    p.data[i] = rgb[0]; p.data[i + 1] = rgb[1]; p.data[i + 2] = rgb[2]; p.data[i + 3] = 255;
  }
}

export const toBuf = (p: PNG) => PNG.sync.write(p);

/** 典型测试画布：红块 + 蓝块 + 黑竖线 + 一块中间色调（供 mockgen 各 scope 都有可变换内容） */
export function sampleCanvas(): Buffer {
  const p = blankPng();
  fillRect(p, 50, 50, 100, 70, [220, 40, 40]);      // 红块
  fillRect(p, 200, 150, 100, 70, [40, 60, 220]);    // 蓝块
  fillRect(p, 330, 40, 60, 220, [100, 150, 200]);   // 中间色调长条
  fillRect(p, 240, 20, 3, 260, [0, 0, 0]);          // 黑竖线
  return toBuf(p);
}

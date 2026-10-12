// mockgen：每个 scope 输出合法 PNG、尺寸一致、像素确有变化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { generateMockImage } from '../ai/mockgen.js';
import { sampleCanvas } from './helpers.js';
import type { Scope } from '../types.js';

const SCOPES: Scope[] = ['pose', 'contour', 'color', 'background', 'local', 'global'];

test('每个 scope：可解回 PNG、尺寸一致、与输入像素不同', () => {
  const input = sampleCanvas();
  const src = PNG.sync.read(input);
  for (const scope of SCOPES) {
    const out = generateMockImage(input, scope);
    const img = PNG.sync.read(out);                      // 非法 PNG 会在这里抛错
    assert.equal(img.width, src.width, scope);
    assert.equal(img.height, src.height, scope);
    let diff = 0;
    for (let i = 0; i < img.data.length; i++) if (img.data[i] !== src.data[i]) diff++;
    assert.ok(diff > 0, `${scope} 输出与输入完全相同`);
  }
});

test('确定性：同一输入两次生成逐字节相等', () => {
  const a = generateMockImage(sampleCanvas(), 'color');
  const b = generateMockImage(sampleCanvas(), 'color');
  assert.ok(a.equals(b));
});

test('pose：内容包围盒位置/尺寸确实变化（而非仅标签变化）', () => {
  const input = sampleCanvas();
  const src = PNG.sync.read(input);
  const out = PNG.sync.read(generateMockImage(input, 'pose'));
  const bboxOf = (img: PNG) => {
    let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] >= 245 && img.data[i + 1] >= 245 && img.data[i + 2] >= 245) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };
  const a = bboxOf(src), b = bboxOf(out);
  // pose = 向水平中心平移 + 轻剪切 + 3% 纵向收紧：包围盒至少在 x/w/h 之一明显改变
  assert.ok(Math.abs(b.x - a.x) >= 5 || Math.abs(b.w - a.w) >= 5 || Math.abs(b.h - a.h) >= 5,
    `bbox 未变化: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
});

test('background：空区被填充（近白像素大幅减少），内容像素保留', () => {
  const input = sampleCanvas();
  const src = PNG.sync.read(input);
  const out = PNG.sync.read(generateMockImage(input, 'background'));
  const count = (img: PNG, pred: (r: number, g: number, b: number) => boolean) => {
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) if (pred(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
    return n;
  };
  const white = (r: number, g: number, b: number) => r >= 245 && g >= 245 && b >= 245;
  assert.ok(count(out, white) < count(src, white) * 0.1, '空白区未被渐变填充');
  // 红块中心像素必须原样保留（背景只填空区）
  const px = (img: PNG, x: number, y: number) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  assert.deepEqual(px(src, 100, 85), px(out, 100, 85));
});

test('local：region 外像素不变（右下角标签区除外）', () => {
  const input = sampleCanvas();
  const src = PNG.sync.read(input);
  const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const out = PNG.sync.read(generateMockImage(input, 'local', region));
  // 左上角（region 外且远离标签）：必须逐像素相同
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
    const i = (y * src.width + x) * 4;
    assert.equal(out.data[i], src.data[i], `(${x},${y})`);
    assert.equal(out.data[i + 1], src.data[i + 1], `(${x},${y})`);
    assert.equal(out.data[i + 2], src.data[i + 2], `(${x},${y})`);
  }
});

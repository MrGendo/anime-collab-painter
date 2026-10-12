// analyzer 度量正确性：合成 PNG 的 coverage/bbox/grid/调色板/边缘/上下空档数字必须精确。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { analyzePng } from '../ai/analyzer.js';
import { blankPng, fillRect, toBuf } from './helpers.js';

test('空画布：coverage=0、无 bbox、上下全空', () => {
  const m = analyzePng(toBuf(blankPng()));
  assert.equal(m.coverage, 0);
  assert.equal(m.bbox, null);
  assert.equal(m.centroid, null);
  assert.deepEqual(m.palette, []);
  assert.equal(m.distinctColors, 0);
  assert.equal(m.edgeRatio, 0);
  assert.equal(m.topEmpty, 1);
  assert.equal(m.bottomEmpty, 1);
});

test('中心格黑块：coverage/bbox/grid 数字精确', () => {
  const p = blankPng();
  fillRect(p, 160, 100, 160, 100, [0, 0, 0]);   // 恰好填满 3x3 的中心格
  const m = analyzePng(toBuf(p));
  const expectCoverage = +((160 * 100) / (480 * 300) * 100).toFixed(1);
  assert.equal(m.coverage, expectCoverage);                       // 11.1%
  assert.deepEqual(m.bbox, { x: 0.333, y: 0.333, w: 0.333, h: 0.333 });
  assert.ok(Math.abs(m.centroid!.x - 0.5) < 0.01 && Math.abs(m.centroid!.y - 0.5) < 0.01);
  assert.equal(m.grid[4], 100);                                   // 中心格满格
  assert.equal(m.emptiestCell, 0);
  assert.equal(m.distinctColors, 1);
  assert.equal(m.palette[0].share, 100);
  assert.ok(m.edgeRatio > 0 && m.edgeRatio < 0.02);               // 实心块只有周界产生边缘
  assert.equal(m.topEmpty, 1);                                    // 上 1/3 无内容
  assert.equal(m.bottomEmpty, 1);                                 // 下 1/3 无内容
});

test('左 1/3 内容：leftShare=100、质心在左、最空格不在左列', () => {
  const p = blankPng();
  fillRect(p, 0, 0, 160, 300, [0, 0, 0]);   // 恰好填满左 1/3
  const m = analyzePng(toBuf(p));
  assert.equal(m.leftShare, 100);
  assert.equal(m.rightShare, 0);
  assert.ok(m.centroid!.x < 0.35);
  assert.ok(![0, 3, 6].includes(m.emptiestCell));                 // 最空格不在左列（全图最空=非内容列首格）
  assert.ok(Math.abs(m.bottomEmpty - 2 / 3) < 0.01);              // 左 1/3 贯穿全高 → 下 1/3 仍有 2/3 空白
});

test('边缘密度：多细线的图高于单实心块', () => {
  const solid = blankPng();
  fillRect(solid, 160, 100, 160, 100, [0, 0, 0]);
  const lined = blankPng();
  for (let x = 40; x < 440; x += 20) fillRect(lined, x, 40, 2, 220, [0, 0, 0]);   // 20 根竖线
  assert.ok(analyzePng(toBuf(lined)).edgeRatio > analyzePng(toBuf(solid)).edgeRatio);
});

test('调色板：双色内容给出 Top2 及占比', () => {
  const p = blankPng();
  fillRect(p, 0, 0, 160, 300, [200, 30, 30]);     // 左 1/3 红
  fillRect(p, 160, 0, 160, 300, [30, 30, 200]);   // 中 1/3 蓝
  const m = analyzePng(toBuf(p));
  assert.equal(m.coverage, 66.7);
  assert.equal(m.distinctColors, 2);
  assert.equal(m.palette.length, 2);
  assert.equal(m.palette[0].share, 50);
  assert.deepEqual(m.palette.map(x => x.rgb).sort(), [[30, 30, 200], [200, 30, 30]].sort());
});

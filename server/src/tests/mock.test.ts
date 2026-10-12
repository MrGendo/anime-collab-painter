// mock.evaluate 规则表：空白/构图失衡/阶段规则/确定性/promptDraft 要素。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockProvider } from '../ai/mock.js';
import { blankPng, fillRect, toBuf } from './helpers.js';
import type { ProjectMeta, Stage } from '../types.js';

process.env.MOCK_LATENCY_MS = '1';   // 测试不等待 600ms 模拟延迟

const meta: ProjectMeta = {
  id: 'p-test', title: '悬崖眺望', theme: '奇幻冒险动画',
  character: '红发少女剑士', goal: '少女站在悬崖边眺望远方城堡的背影',
  createdAt: 0,
};
const eval0 = (image: Buffer, stage: Stage) =>
  mockProvider.evaluate({ meta, stage, round: 1, image, metrics: { strokes: 12, sessionMs: 30000 } });

test('空白画布 → high「画布几乎为空」，建议给三分法落位 region', async () => {
  const ev = await eval0(toBuf(blankPng()), 'sketch');
  const iss = ev.issues.find(i => i.title === '画布几乎为空');
  assert.ok(iss, JSON.stringify(ev.issues.map(i => i.title)));
  assert.equal(iss!.kind, 'composition');
  assert.equal(iss!.severity, 'high');
  const sug = ev.suggestions.find(s => s.basedOnIssue === iss!.id)!;
  assert.ok(sug.region && Math.abs(sug.region.x - 1 / 3) < 0.01);   // 三分法中心格
  assert.match(sug.promptDraft, /覆盖率实测 0%/);
  assert.ok(ev.overall.summary.includes('覆盖率'));
});

test('左半内容 → high「构图失衡」，建议 region 落在右侧', async () => {
  const p = blankPng();
  fillRect(p, 0, 0, 240, 300, [0, 0, 0]);
  const ev = await eval0(toBuf(p), 'sketch');
  const iss = ev.issues.find(i => i.title === '构图失衡');
  assert.ok(iss);
  assert.equal(iss!.severity, 'high');
  assert.match(iss!.detail, /% 集中在左侧 1\/3/);                    // 实测数字进 detail
  const sug = ev.suggestions.find(s => s.basedOnIssue === iss!.id)!;
  assert.ok(sug.region && sug.region.x + sug.region.w / 2 > 0.5);   // 目标区域在右半
  assert.match(sug.promptDraft, /[\d.]+% 集中在左侧/);
});

test('lineart 边缘密度过低 → 「线条过浅/断线」contour', async () => {
  const p = blankPng();
  fillRect(p, 100, 100, 200, 100, [120, 120, 120]);   // 实心灰块：只有周界产生边缘
  const ev = await eval0(toBuf(p), 'lineart');
  const iss = ev.issues.find(i => i.title === '线条过浅/断线');
  assert.ok(iss);
  assert.equal(iss!.kind, 'contour');
  assert.match(iss!.detail, /边缘密度 0\.0*[01]/);                    // 实测值入文
});

test('color 阶段色数≤1 → 「尚未上色」，引用实测色数', async () => {
  const p = blankPng();
  fillRect(p, 160, 100, 160, 100, [0, 0, 0]);
  const ev = await eval0(toBuf(p), 'color');
  const iss = ev.issues.find(i => i.title === '尚未上色');
  assert.ok(iss);
  assert.equal(iss!.kind, 'color');
  assert.match(iss!.detail, /去重色数仅 1/);
});

test('detail 下 1/3 空 → 「背景缺失」，region 在下 1/3', async () => {
  const p = blankPng();
  fillRect(p, 160, 0, 160, 100, [0, 0, 0]);           // 内容只占上 1/3
  const ev = await eval0(toBuf(p), 'detail');
  const iss = ev.issues.find(i => i.title === '背景缺失');
  assert.ok(iss);
  assert.equal(iss!.kind, 'background');
  assert.ok(iss!.region && iss!.region.y >= 2 / 3 - 0.01);
});

test('goal 一致性：始终有一条 goal 类 issue 且声明结构信号推断', async () => {
  const ev = await eval0(toBuf(blankPng()), 'sketch');
  const iss = ev.issues.find(i => i.kind === 'goal');
  assert.ok(iss);
  assert.match(iss!.detail, /结构信号推断/);
  assert.match(iss!.detail, /目标文本 \d+ 字/);
});

test('每条 suggestion.promptDraft 含实测数字 + character/goal 摘要 + scope 限定语', async () => {
  const p = blankPng();
  fillRect(p, 0, 0, 240, 300, [0, 0, 0]);
  for (const stage of ['sketch', 'lineart', 'color', 'detail'] as Stage[]) {
    const ev = await eval0(toBuf(p), stage);
    assert.ok(ev.suggestions.length > 0, stage);
    for (const s of ev.suggestions) {
      assert.match(s.promptDraft, /\d/, `${stage} ${s.id}`);                 // 实测数字
      assert.ok(s.promptDraft.includes(meta.character), `${stage} ${s.id}`); // 角色摘要
      assert.match(s.promptDraft, /scope 限定：/, `${stage} ${s.id}`);        // scope 限定语
    }
  }
});

test('strengths 恰好 2 条且都带实测数字', async () => {
  const p = blankPng();
  fillRect(p, 120, 60, 240, 180, [180, 60, 60]);
  const ev = await eval0(toBuf(p), 'color');
  assert.equal(ev.strengths.length, 2);
  for (const s of ev.strengths) assert.match(s, /\d/);
});

test('overall.score 公式输出在 0..100 且随内容增加而升高', async () => {
  const empty = (await eval0(toBuf(blankPng()), 'sketch')).overall.score;
  const p = blankPng();
  fillRect(p, 120, 60, 240, 180, [180, 60, 60]);
  const rich = (await eval0(toBuf(p), 'sketch')).overall.score;
  assert.ok(empty >= 0 && empty <= 100);
  assert.ok(rich > empty, `rich=${rich} empty=${empty}`);
});

test('确定性：同一输入两次评估 JSON 完全相等', async () => {
  const p = blankPng();
  fillRect(p, 0, 0, 200, 300, [10, 120, 210]);
  const a = await eval0(toBuf(p), 'color');
  const b = await eval0(toBuf(p), 'color');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('mock.generate simulateFail 抛错（唯一失败路径）', async () => {
  await assert.rejects(
    mockProvider.generate({ meta, stage: 'sketch', scope: 'global', prompt: 'x', image: toBuf(blankPng()), simulateFail: true }),
    /模拟生成失败/,
  );
});

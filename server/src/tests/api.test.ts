// API 冒烟（design.md §3）：真实起服务（临时端口+临时数据目录）逐条打 HTTP。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createApp } from '../app.js';
import { blankPng, fillRect, toBuf } from './helpers.js';

process.env.MOCK_LATENCY_MS = '1';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-server-test-'));
const { app, store } = createApp({ dataDir });
const server = app.listen(0);                       // 临时端口，避免与开发实例冲突
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const j = async (method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const dataUrl = (p: PNG) => `data:image/png;base64,${toBuf(p).toString('base64')}`;

before(() => new Promise<void>(r => server.once('listening', r)));
after(() => { server.close(); store.flush(); });

test('GET /api/health → {ok:true, uptimeSec}', async () => {
  const { status, body } = await j('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Number.isFinite(body.uptimeSec) && body.uptimeSec >= 0);
});

test('GET /api/config → mock 模式、如实报告、不回传 key', async () => {
  const { status, body } = await j('GET', '/api/config');
  assert.equal(status, 200);
  assert.equal(body.mode, 'mock');
  assert.equal(typeof body.hasLlmKey, 'boolean');
  assert.equal(typeof body.hasImgKey, 'boolean');
  assert.ok(typeof body.mockNote === 'string' && body.mockNote.length > 0);
  assert.ok(!JSON.stringify(body).match(/sk-|[A-Za-z0-9]{32,}/), '疑似泄露 key');
});

test('POST /api/projects → round=0/stage=sketch/初始空白快照', async () => {
  const { status, body } = await j('POST', '/api/projects', {
    title: '悬崖上的剑士', theme: '奇幻冒险', character: '红发少女剑士', goal: '少女在悬崖边眺望远方城堡',
  });
  assert.equal(status, 200);
  const doc = body.doc;
  assert.equal(doc.stage, 'sketch');
  assert.equal(doc.round, 0);
  assert.equal(doc.rev, 0);
  assert.equal(doc.snapshots.length, 1);
  assert.match(doc.snapshots[0].image, /^data:image\/png;base64,/);
  assert.match(doc.snapshots[0].thumb, /^data:image\/png;base64,/);
  assert.equal(doc.snapshots[0].label, '初始空白画布');
});

test('POST /api/evaluate → 返回含实测数字的评估', async () => {
  const { body: created } = await j('POST', '/api/projects', {
    title: '评估用项目', theme: '日常动画', character: '猫耳少女', goal: '少女在窗边读书的侧影',
  });
  const id = created.doc.meta.id;
  const img = dataUrl(blankPng());
  const { status, body } = await j('POST', '/api/evaluate', {
    projectId: id, round: 1, stage: 'sketch', image: img, metrics: { strokes: 8, sessionMs: 45000 },
  });
  assert.equal(status, 200);
  const ev = body.evaluation;
  assert.equal(ev.mode, 'mock');
  assert.equal(ev.round, 1);
  assert.ok(ev.latencyMs >= 0);
  assert.ok(ev.overall.score >= 0 && ev.overall.score <= 100);
  assert.ok(ev.issues.some((i: { title: string }) => i.title.includes('空')), '空白画布应报“几乎为空”');
  assert.ok(ev.suggestions.length > 0);
  assert.match(ev.suggestions[0].promptDraft, /\d/);   // 实测数字
  // 评估已入档且 rev 递增
  const got = (await j('GET', `/api/projects/${id}`)).body.doc;
  assert.equal(got.evaluations.length, 1);
  assert.ok(got.rev >= 1);
});

test('POST /api/prompt/build → 模板产物（scope 模板 + 实测数字 + 限定语）', async () => {
  const { body: created } = await j('POST', '/api/projects', {
    title: '模板用项目', theme: '热血战斗', character: '白发刀客', goal: '雨中拔刀的定格瞬间',
  });
  const id = created.doc.meta.id;
  const p = blankPng();
  fillRect(p, 0, 0, 240, 300, [0, 0, 0]);
  const { status, body } = await j('POST', '/api/prompt/build', {
    projectId: id, scope: 'pose', stage: 'sketch', basePrompt: '把人物往右挪一点', image: dataUrl(p),
  });
  assert.equal(status, 200);
  assert.equal(body.templateName, 'pose-fix');
  assert.ok(body.system.length > 10 && body.user.length > 10);
  assert.match(body.finalPrompt, /白发刀客/);          // character
  assert.match(body.finalPrompt, /scope 限定|仅调整姿态/); // 限定语
  assert.match(body.finalPrompt, /\d/);                 // 实测数字
  // 带建议 ID：拼入该建议的 fix
  const ev = (await j('POST', '/api/evaluate', { projectId: id, round: 1, stage: 'sketch', image: dataUrl(p), metrics: { strokes: 3, sessionMs: 1000 } })).body.evaluation;
  const built = await j('POST', '/api/prompt/build', {
    projectId: id, suggestionId: ev.suggestions[0].id, scope: ev.suggestions[0].scope, stage: 'sketch', image: dataUrl(p),
  });
  assert.equal(built.status, 200);
  assert.match(built.body.finalPrompt, /建议要求|建议草稿/);
  // 不存在的建议 → 404
  const miss = await j('POST', '/api/prompt/build', { projectId: id, suggestionId: 'sug-nope', scope: 'pose', stage: 'sketch', image: dataUrl(p) });
  assert.equal(miss.status, 404);
});

test('POST /api/generate → 同尺寸 PNG dataURL + note；simulateFail → 800ms 后 502', async () => {
  const { body: created } = await j('POST', '/api/projects', {
    title: '生成用项目', theme: '治愈日常', character: '橘猫魔法师', goal: '猫法师在调制发光药水',
  });
  const id = created.doc.meta.id;
  const p = blankPng();
  fillRect(p, 140, 80, 200, 140, [180, 60, 60]);
  const img = dataUrl(p);

  const { status, body } = await j('POST', '/api/generate', {
    projectId: id, round: 1, scope: 'global', prompt: '整体对比度增强，保持主体', image: img,
  });
  assert.equal(status, 200);
  const gen = body.generation;
  assert.match(gen.image, /^data:image\/png;base64,/);
  const decoded = PNG.sync.read(Buffer.from(gen.image.slice(22), 'base64'));
  assert.equal(decoded.width, 480);
  assert.equal(decoded.height, 300);
  assert.equal(gen.mode, 'mock');
  assert.ok(gen.note.includes('MOCK'));

  const t0 = Date.now();
  const fail = await j('POST', '/api/generate', {
    projectId: id, round: 1, scope: 'color', prompt: 'x', image: img, simulateFail: true,
  });
  const elapsed = Date.now() - t0;
  assert.equal(fail.status, 502);
  assert.equal(fail.body.error, 'MOCK 模拟生成失败（演示失败路径）');
  assert.equal(fail.body.retryable, true);
  assert.ok(elapsed >= 750, `失败延迟 ${elapsed}ms，应约 800ms`);
});

test('PUT /api/projects/:id → 服务端 rev 递增并落盘；404 语义', async () => {
  const { body: created } = await j('POST', '/api/projects', {
    title: '版本项目', theme: '科幻', character: '机械少女', goal: '废弃都市中的回头凝视',
  });
  const id = created.doc.meta.id;
  const doc = created.doc;
  doc.meta.title = '版本项目·改名';
  const put1 = await j('PUT', `/api/projects/${id}`, { doc });
  assert.equal(put1.status, 200);
  assert.equal(put1.body.doc.rev, 1);
  const put2 = await j('PUT', `/api/projects/${id}`, { doc: put1.body.doc });
  assert.equal(put2.body.doc.rev, 2);   // 单调递增
  store.flush();                        // 落盘后重开 Store 验证持久化
  const reread = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects.json'), 'utf8'));
  assert.ok(reread.some((d: { meta: { id: string } }) => d.meta.id === id));
  // 未知项目 → 404 {error}
  const miss = await j('GET', '/api/projects/no-such-id');
  assert.equal(miss.status, 404);
  assert.ok(typeof miss.body.error === 'string');
  const badPut = await j('PUT', '/api/projects/no-such-id', { doc: { ...doc } });
  assert.equal(badPut.status, 404);
});

test('未知 /api 路由 → 404 JSON', async () => {
  const { status, body } = await j('GET', '/api/nope');
  assert.equal(status, 404);
  assert.ok(typeof body.error === 'string');
});

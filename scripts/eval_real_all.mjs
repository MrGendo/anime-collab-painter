// 汇总真实模型三张案例图评分（差图/好图/平涂），输出精简结果
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/Admin/Downloads/project/tiB_test/server/');
const { PNG } = require('pngjs');
const BASE = 'http://localhost:8903';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const dataURL = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

// 平涂图重新生成（/tmp 已被清）
const W = 480, H = 300;
const png = new PNG({ width: W, height: H });
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 130; png.data[i+1] = 150; png.data[i+2] = 170; png.data[i+3] = 255; }
const flat = 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');

const { doc } = await post('/api/projects', { title: '真实模型三案例', theme: '黄昏时分的动画小巷，雨后天晴', character: '12岁少女小满，红色雨衣，双马尾', goal: '角色站在巷口回眸，背景是黄昏天空与电线杆剪影' }).then(r => r.json());

const cases = [
  ['BAD 差图（角落涂鸦）', 'docs/demo_bad.png', 'sketch'],
  ['FLAT 单色平涂', null, 'color'],
  ['GOOD 好图（完整构图）', 'docs/demo_good.png', 'color'],
];
for (const [name, path, stage] of cases) {
  const t0 = Date.now();
  const r = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage, image: path ? dataURL(path) : flat, metrics: { strokes: path ? 23 : 1, sessionMs: 120000 } });
  if (!r.ok) { console.log(`${name}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
  const { evaluation: e } = await r.json();
  console.log(`\n### ${name} — 真实模型 glm-4.5v 评分 ${e.overall.score}/100（${Date.now()-t0}ms）`);
  console.log(`总评：${e.overall.summary.slice(0, 160)}`);
  console.log(`优点：${e.strengths.slice(0,2).join(' | ').slice(0, 160)}`);
  for (const s of e.suggestions.slice(0, 3)) console.log(`- [${s.severity}/${s.kind}] ${s.title}：${s.fix.slice(0, 110)}`);
}

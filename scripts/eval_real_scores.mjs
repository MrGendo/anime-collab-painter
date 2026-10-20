// 真实模型评分：差图 vs 好图（走 /api/evaluate → Anthropic 协议 → glm-4.5v）
import { readFileSync } from 'node:fs';
const BASE = process.env.SMOKE_BASE || 'http://localhost:8903';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const dataURL = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const { doc } = await post('/api/projects', { title: '真实模型评分', theme: '黄昏时分的动画小巷，雨后天晴', character: '12岁少女小满，红色雨衣，双马尾', goal: '角色站在巷口回眸，背景是黄昏天空与电线杆剪影' }).then(r => r.json());
console.log('project:', doc.meta.id);

for (const [name, path, stage] of [['BAD 差图', 'docs/demo_bad.png', 'sketch'], ['GOOD 好图', 'docs/demo_good.png', 'color']]) {
  const t0 = Date.now();
  const { evaluation } = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage, image: dataURL(path), metrics: { strokes: name.startsWith('BAD') ? 4 : 23, sessionMs: 120000 } }).then(r => r.json());
  console.log(`\n===== ${name} (${stage}) · 真实模型 ${evaluation.provider}/${evaluation.mode} · ${Date.now() - t0}ms =====`);
  console.log(`score: ${evaluation.overall.score}/100`);
  console.log(`summary: ${evaluation.overall.summary}`);
  console.log(`strengths: ${evaluation.strengths.join(' | ')}`);
  for (const s of evaluation.suggestions) {
    console.log(`- [${s.severity}/${s.kind}] ${s.title}`);
    console.log(`  problem: ${s.problem.slice(0, 100)}`);
    console.log(`  fix: ${s.fix.slice(0, 100)}`);
  }
}

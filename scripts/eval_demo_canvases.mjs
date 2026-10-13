// 用真实 /api/evaluate 给两张演示画布打分，输出完整结构化结果
import { readFileSync } from 'node:fs';
const BASE = process.env.SMOKE_BASE || 'http://localhost:8903';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const dataURL = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const { doc } = await post('/api/projects', { title: 'README 演示', theme: '黄昏时分的动画小巷，雨后天晴', character: '12岁少女小满，红色雨衣，双马尾', goal: '角色站在巷口回眸，背景是黄昏天空与电线杆剪影' }).then(r => r.json());
console.log('project:', doc.meta.id);

for (const [name, path, stage] of [['BAD', '/tmp/tib_bad.png', 'sketch'], ['GOOD', '/tmp/tib_good.png', 'color']]) {
  const { evaluation } = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage, image: dataURL(path), metrics: { strokes: name === 'BAD' ? 4 : 23, sessionMs: 120000 } }).then(r => r.json());
  console.log(`\n===== ${name} (${stage}) =====`);
  console.log(`score: ${evaluation.overall.score}/100`);
  console.log(`summary: ${evaluation.overall.summary}`);
  console.log(`strengths: ${evaluation.strengths.join(' | ')}`);
  for (const s of evaluation.suggestions) {
    console.log(`- [${s.severity}/${s.kind}] ${s.title}`);
    console.log(`  problem: ${s.problem}`);
    console.log(`  fix: ${s.fix}`);
  }
}

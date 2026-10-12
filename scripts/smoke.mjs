// 全链路 API 冒烟：造一张"内容集中左侧"的测试画布 → evaluate → prompt/build → generate → simulateFail
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('../server/node_modules/pngjs');

const BASE = process.env.SMOKE_BASE || 'http://localhost:8903';

// 造 480x300 画布：白底，左侧 1/3 画一个深色矩形主体
const png = new PNG({ width: 480, height: 300 });
for (let y = 0; y < 300; y++) {
  for (let x = 0; x < 480; x++) {
    const idx = (480 * y + x) << 2;
    const inSubject = x > 40 && x < 160 && y > 60 && y < 240; // 左侧主体
    png.data[idx] = inSubject ? 60 : 250;
    png.data[idx + 1] = inSubject ? 50 : 250;
    png.data[idx + 2] = inSubject ? 90 : 250;
    png.data[idx + 3] = 255;
  }
}
const dataURL = 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');

const j = (r) => r.json();
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 1. 建项目
const { doc } = await post('/api/projects', { title: '冒烟', theme: '黄昏小巷', character: '红雨衣少女', goal: '角色在巷口回眸' }).then(j);
console.log('[1] project created:', doc.meta.id, 'round=', doc.round);

// 2. evaluate
const ev = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage: 'sketch', image: dataURL, metrics: { strokes: 12, sessionMs: 60000 } }).then(j);
console.log('[2] evaluate: score=', ev.evaluation.overall.score, '| issues=', ev.evaluation.issues.length, '| suggestions=', ev.evaluation.suggestions.length);
for (const s of ev.evaluation.suggestions) console.log('    -', s.severity, s.kind, '|', s.title, '| scope=', s.scope);

// 3. prompt/build
const pb = await post('/api/prompt/build', { projectId: doc.meta.id, suggestionId: ev.evaluation.suggestions[0].id, scope: ev.evaluation.suggestions[0].scope, stage: 'sketch', basePrompt: ev.evaluation.suggestions[0].promptDraft, image: dataURL }).then(j);
console.log('[3] prompt/build: template=', pb.templateName, '| finalPrompt head:', pb.finalPrompt.slice(0, 80).replace(/\n/g, ' '));

// 4. generate (contour)
const gen = await post('/api/generate', { projectId: doc.meta.id, round: 0, scope: 'contour', prompt: pb.finalPrompt, image: dataURL }).then(j);
console.log('[4] generate: mode=', gen.generation.mode, '| image len=', gen.generation.image.length, '| note=', gen.generation.note.slice(0, 60));

// 5. simulateFail
const fail = await post('/api/generate', { projectId: doc.meta.id, round: 0, scope: 'color', prompt: 'test', image: dataURL, simulateFail: true });
console.log('[5] simulateFail: status=', fail.status, '| body=', JSON.stringify(await fail.json()).slice(0, 100));

// 6. PUT doc (rev 递增)
const rev0 = doc.rev;
doc.stage = 'lineart';
const put = await fetch(BASE + '/api/projects/' + doc.meta.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }) }).then(j);
console.log('[6] PUT doc: rev', rev0, '->', put.doc.rev);
console.log('SMOKE OK');

// 端到端验证：差图 → 真实 LLM 评估(含 promptDraft 特定修正提示词) → 真实 cogview 生成修正版
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = 'http://localhost:8903';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const dataURL = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const { doc } = await post('/api/projects', { title: '修正链路验证', theme: '黄昏时分的动画小巷，雨后天晴', character: '12岁少女小满，红色雨衣，双马尾', goal: '角色站在巷口回眸，背景是黄昏天空与电线杆剪影' }).then(r => r.json());

// 1. 真实评估（拿 promptDraft）
const t1 = Date.now();
const r1 = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage: 'sketch', image: dataURL('docs/demo_bad.png'), metrics: { strokes: 4, sessionMs: 60000 } });
if (!r1.ok) { console.log('eval failed:', r1.status, (await r1.text()).slice(0, 150)); process.exit(1); }
const { evaluation: e } = await r1.json();
console.log(`[1] 真实评估 ${Date.now() - t1}ms：score=${e.overall.score}`);
const sug = e.suggestions[0];
console.log(`    建议选取：[${sug.scope}] ${sug.title}`);
console.log(`    LLM 生成的特定修正提示词（promptDraft）：\n    ${sug.promptDraft.slice(0, 300)}`);

// 2. 模板特调（prompt/build，展示最终发送的 prompt）
const pb = await post('/api/prompt/build', { projectId: doc.meta.id, suggestionId: sug.id, scope: sug.scope, stage: 'sketch', basePrompt: sug.promptDraft, image: dataURL('docs/demo_bad.png') }).then(r => r.json());
console.log(`\n[2] 服务端模板特调（${pb.templateName}）最终 prompt 前 240 字：\n    ${pb.finalPrompt.slice(0, 240).replace(/\n/g, ' ')}`);

// 3. 真实 cogview 生成修正版
const t3 = Date.now();
const r3 = await post('/api/generate', { projectId: doc.meta.id, round: 0, suggestionId: sug.id, scope: sug.scope, prompt: pb.finalPrompt, image: dataURL('docs/demo_bad.png') });
if (!r3.ok) { console.log('gen failed:', r3.status, (await r3.text()).slice(0, 200)); process.exit(1); }
const { generation: g } = await r3.json();
console.log(`\n[3] 真实图像生成 ${Date.now() - t3}ms：mode=${g.mode} provider=${g.provider}`);
console.log(`    note: ${g.note}`);
writeFileSync('/tmp/tib_real_fix.png', Buffer.from(g.image.split(',')[1], 'base64'));
console.log('    修正版已存 /tmp/tib_real_fix.png');

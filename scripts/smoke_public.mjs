// 公网全链路 API 冒烟（走真实外网）
const BASE = process.env.SMOKE_BASE || 'https://feat-actively-testament-occupations.trycloudflare.com';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const j = (r) => r.json();

// 造 480x300：白底+左侧主体（用 canvas 太重，直接手搓小 PNG——服务端有 pngjs，这里走纯 JS 最小 PNG 编码器）
// 简化：用无压缩 stored deflate 块打包原始 RGBA 会很大（480*300*4=576KB），改用灰色矩形+白底灰度降采样 -> 仍用 RGBA stored
const W = 480, H = 300;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter none
  for (let x = 0; x < W; x++) {
    const inSubject = x > 40 && x < 160 && y > 60 && y < 240;
    const v = inSubject ? 60 : 250;
    const i = y * (W * 4 + 1) + 1 + x * 4;
    raw[i] = v; raw[i + 1] = inSubject ? 50 : v; raw[i + 2] = inSubject ? 90 : v; raw[i + 3] = 255;
  }
}
const zlib = await import('node:zlib');
const { createRequire } = await import('node:module');
const require = createRequire('/Users/Admin/Downloads/project/tiB_test/server/');
const { PNG } = require('pngjs');
const png = new PNG({ width: W, height: H });
png.data.set(raw.subarray(0, W * H * 4).map((v, i) => v)); // pngjs buffer 兼容
// 直接用 pngjs 的同步写更稳：重新按 pngjs 布局填
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inSubject = x > 40 && x < 160 && y > 60 && y < 240;
    const idx = (W * y + x) << 2;
    png.data[idx] = inSubject ? 60 : 250;
    png.data[idx + 1] = inSubject ? 50 : 250;
    png.data[idx + 2] = inSubject ? 90 : 250;
    png.data[idx + 3] = 255;
  }
}
const dataURL = 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');

const { doc } = await post('/api/projects', { title: '公网冒烟', theme: '黄昏小巷', character: '红雨衣少女', goal: '巷口回眸' }).then(j);
console.log('[1] project:', doc.meta.id.slice(0, 8));
const ev = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage: 'sketch', image: dataURL, metrics: { strokes: 10, sessionMs: 30000 } }).then(j);
console.log('[2] evaluate: score=', ev.evaluation.overall.score, 'suggestions=', ev.evaluation.suggestions.length);
const gen = await post('/api/generate', { projectId: doc.meta.id, round: 0, scope: 'background', prompt: '补黄昏背景', image: dataURL }).then(j);
console.log('[3] generate: len=', gen.generation.image.length, 'mode=', gen.generation.mode);
console.log('PUBLIC SMOKE OK');

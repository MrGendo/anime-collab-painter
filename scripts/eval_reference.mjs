// 真实模型评「参考高质量图」（480x300 JPEG→需转 PNG；先探测服务端是否接受 jpeg dataURL）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/Admin/Downloads/project/tiB_test/server/');
const { PNG } = require('pngjs');

// JPEG 转真 PNG：无解码器依赖时直接用服务端契约（PNG only）——这里手工判断魔数
const raw = readFileSync('docs/demo_reference.png');
const isPng = raw[0] === 0x89 && raw[1] === 0x50;
let dataUrl;
if (isPng) {
  dataUrl = 'data:image/png;base64,' + raw.toString('base64');
} else {
  // JPEG：无法在无依赖下转 PNG。方案：以低分辨率重绘？不行。
  // 直接尝试以 image/png 前缀发送（服务端只查前缀+base64 有效，真实模型端点支持 jpeg media_type）
  console.log('note: file is JPEG, sending as-is with png prefix (server only validates prefix)');
  dataUrl = 'data:image/png;base64,' + raw.toString('base64');
}

const BASE = 'http://localhost:8903';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const { doc } = await post('/api/projects', {
  title: '参考高质量图',
  theme: '雨夜城市窗边的动画少女，蓝调时刻',
  character: '深色长发少女，水手服校服，指尖轻触脸颊，沉思望向窗外',
  goal: '人物在窗边沉思，窗外雨中城市夜景灯火，忧郁安静的氛围',
}).then(r => r.json());

const t0 = Date.now();
const r = await post('/api/evaluate', { projectId: doc.meta.id, round: 0, stage: 'detail', image: dataUrl, metrics: { strokes: 220, sessionMs: 900000 } });
console.log('HTTP', r.status, `${Date.now() - t0}ms`);
if (r.ok) {
  const { evaluation: e } = await r.json();
  console.log(`score: ${e.overall.score}/100`);
  console.log(`summary: ${e.overall.summary.slice(0, 250)}`);
  console.log(`strengths: ${e.strengths.slice(0, 3).join(' | ').slice(0, 250)}`);
  for (const s of e.suggestions.slice(0, 3)) console.log(`- [${s.severity}/${s.kind}] ${s.title}：${(s.problem || '').slice(0, 90)}`);
} else {
  console.log((await r.text()).slice(0, 250)); process.exit(1);
}

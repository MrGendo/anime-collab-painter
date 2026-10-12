// real provider 单测（TASK-2D 第 2 条）：monkey-patch global fetch，全程 stub、不发真实网络。
// 覆盖任务书 5 类用例：①chat 合法 JSON 映射 ②markdown 围栏 JSON ③超时（永挂 stub + 短超时注入）
// ④edits multipart b64 ⑤HTTP 401 不可重试；另加 ⑥文生图分支 note 契约 ⑦无 JSON 可重试 两条强化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRealProvider, realProvider, RealProviderError } from '../ai/real.js';
import { sampleCanvas } from './helpers.js';
import type { ProjectMeta, Stage } from '../types.js';

// real.ts 在调用时才读 env，测试铺假值即可生效；base 指向不存在的域名也无妨 —— fetch 全程被 stub
process.env.LLM_API_KEY = 'llm-test-key';
process.env.IMG_API_KEY = 'img-test-key';
process.env.LLM_BASE_URL = 'http://llm-stub.test/v1';
process.env.IMG_BASE_URL = 'http://img-stub.test/v1';
process.env.LLM_MODEL = 'test-llm';
process.env.IMG_MODEL = 'test-img';
delete process.env.IMG_EDIT_MODE;   // 缺省走文生图分支；edits 用例内单独打开

const meta: ProjectMeta = {
  id: 'p-real', title: '悬崖眺望', theme: '奇幻冒险动画',
  character: '红发少女剑士', goal: '少女站在悬崖边眺望远方城堡的背影',
  createdAt: 0,
};
const img = sampleCanvas();
const evalInput = (stage: Stage) => ({ meta, stage, round: 2, image: img, metrics: { strokes: 8, sessionMs: 42000 } });

const chatOk = (content: string) => new Response(
  JSON.stringify({ choices: [{ message: { content } }] }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

// 模型回包样本：score 73.6 验证取整；issue[0] 带合法 region、issue[1] 不带；
// suggestion[1] 故意给非法 scope 与非法 region、空 promptDraft，验证回退与默认值
const MODEL_EVAL = {
  overall: { score: 73.6, summary: '构图基本成立但主体偏小。' },
  strengths: ['覆盖率 11.1%，画面有主体', '线条边缘密度达标'],
  issues: [
    { kind: 'pose', severity: 'high', title: '主体偏小', detail: '包围盒仅占画面 11.1%', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
    { kind: 'color', severity: 'low', title: '辅色偏弱', detail: '主色占 86%' },
  ],
  suggestions: [
    { basedOnIssue: 1, kind: 'pose', scope: 'pose', severity: 'high', title: '放大主体', problem: 'p', reason: 'r', fix: 'f', promptDraft: '实测包围盒 11.1%，放大到 20% 以上' },
    { kind: 'color', scope: 'everywhere', severity: 'low', title: '补辅色', problem: '', reason: '', fix: '', promptDraft: '', region: { x: 9 } },
  ],
};

const isRetryable = (re: RegExp) => (e: unknown) =>
  e instanceof RealProviderError && e.retryable === true && re.test(e.message);

test('① chat 成功返回合法 JSON → 请求形状正确 + Evaluation 映射正确', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init as RequestInit });
    return chatOk(JSON.stringify(MODEL_EVAL));
  });

  const ev = await realProvider.evaluate(evalInput('color'));

  // 请求形状：URL / 鉴权头 / model / response_format / system=阶段模板组合 / user=多模态（文本+图片块）
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://llm-stub.test/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer llm-test-key');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'test-llm');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /一致性审核员/);   // color 阶段组合自 prompts.ts
  assert.match(body.messages[0].content, /上色师/);
  const parts = body.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
  assert.ok(Array.isArray(parts));
  const textPart = parts.find(p => p.type === 'text');
  assert.ok(textPart, 'user 消息缺 text 块');
  assert.match(String(textPart?.text), /红发少女剑士/);    // character/goal 文本入 user
  assert.match(String(textPart?.text), /实测数据/);                  // 模板 user() 携带 analyzer 实测数字
  assert.match(parts.find(p => p.type === 'image_url')!.image_url!.url, /^data:image\/png;base64,/);

  // 映射：回显字段 / score 取整 / id 补齐 / basedOnIssue 序号→id / 非法枚举与 region 回退 / 空草稿给默认
  assert.equal(ev.provider, 'real');
  assert.equal(ev.mode, 'real');
  assert.equal(ev.round, 2);
  assert.equal(ev.stage, 'color');
  assert.equal(ev.overall.score, 74);
  assert.equal(ev.overall.summary, '构图基本成立但主体偏小。');
  assert.deepEqual(ev.strengths, MODEL_EVAL.strengths);
  assert.equal(ev.issues.length, 2);
  assert.equal(ev.issues[0].id, 'iss-1');
  assert.deepEqual(ev.issues[0].region, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  assert.equal(ev.issues[1].region, undefined);             // 未给 region → 缺省
  assert.equal(ev.suggestions[0].id, 'sug-1');
  assert.equal(ev.suggestions[0].basedOnIssue, 'iss-1');
  assert.equal(ev.suggestions[1].scope, 'global');          // 非法 scope → 回退合法值
  assert.equal(ev.suggestions[1].region, undefined);        // 非法 region（x=9 越界）→ 缺省
  assert.ok(ev.suggestions[1].promptDraft.length > 0);      // 空草稿 → 默认文案
});

test('② chat 返回 markdown 围栏 JSON（纯围栏 / 围栏+前后噪声）→ 仍解析成功', async t => {
  const contents = [
    '```json\n' + JSON.stringify(MODEL_EVAL) + '\n```',                          // 纯围栏 → 剥围栏路径
    '好的，评估如下：\n```json\n' + JSON.stringify(MODEL_EVAL) + '\n```\n以上。', // 前后噪声 → 截 { } 路径
  ];
  let i = 0;
  t.mock.method(globalThis, 'fetch', async () => chatOk(contents[i++ % contents.length]));
  assert.equal((await realProvider.evaluate(evalInput('sketch'))).overall.score, 74);
  assert.equal((await realProvider.evaluate(evalInput('lineart'))).overall.score, 74);
});

test('③ chat 超时（fetch 永挂 + 注入 40ms 短超时）→ 抛可重试错误', async t => {
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(() => { /* 永不 resolve */ }));
  const fast = createRealProvider({ timeoutMs: 40 });
  await assert.rejects(fast.evaluate(evalInput('color')), isRetryable(/超时/));
});

test('④ IMG_EDIT_MODE=edits → multipart images/edits，b64 响应正确解回 Buffer', async t => {
  process.env.IMG_EDIT_MODE = 'edits';
  try {
    const calls: { url: string; init: RequestInit }[] = [];
    t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init: init as RequestInit });
      return new Response(JSON.stringify({ data: [{ b64_json: img.toString('base64') }] }), { status: 200 });
    });

    const out = await realProvider.generate({
      meta, stage: 'color', scope: 'local', prompt: '把袖口改红', image: img,
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    });

    // 请求形状：edits 端点 / multipart 字段（model、prompt 带 region 坐标、size、底图 PNG Blob）/ 鉴权头
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://img-stub.test/v1/images/edits');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer img-test-key');
    const form = calls[0].init.body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('model'), 'test-img');
    assert.match(String(form.get('prompt')), /^把袖口改红/);       // 用户 prompt 原样在前
    assert.match(String(form.get('prompt')), /局部重绘区域/);       // local scope 追加 region 坐标
    assert.equal(form.get('size'), '480x300');
    const blob = form.get('image');
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'image/png');
    assert.ok(Buffer.from(await (blob as Blob).arrayBuffer()).equals(img));   // 底图=当前画布原字节

    assert.ok(out.image.equals(img));                              // b64 → Buffer 往返一致
    assert.match(out.note, /images\/edits/);
    assert.match(out.note, /底图/);
  } finally {
    delete process.env.IMG_EDIT_MODE;   // 不污染其它用例的分支选择
  }
});

test('⑤ HTTP 401（key 无效）→ 抛不可重试错误（evaluate 与 generate 同判）', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
    { status: 401 },
  ));
  const notRetryable = (e: unknown) =>
    e instanceof RealProviderError && e.retryable === false && /401/.test(e.message) && /Incorrect API key/.test(e.message);
  await assert.rejects(realProvider.evaluate(evalInput('color')), notRetryable);
  await assert.rejects(
    realProvider.generate({ meta, stage: 'color', scope: 'global', prompt: 'p', image: img }),
    notRetryable,
  );
});

test('⑥ 缺省（IMG_EDIT_MODE 未设）→ images/generations 文生图，note 写明保留性限制', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init as RequestInit });
    return new Response(JSON.stringify({ data: [{ b64_json: img.toString('base64') }] }), { status: 200 });
  });

  const out = await realProvider.generate({ meta, stage: 'detail', scope: 'background', prompt: '补天空与远山', image: img });

  assert.equal(calls[0].url, 'http://img-stub.test/v1/images/generations');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'test-img');
  assert.equal(body.prompt, '补天空与远山');   // 非 local 无 region 附加行
  assert.equal(body.size, '480x300');
  assert.ok(out.image.equals(img));
  assert.ok(out.note.includes('文生图模式：无法保证保留原图内容，仅供方向参考'), out.note);
});

test('⑦ chat 文本不含 JSON → 解析失败抛可重试错误', async t => {
  t.mock.method(globalThis, 'fetch', async () => chatOk('抱歉，我无法完成该评估。'));
  await assert.rejects(realProvider.evaluate(evalInput('sketch')), isRetryable(/解析|不含 JSON/));
});

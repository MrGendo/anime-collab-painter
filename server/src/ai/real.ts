// 真实 AI provider（Wave 2D，design.md §4/§8/§10）。
// OpenAI 兼容协议：LLM=chat/completions（多模态 + response_format json_object）；
// IMG=images/edits（图生图，env IMG_EDIT_MODE=edits 时）或 images/generations（文生图兜底）。
// 纯 fetch + Node 原生 FormData/Blob/Response（Node 18+ 均内置），零新增依赖。
// key 只从服务端 env 读取，绝不写死、绝不回传前端；失败统一抛 RealProviderError（带 retryable 标记），
// 对路由层就是普通 Error，天然落入 §3/§8 的 502 兜底，无需改动任何既有文件。
import { analyzePng } from './analyzer.js';
import { TEMPLATES, evalTemplatesForStage } from '../prompts.js';
import type { AIProvider, EvaluationCore } from './provider.js';
import type { Issue, IssueKind, Region, Scope, Severity, Stage, Suggestion } from '../types.js';

/** provider 层统一错误：解析失败/超时/网络/429/5xx 可重试；401/403/400 等配置类错误重试无意义 */
export class RealProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = 'RealProviderError';
  }
}

// env 缺省时的兜底值（正式部署应显式配置，见 SELFREPORT-2D.md 的 env 变量表）
const DEFAULT_LLM_BASE = 'https://api.openai.com/v1';
const DEFAULT_IMG_BASE = 'https://api.openai.com/v1';
const DEFAULT_LLM_MODEL = 'gpt-4o-mini';   // 需同时支持图片输入与 json_object 的入门档
const DEFAULT_IMG_MODEL = 'gpt-image-1';
const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 60_000);  // 与路由层对齐（§8）；真实多模态评估常需 60s+

/** LLM 协议自动探测：base url 含 /anthropic 则走 Anthropic messages 协议（GLM coding plan 额度在此端点），
 *  否则走 OpenAI chat/completions。两种协议产出同构 payload/解析路径。 */
const llmProtocol = (): 'anthropic' | 'openai' => {
  const base = process.env.LLM_BASE_URL ?? DEFAULT_LLM_BASE;
  return base.includes('/anthropic') ? 'anthropic' : 'openai';
};

/** 测试注入点：timeoutMs 可压到毫秒级验证超时路径 */
export interface RealProviderOptions { timeoutMs?: number }

const llmBase = () => (process.env.LLM_BASE_URL ?? DEFAULT_LLM_BASE).replace(/\/+$/, '');
const imgBase = () => (process.env.IMG_BASE_URL ?? DEFAULT_IMG_BASE).replace(/\/+$/, '');
const bearer = (k?: string) => `Bearer ${k ?? ''}`;

/** 带超时的 fetch：到点自行 reject 并 abort 底层连接。
 *  计时不依赖 fetch 的 signal 语义 —— 测试里 fetch 被 stub 成永挂的 Promise，只有自管计时器才能保证超时触发。 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new RealProviderError(`${label}请求超时（${timeoutMs}ms）：${url}`, true));
    }, timeoutMs);
    globalThis.fetch(url, { ...init, signal: ctrl.signal }).then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(new RealProviderError(`${label}网络错误：${(err as Error).message}`, true)); },
    );
  });
}

/** 非 2xx → 结构化错误。429/5xx 是瞬态、可重试；其余 4xx（401 key 无效、400 参数）重试不会变好 */
async function assertOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
      detail = j.error?.message ?? j.message ?? '';
    } catch { detail = text.slice(0, 200); }
  } catch { /* body 读不出来不影响按 status 判定 */ }
  const retryable = res.status === 429 || res.status >= 500;
  throw new RealProviderError(`${label}失败 HTTP ${res.status}${detail ? `：${detail}` : ''}`, retryable, res.status);
}

/** 模型输出健壮解析：先剥整体 markdown 围栏，再截取首个 { 到末个 }（容忍围栏外的前后缀噪声）；
 *  失败一律抛可重试错误 —— 重新采样有机会恢复，不应判死。 */
export function parseModelJson(text: string): Record<string, unknown> {
  let t = text.trim();
  const fenced = t.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new RealProviderError('模型输出中不含 JSON 对象', true);
  try {
    const v: unknown = JSON.parse(t.slice(start, end + 1));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    throw new Error('顶层不是 JSON 对象');
  } catch (e) {
    throw new RealProviderError(`模型输出 JSON 解析失败：${(e as Error).message}`, true);
  }
}

// —— LLM JSON → 契约结构映射：缺字段给默认、枚举非法回退合法值、region 非法置 undefined、条目一律补 id ——
const KINDS: readonly IssueKind[] = ['composition', 'consistency', 'pose', 'contour', 'color', 'background', 'goal'];
const SCOPES: readonly Scope[] = ['pose', 'contour', 'color', 'background', 'local', 'global'];
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];

const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num01 = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;

/** region 四个字段必须齐全且都在 0..1，否则整体缺省（宁可不标区域，也不给画布一个非法高亮框） */
function pickRegion(v: unknown): Region | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const x = num01(r.x), y = num01(r.y), w = num01(r.w), h = num01(r.h);
  return x === undefined || y === undefined || w === undefined || h === undefined ? undefined : { x, y, w, h };
}

/** score：取整并夹到 0..100；缺失/非法记 0 —— 没有依据就不凭空给分 */
const pickScore = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

function toEvaluationCore(json: Record<string, unknown>, input: { round: number; stage: Stage }): EvaluationCore {
  const issues: Issue[] = arr(json.issues).map((v, i) => {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    return {
      id: `iss-${i + 1}`,
      kind: oneOf(o.kind, KINDS, 'composition'),
      severity: oneOf(o.severity, SEVERITIES, 'medium'),
      title: str(o.title, '（模型未提供标题）'),
      detail: str(o.detail),
      region: pickRegion(o.region),
    };
  });
  const suggestions: Suggestion[] = arr(json.suggestions).map((v, i) => {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    // 提示词约定 basedOnIssue 回 issue 的 1 基序号，此处映射为补齐后的 id；对不上就留空
    const n = Number(o.basedOnIssue);
    const basedOnIssue = Number.isInteger(n) && n >= 1 && n <= issues.length ? `iss-${n}` : undefined;
    return {
      id: `sug-${i + 1}`, basedOnIssue,
      kind: oneOf(o.kind, KINDS, 'composition'),
      scope: oneOf(o.scope, SCOPES, 'global'),
      severity: oneOf(o.severity, SEVERITIES, 'medium'),
      title: str(o.title, '（模型未提供标题）'),
      problem: str(o.problem), reason: str(o.reason), fix: str(o.fix),
      region: pickRegion(o.region),
      promptDraft: str(o.promptDraft, '（模型未提供草稿，可直接在生成区手写 prompt）'),
    };
  });
  const overallRaw = json.overall && typeof json.overall === 'object' ? (json.overall as Record<string, unknown>) : {};
  return {
    round: input.round, stage: input.stage, provider: 'real', mode: 'real',
    overall: { score: pickScore(overallRaw.score), summary: str(overallRaw.summary, '（模型未给出总评）') },
    strengths: arr(json.strengths).filter((s): s is string => typeof s === 'string' && !!s.trim()),
    issues, suggestions,
  };
}

// 输出结构约束（拼进 system）：json_object 只保证“是合法 JSON”，不保证结构 —— 结构必须靠提示词钉死
const JSON_SPEC = [
  '输出要求：只输出一个 JSON 对象，禁止 markdown 围栏与注释，结构固定为：',
  '{"overall":{"score":0到100的整数,"summary":"总评一段"},',
  '"strengths":["基于实测数据与画面的优点，2~3条"],',
  '"issues":[{"kind":"composition|consistency|pose|contour|color|background|goal","severity":"high|medium|low","title":"问题短标题","detail":"具体说明并引用实测数字","region":{"x":0到1的小数,"y":0到1的小数,"w":0到1的小数,"h":0到1的小数}}],',
  '"suggestions":[{"basedOnIssue":对应issue的1基序号,"kind":"同issues的kind枚举","scope":"pose|contour|color|background|local|global","severity":"high|medium|low","title":"建议短标题","problem":"具体问题","reason":"修改理由","fix":"可执行的修改建议","region":可选,"promptDraft":"生成任务提示词草稿，必须包含实测数字与scope限定语"}]}',
  'region 仅在问题指向明确区域时给出（归一化 0~1）。每条 suggestion 尽量对应一条 issue（basedOnIssue 填其 1 基序号）。',
].join('\n');

/** 图片响应解包：优先 b64_json；兼容只回 url 的模型（dall-e 系默认回 url）。
 *  下载 url 时绝不带 Authorization —— 预签名 url 属第三方域，带 key 去请求等于把 key 送出去。 */
async function readImageBody(res: Response, timeoutMs: number): Promise<Buffer> {
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* body 非形态时走兜底错误 */ }
  const data = (parsed as { data?: { b64_json?: string; url?: string }[] } | null)?.data?.[0];
  if (data?.b64_json) {
    const buf = Buffer.from(data.b64_json, 'base64');
    if (buf.length) return buf;
    throw new RealProviderError('图像响应 b64_json 为空', true);
  }
  if (data?.url) {
    const img = await fetchWithTimeout(data.url, { method: 'GET' }, timeoutMs, 'IMG url 下载');
    await assertOk(img, 'IMG url 下载');
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length) return buf;
    throw new RealProviderError('图像 url 下载内容为空', true);
  }
  throw new RealProviderError('图像响应中既无 b64_json 也无 url', true);
}

/** PNG 魔数检测：契约要求 dataURL 前缀是 image/png，模型若返回其它格式需在 note 里如实说明（§10） */
const isPng = (b: Buffer) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export function createRealProvider(opts: RealProviderOptions = {}): AIProvider {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    name: 'real', mode: 'real',

    async evaluate(input) {
      // system = 按 stage 组合的评估模板（§6，prompts.ts 是唯一来源）+ JSON 结构约束；
      // user  = 项目设定/实测数据文本 + 画布 PNG dataURL 图片块（多模态）
      const metrics = analyzePng(input.image);
      const names = evalTemplatesForStage(input.stage);
      const ctx = { meta: input.meta, stage: input.stage, metrics };
      const system = [...names.map(n => TEMPLATES[n].system), JSON_SPEC].join('\n\n');
      const userText = [
        `【评估请求·${input.stage} 阶段·第 ${input.round} 轮】`,
        `动画主题「${input.meta.theme}」，角色设定「${input.meta.character}」，画面目标「${input.meta.goal}」。`,
        `用户本段已落笔 ${input.metrics.strokes} 笔，绘制时长 ${Math.round(input.metrics.sessionMs / 1000)} 秒。`,
        ...names.map(n => `【${n}】\n${TEMPLATES[n].user(ctx)}`),
        '请结合上方实测数据与附图逐维度评估，输出符合约定结构的 JSON。',
      ].join('\n\n');
      let text: string;
      if (llmProtocol() === 'anthropic') {
        // Anthropic messages 协议（GLM coding plan 额度端点）：system 独立字段、图片用 source 块、
        // 无 response_format —— JSON 约束已写进 system 文本（JSON_SPEC），靠 parseModelJson 健壮解析兜底
        const res = await fetchWithTimeout(`${llmBase()}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': String(process.env.LLM_API_KEY ?? ''),
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL,
            max_tokens: 4096,
            system,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: userText },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.image.toString('base64') } },
              ],
            }],
          }),
        }, timeoutMs, 'LLM');
        await assertOk(res, 'LLM anthropic messages');
        const data = await res.json() as { content?: { type?: string; text?: string }[] };
        text = (data.content ?? [])
          .filter(p => p.type === 'text')
          .map(p => p.text ?? '')
          .join('');
      } else {
        // OpenAI chat/completions（多模态 + response_format json_object）
        const payload = {
          model: process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${input.image.toString('base64')}` } },
            ] },
          ],
        };
        const res = await fetchWithTimeout(`${llmBase()}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: bearer(process.env.LLM_API_KEY) },
          body: JSON.stringify(payload),
        }, timeoutMs, 'LLM');
        await assertOk(res, 'LLM chat/completions');
        const data = await res.json() as { choices?: { message?: { content?: unknown } }[] };
        const c = data.choices?.[0]?.message?.content;
        // 多模态回复的 content 偶为数组（分段文本块），统一拍平成字符串
        text = typeof c === 'string' ? c
          : Array.isArray(c)
            ? c.map(p => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text?: unknown }).text ?? '') : '')).join('')
            : '';
      }
      if (!text.trim()) throw new RealProviderError('LLM 未返回文本内容', true);
      return toEvaluationCore(parseModelJson(text), input);
    },

    async generate(input) {
      // 与 mock 同路径：simulateFail 必须抛错，路由层才能按 §3 转 800ms 502 演示失败/重试 UI
      if (input.simulateFail) throw new RealProviderError('MOCK 模拟生成失败（演示失败路径）', true);

      // OpenAI images 接口没有 region 参数，局部重绘只能把归一化坐标显式拼进 prompt 文本
      const regionLine = input.scope === 'local' && input.region
        ? `\n（局部重绘区域，归一化坐标 x=${input.region.x} y=${input.region.y} w=${input.region.w} h=${input.region.h}；区域外保持原样）`
        : '';
      const prompt = input.prompt + regionLine;

      let out: { image: Buffer; note: string };
      if (process.env.IMG_EDIT_MODE === 'edits') {
        // 图生图：以当前画布为底图，才有“保留原图”可言。multipart 用 Node 原生 FormData/Blob；
        // 不能手动设 content-type —— multipart boundary 必须交给 fetch 生成
        const keep: Record<Scope, string> = {
          pose: '仅调姿态与位置', contour: '仅修线条', color: '仅调配色',
          background: '仅补背景', local: '仅 region 内修改', global: '全图协调但保持主体可识别',
        };
        const form = new FormData();
        form.append('model', process.env.IMG_MODEL ?? DEFAULT_IMG_MODEL);
        form.append('prompt', prompt);
        form.append('size', '480x300');   // 画布契约尺寸（§3 evaluate 输入即 480x300）
        form.append('image', new Blob([input.image], { type: 'image/png' }), 'canvas.png');
        const res = await fetchWithTimeout(`${imgBase()}/images/edits`, {
          method: 'POST', headers: { authorization: bearer(process.env.IMG_API_KEY) }, body: form,
        }, timeoutMs, 'IMG');
        await assertOk(res, 'IMG images/edits');
        out = {
          image: await readImageBody(res, timeoutMs),
          note: `真实模型图生图（images/edits，scope=${input.scope}，约束：${keep[input.scope]}）：以当前画布 480x300 为底图重绘，保留性以模型实际输出为准`,
        };
      } else {
        // 文生图兜底：IMG_EDIT_MODE 未设为 edits 时只能纯文本生成，note 必须如实写明保留性限制（§10）
        const res = await fetchWithTimeout(`${imgBase()}/images/generations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: bearer(process.env.IMG_API_KEY) },
          body: JSON.stringify({ model: process.env.IMG_MODEL ?? DEFAULT_IMG_MODEL, prompt, size: '480x300' }),
        }, timeoutMs, 'IMG');
        await assertOk(res, 'IMG images/generations');
        out = {
          image: await readImageBody(res, timeoutMs),
          note: `真实模型文生图（images/generations，scope=${input.scope}）：IMG_EDIT_MODE 未设为 edits，无底图参与。文生图模式：无法保证保留原图内容，仅供方向参考`,
        };
      }
      // 契约 dataURL 前缀固定 image/png；模型若返回其它格式，不能装作没看见（§10 诚实性）
      if (!isPng(out.image)) out.note += '；注意：模型输出经魔数检测不是 PNG，已按契约原样封装展示';
      return out;
    },
  };
}

/** provider.ts 动态 import 探测的入口（./real.js → realProvider） */
export const realProvider: AIProvider = createRealProvider();

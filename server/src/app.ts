// Express 应用工厂（路由见 design.md §3）。独立于 index.ts，便于测试直接起临时端口冒烟。
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { Store } from './store.js';
import { getProvider } from './ai/provider.js';
import { analyzePng } from './ai/analyzer.js';
import { buildPrompt } from './prompts.js';
import type { ProjectDoc, RoundRecord, Snapshot, Stage } from './types.js';

export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 60_000);   // evaluate/generate 超时（§8），真实多模态模型可调大

// ---------- dataURL 工具 ----------
const PNG_PREFIX = 'data:image/png;base64,';
function decodeDataUrl(s: unknown): Buffer {
  if (typeof s !== 'string' || !s.startsWith(PNG_PREFIX)) throw new HttpError(400, 'image 必须是 PNG dataURL（data:image/png;base64,...）');
  const buf = Buffer.from(s.slice(PNG_PREFIX.length), 'base64');
  if (!buf.length) throw new HttpError(400, 'image 数据为空');
  return buf;
}
const toDataUrl = (buf: Buffer) => PNG_PREFIX + buf.toString('base64');

/** 结构化业务错误：status + retryable；provider 类错误一律 502 可重试（§3/§8） */
class HttpError extends Error {
  constructor(public status: number, message: string, public retryable = false) { super(message); }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new HttpError(502, `${label}超时（${ms / 1000}s）`, true)), ms);
    p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// ---------- 初始空白快照（960x600 白纸 + 宽 240 缩略） ----------
function scalePng(src: PNG, targetW: number): PNG {
  const h = Math.max(1, Math.round((src.height * targetW) / src.width));
  const out = new PNG({ width: targetW, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < targetW; x++) {
    const i = (y * targetW + x) * 4;
    const j = (Math.min(src.height - 1, Math.round((y * src.height) / h)) * src.width + Math.min(src.width - 1, Math.round((x * src.width) / targetW))) * 4;
    out.data[i] = src.data[j]; out.data[i + 1] = src.data[j + 1]; out.data[i + 2] = src.data[j + 2]; out.data[i + 3] = 255;
  }
  return out;
}
function blankSnapshot(stage: Stage = 'sketch'): Snapshot {
  const full = new PNG({ width: 960, height: 600 });
  full.data.fill(255);
  return {
    id: randomUUID(), round: 0, stage,
    image: toDataUrl(PNG.sync.write(full)),
    thumb: toDataUrl(PNG.sync.write(scalePng(full, 240))),
    createdAt: Date.now(), label: '初始空白画布',
  };
}

/** 单调 rev：任何服务端落盘都基于当前值 +1（§2 约束） */
function bumpRev(store: Store, doc: ProjectDoc): ProjectDoc {
  const prev = store.get(doc.meta.id);
  doc.rev = (prev?.rev ?? -1) + 1;
  store.put(doc);
  return doc;
}

function upsertRound(doc: ProjectDoc, round: number, stage: Stage): RoundRecord {
  let r = doc.rounds.find(x => x.round === round);
  if (!r) { r = { round, stage, generationIds: [], decisions: [] }; doc.rounds.push(r); }
  r.stage = stage;
  doc.rounds.sort((a, b) => a.round - b.round);
  return r;
}

const bad = (res: Response, status: number, error: string, retryable = false) => res.status(status).json({ error, ...(retryable ? { retryable: true } : {}) });

export function createApp(opts: { dataDir?: string } = {}) {
  const store = new Store(opts.dataDir ?? path.resolve(import.meta.dirname, '../data'));
  const startedAt = Date.now();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64mb' }));   // 全幅快照 dataURL 体积较大

  // ---- 基础 ----
  app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) }));

  app.get('/api/config', async (_req, res) => {
    const { config } = await getProvider();
    res.json(config);   // 永不回传 key 本体
  });

  app.post('/api/projects', (req, res) => {
    const { title, theme, character, goal } = req.body ?? {};
    for (const [k, v] of Object.entries({ title, theme, character, goal }))
      if (typeof v !== 'string' || !v.trim()) return bad(res, 400, `字段 ${k} 不能为空`);
    const now = Date.now();
    const doc: ProjectDoc = {
      meta: { id: randomUUID(), title: title.trim(), theme: theme.trim(), character: character.trim(), goal: goal.trim(), createdAt: now },
      stage: 'sketch', round: 0, rev: 0,
      snapshots: [blankSnapshot()], evaluations: [], generations: [], rounds: [],
    };
    upsertRound(doc, 0, 'sketch');
    store.put(doc);
    res.json({ doc });
  });

  app.get('/api/projects/:id', (req, res) => {
    const doc = store.get(req.params.id);
    if (!doc) return bad(res, 404, '项目不存在');
    res.json({ doc });
  });

  app.put('/api/projects/:id', (req, res) => {
    if (!store.get(req.params.id)) return bad(res, 404, '项目不存在');
    const doc = req.body?.doc as ProjectDoc | undefined;
    if (!doc?.meta || doc.meta.id !== req.params.id) return bad(res, 400, 'body.doc 缺失或 meta.id 与路径不一致');
    res.json({ doc: bumpRev(store, doc) });
  });

  // ---- 评估 ----
  app.post('/api/evaluate', async (req, res) => {
    const { projectId, round, stage, image, metrics } = req.body ?? {};
    const doc = store.get(projectId);
    if (!doc) return bad(res, 404, '项目不存在');
    if (!['sketch', 'lineart', 'color', 'detail'].includes(stage)) return bad(res, 400, 'stage 非法');
    if (!Number.isInteger(round) || round < 0) return bad(res, 400, 'round 非法');
    let img: Buffer;
    try { img = decodeDataUrl(image); } catch (e) { return bad(res, 400, (e as Error).message); }

    const { provider } = await getProvider();
    const t0 = Date.now();
    try {
      const core = await withTimeout(provider.evaluate({
        meta: doc.meta, stage, round, image: img,
        metrics: { strokes: Number(metrics?.strokes) || 0, sessionMs: Number(metrics?.sessionMs) || 0 },
      }), REQUEST_TIMEOUT_MS, '评估');
      const evaluation = { ...core, id: randomUUID(), latencyMs: Date.now() - t0 };
      doc.evaluations.push(evaluation);
      upsertRound(doc, round, stage).evaluationId = evaluation.id;
      doc.round = Math.max(doc.round, round);
      bumpRev(store, doc);
      res.json({ evaluation });
    } catch (e) {
      if (e instanceof HttpError) return bad(res, e.status, e.message, e.retryable);
      return bad(res, 502, `评估失败：${(e as Error).message}`, true);   // §3：provider 失败 → 502 可重试
    }
  });

  // ---- Prompt 模板特调（仅展示/编辑用，不落盘） ----
  app.post('/api/prompt/build', (req, res) => {
    const { projectId, suggestionId, scope, stage, basePrompt, image } = req.body ?? {};
    const doc = store.get(projectId);
    if (!doc) return bad(res, 404, '项目不存在');
    const scopes = ['pose', 'contour', 'color', 'background', 'local', 'global'];
    if (!scopes.includes(scope)) return bad(res, 400, 'scope 非法');
    let img: Buffer;
    try { img = decodeDataUrl(image); } catch (e) { return bad(res, 400, (e as Error).message); }

    // 建议从最新一轮评估往前找
    const sug = suggestionId
      ? [...doc.evaluations].reverse().flatMap(e => e.suggestions).find(s => s.id === suggestionId)
      : undefined;
    if (suggestionId && !sug) return bad(res, 404, '建议不存在');

    res.json(buildPrompt({
      meta: doc.meta, stage: stage ?? doc.stage, scope,
      metrics: analyzePng(img),
      basePrompt: typeof basePrompt === 'string' ? basePrompt : undefined,
      suggestionFix: sug?.fix, suggestionPromptDraft: sug?.promptDraft,
    }));
  });

  // ---- 生成 ----
  app.post('/api/generate', async (req, res) => {
    const { projectId, round, suggestionId, scope, prompt, image, region, simulateFail } = req.body ?? {};
    const doc = store.get(projectId);
    if (!doc) return bad(res, 404, '项目不存在');
    const scopes = ['pose', 'contour', 'color', 'background', 'local', 'global'];
    if (!scopes.includes(scope)) return bad(res, 400, 'scope 非法');
    if (typeof prompt !== 'string' || !prompt.trim()) return bad(res, 400, 'prompt 不能为空');
    let img: Buffer;
    try { img = decodeDataUrl(image); } catch (e) { return bad(res, 400, (e as Error).message); }

    const { provider } = await getProvider();
    const t0 = Date.now();
    try {
      const out = await withTimeout(provider.generate({
        meta: doc.meta, stage: doc.stage, scope, prompt: prompt.trim(), image: img, region, simulateFail: simulateFail === true,
      }), REQUEST_TIMEOUT_MS, '生成');
      const generation = {
        id: randomUUID(), round: Number.isInteger(round) ? round : doc.round, suggestionId, scope,
        prompt: prompt.trim(), provider: provider.name, mode: provider.mode,
        latencyMs: Date.now() - t0, image: toDataUrl(out.image), note: out.note,
      };
      doc.generations.push(generation);
      upsertRound(doc, generation.round, doc.stage).generationIds.push(generation.id);
      bumpRev(store, doc);
      res.json({ generation });
    } catch (e) {
      // simulateFail / 真实失败 → 502 + retryable（§3）
      const msg = e instanceof HttpError ? e.message : `生成失败：${(e as Error).message}`;
      const status = e instanceof HttpError ? e.status : 502;
      if (simulateFail === true) {
        await new Promise(r => setTimeout(r, 800));   // 契约：800ms 后返回
        return bad(res, 502, 'MOCK 模拟生成失败（演示失败路径）', true);
      }
      return bad(res, status, msg, true);
    }
  });

  // ---- 生产模式静态托管 ../web/dist（catch-all 放最后，绝不吞 /api） ----
  const webDist = path.resolve(import.meta.dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return bad(res, 404, '未知 API 路由');
      if (req.path.includes('..')) return bad(res, 400, '非法路径');   // 目录穿越防护（static 的 root 限制之外的显式兜底）
      res.sendFile('index.html', { root: webDist });
    });
  } else {
    app.use('/api', (_req, res) => bad(res, 404, '未知 API 路由'));
  }

  // ---- 兜底错误处理 ----
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) return bad(res, 400, '请求体不是合法 JSON');
    if (err instanceof HttpError) return bad(res, err.status, err.message, err.retryable);
    bad(res, 502, `服务内部错误：${err.message}`, true);
  });

  return { app, store };
}
